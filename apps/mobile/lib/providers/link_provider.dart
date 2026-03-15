import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/connection_link_model.dart';
import '../services/session_service.dart';
import '../services/socket_service.dart';
import 'connection_provider.dart';

class LinkListState {
  const LinkListState({
    this.links = const [],
    this.initializing = true,
    this.refreshing = false,
    this.errorMessage,
  });

  final List<ConnectionLink> links;
  final bool initializing;
  final bool refreshing;
  final String? errorMessage;

  LinkListState copyWith({
    List<ConnectionLink>? links,
    bool? initializing,
    bool? refreshing,
    String? errorMessage,
  }) {
    return LinkListState(
      links:        links        ?? this.links,
      initializing: initializing ?? this.initializing,
      refreshing:   refreshing   ?? this.refreshing,
      errorMessage: errorMessage,
    );
  }
}

class LinkNotifier extends StateNotifier<LinkListState> {
  LinkNotifier({required SessionService sessionService, required SocketService socketService, Dio? dio})
    : _sessionService = sessionService,
      _socketService = socketService,
      _dio = dio ?? Dio(),
      super(const LinkListState());

  final SessionService _sessionService;
  final SocketService _socketService;
  final Dio _dio;

  Future<void> init() async {
    await _sessionService.restore();
    state = state.copyWith(
      links:        _sessionService.links,
      initializing: false,
      errorMessage: null,
    );
    await refreshStatus();
  }

  /// Refresh session list using the server's `/api/sessions?mobileDeviceId=xxx`
  /// endpoint, which returns all paired sessions for this device together with
  /// cached desktop status snapshots.  Falls back to per-session polling if the
  /// mobileDeviceId is unavailable.
  Future<void> refreshStatus() async {
    final currentLinks = _sessionService.links;
    state = state.copyWith(
      links:        currentLinks,
      refreshing:   true,
      initializing: false,
      errorMessage: null,
    );

    final mobileDeviceId = _sessionService.deviceId;
    final now = DateTime.now().millisecondsSinceEpoch;

    // ── Strategy 1: bulk fetch from server ─────────────────────────────────
    if (mobileDeviceId != null && currentLinks.isNotEmpty) {
      // Collect known desktop device IDs so the server can surface newly-started
      // desktop sessions that haven't been re-paired with this mobile yet.
      final knownDesktopIds = currentLinks
          .map((l) => l.desktopDeviceId)
          .whereType<String>()
          .toSet()
          .toList();

      // Group links by serverUrl to batch requests
      final serverUrls = currentLinks.map((l) => l.serverUrl).toSet();

      // Lookup maps (priority order):
      //   bySessionId      — primary: UUID is stable after first pairing
      //   byConnectionKey  — fallback: if session was re-created before this fix
      //   byDesktopDeviceId — last resort: catches active desktop with no match yet
      final bySessionId       = <String, Map<String, dynamic>>{};
      final byConnectionKey   = <String, Map<String, dynamic>>{};
      final byDesktopDeviceId = <String, Map<String, dynamic>>{};

      for (final serverUrl in serverUrls) {
        try {
          final queryParams = <String, dynamic>{'mobileDeviceId': mobileDeviceId};
          if (knownDesktopIds.isNotEmpty) {
            queryParams['desktopDeviceIds'] = knownDesktopIds.join(',');
          }
          final response = await _dio.get<Map<String, dynamic>>(
            '$serverUrl/api/sessions',
            queryParameters: queryParams,
          );
          final data = response.data?['data'] as List<dynamic>?;
          if (data != null) {
            for (final item in data) {
              if (item is Map<String, dynamic>) {
                final sid = item['sessionId']       as String?;
                final ck  = item['connectionKey']   as String?;
                final did = item['desktopDeviceId'] as String?;
                final agentOn = item['agentConnected'] as bool? ?? false;
                if (sid != null && sid.isNotEmpty) bySessionId[sid]     = item;
                if (ck  != null && ck.isNotEmpty)  byConnectionKey[ck]  = item;
                if (did != null && did.isNotEmpty && agentOn) byDesktopDeviceId[did] = item;
              }
            }
          }
        } catch (_) {
          // Server unreachable — fall through to per-link polling
        }
      }

      if (bySessionId.isNotEmpty || byConnectionKey.isNotEmpty || byDesktopDeviceId.isNotEmpty) {
        final refreshed = currentLinks.map((link) {
          // Priority: sessionId (stable UUID) → connectionKey → desktopDeviceId
          final serverData = bySessionId[link.sessionId]
                          ?? (link.connectionKey   != null ? byConnectionKey[link.connectionKey!]      : null)
                          ?? (link.desktopDeviceId != null ? byDesktopDeviceId[link.desktopDeviceId!] : null);

          if (serverData == null) {
            return link.copyWith(
              status:        LinkStatus.offline,
              lastCheckedAt: now,
              updatedAt:     now,
            );
          }

          // Sync fresh credentials — sessionId/token rotate when desktop restarts
          final freshSessionId = serverData['sessionId'] as String? ?? link.sessionId;
          final freshToken     = serverData['token']     as String? ?? link.token;
          final agentConnected = serverData['agentConnected'] as bool? ?? false;
          final hostName       = serverData['agentHostname']  as String?;
          final connKey        = serverData['connectionKey']  as String?;
          final desktopId      = serverData['desktopDeviceId'] as String?;
          final mobileId       = serverData['mobileDeviceId']  as String?;

          DesktopStatusSnapshot? desktopStatus;
          final statusJson = serverData['desktopStatus'] as Map<String, dynamic>?;
          if (statusJson != null) {
            desktopStatus = DesktopStatusSnapshot.fromJson(statusJson);
          }

          final desktopHealthy = desktopStatus?.overallStatus == DesktopHealth.healthy ||
                                 desktopStatus?.overallStatus == DesktopHealth.degraded;
          final online = agentConnected || desktopHealthy;

          return link.copyWith(
            sessionId:       freshSessionId,
            token:           freshToken,
            status:          online ? LinkStatus.online : LinkStatus.offline,
            hostName:        (hostName?.trim().isEmpty ?? true) ? link.hostName : hostName,
            connectionKey:   connKey ?? link.connectionKey,
            desktopDeviceId: desktopId ?? link.desktopDeviceId,
            mobileDeviceId:  mobileId  ?? link.mobileDeviceId,
            desktopStatus:   desktopStatus,
            lastCheckedAt:   now,
            updatedAt:       now,
          );
        }).toList();

        await _sessionService.replaceLinks(refreshed);
        state = state.copyWith(
          links:      _sessionService.links,
          refreshing: false,
        );
        return;
      }
    }

    // ── Strategy 2: per-link polling (legacy / fallback) ──────────────────
    final refreshed = <ConnectionLink>[];
    for (final link in currentLinks) {
      try {
        final response = await _dio.get<Map<String, dynamic>>(
          '${link.serverUrl}/api/session/${link.token}',
        );
        final data = response.data?['data'] as Map<String, dynamic>?;
        final online   = data?['agentConnected'] as bool? ?? false;
        final hostName = data?['agentHostname']  as String?;
        refreshed.add(
          link.copyWith(
            status: online ? LinkStatus.online : LinkStatus.offline,
            hostName: (hostName?.trim().isEmpty ?? true) ? link.hostName : hostName,
            lastCheckedAt: now,
            updatedAt:     now,
          ),
        );
      } catch (_) {
        refreshed.add(
          link.copyWith(
            status:        LinkStatus.offline,
            lastCheckedAt: now,
            updatedAt:     now,
          ),
        );
      }
    }

    await _sessionService.replaceLinks(refreshed);
    state = state.copyWith(
      links:      _sessionService.links,
      refreshing: false,
    );
  }

  Future<ConnectionLink> saveFromScan({
    required String serverUrl,
    required String token,
    required String sessionId,
    String? desktopDeviceId,
    String? connectionKey,
  }) async {
    final saved = await _sessionService.saveOrUpdateLink(
      serverUrl:       serverUrl,
      token:           token,
      sessionId:       sessionId,
      cliType:         CliType.claude,
      setActive:       true,
      desktopDeviceId: desktopDeviceId,
      connectionKey:   connectionKey,
    );
    state = state.copyWith(links: _sessionService.links, errorMessage: null);
    return saved;
  }

  Future<void> setActiveLink(ConnectionLink link) async {
    await _sessionService.setActiveLink(link.id);
    state = state.copyWith(links: _sessionService.links, errorMessage: null);
  }

  Future<void> clearAllLinks() async {
    await _sessionService.clear();
    state = const LinkListState(
      links:        [],
      initializing: false,
      refreshing:   false,
    );
  }

  /// Delete a single link: call server REST, remove local record.
  /// The server broadcasts session:deleted so the desktop also cleans up.
  Future<void> deleteLink(ConnectionLink link) async {
    // Remove locally first for instant UI response
    await _sessionService.removeLink(link.id);
    state = state.copyWith(links: _sessionService.links, errorMessage: null);

    // Notify server (best-effort)
    try {
      await _dio.delete('${link.serverUrl}/api/session/${link.sessionId}');
    } catch (_) {
      // Server may already be gone; local removal is sufficient
    }
  }

  /// Called when server broadcasts session:deleted (deleted by desktop side).
  Future<void> handleSessionDeleted(String sessionId) async {
    final matches = _sessionService.links.where((l) => l.sessionId == sessionId).toList();
    for (final link in matches) {
      await _sessionService.removeLink(link.id);
    }
    if (matches.isNotEmpty) {
      state = state.copyWith(links: _sessionService.links, errorMessage: null);
    }
  }
}

final linkNotifierProvider = StateNotifierProvider<LinkNotifier, LinkListState>(
  (ref) {
    return LinkNotifier(
      sessionService: ref.watch(sessionServiceProvider),
      socketService:  ref.watch(socketServiceProvider),
    );
  },
);

final onlineLinksProvider = Provider<List<ConnectionLink>>((ref) {
  final links = ref.watch(linkNotifierProvider).links;
  return links.where((item) => item.status == LinkStatus.online).toList();
});

final offlineLinksProvider = Provider<List<ConnectionLink>>((ref) {
  final links = ref.watch(linkNotifierProvider).links;
  return links.where((item) => item.status != LinkStatus.online).toList();
});
