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
      links: links ?? this.links,
      initializing: initializing ?? this.initializing,
      refreshing: refreshing ?? this.refreshing,
      errorMessage: errorMessage,
    );
  }
}

class LinkNotifier extends StateNotifier<LinkListState> {
  LinkNotifier({
    required SessionService sessionService,
    required SocketService socketService,
    Dio? dio,
  }) : _sessionService = sessionService,
       _socketService = socketService,
       _dio = dio ?? Dio(),
       super(const LinkListState());

  final SessionService _sessionService;
  final SocketService _socketService;
  final Dio _dio;

  Future<void> init() async {
    await _sessionService.restore();
    state = state.copyWith(
      links: _sessionService.links,
      initializing: false,
      errorMessage: null,
    );
    await refreshStatus();
  }

  /// Refresh session list using the server's `/api/sessions?mobileDeviceId=xxx`
  /// endpoint, which returns all paired sessions for this device together with
  /// cached desktop status snapshots.
  Future<void> refreshStatus() async {
    final currentLinks = _sessionService.links;
    state = state.copyWith(
      links: currentLinks,
      refreshing: true,
      initializing: false,
      errorMessage: null,
    );

    final mobileDeviceId = _sessionService.deviceId;
    final now = DateTime.now().millisecondsSinceEpoch;
    if (mobileDeviceId == null) {
      state = state.copyWith(refreshing: false);
      return;
    }

    final serverUrls = currentLinks.map((l) => l.serverUrl).toSet();
    final configuredServerUrl = _sessionService.serverUrl;
    if (configuredServerUrl != null && configuredServerUrl.isNotEmpty) {
      serverUrls.add(configuredServerUrl);
    }
    if (serverUrls.isEmpty) {
      await _sessionService.replaceLinks(const []);
      state = state.copyWith(links: const [], refreshing: false);
      return;
    }

    final knownDesktopIds = currentLinks
        .map((l) => l.desktopDeviceId)
        .whereType<String>()
        .toSet()
        .toList();
    final existingBySessionId = {
      for (final link in currentLinks) link.sessionId: link,
    };

    final refreshed = <ConnectionLink>[];
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
        if (data == null) continue;

        for (final item in data) {
          if (item is! Map<String, dynamic>) continue;
          final sessionId = item['sessionId'] as String?;
          final token = item['token'] as String?;
          if (sessionId == null ||
              sessionId.isEmpty ||
              token == null ||
              token.isEmpty) {
            continue;
          }

          final previous = existingBySessionId[sessionId];
          refreshed.add(
            _buildLinkFromServer(
              previous: previous,
              serverData: item,
              serverUrl: serverUrl,
              now: now,
            ),
          );
        }
      } catch (_) {
        // ignore
      }
    }

    await _sessionService.replaceLinks(refreshed);
    state = state.copyWith(links: _sessionService.links, refreshing: false);
  }

  ConnectionLink _buildLinkFromServer({
    required String serverUrl,
    required Map<String, dynamic> serverData,
    required int now,
    ConnectionLink? previous,
  }) {
    final sessionId = serverData['sessionId'] as String;
    final token = serverData['token'] as String;
    final hostName = serverData['agentHostname'] as String?;
    final desktopId = serverData['desktopDeviceId'] as String?;
    final mobileId = serverData['mobileDeviceId'] as String?;
    final agentConnected = serverData['agentConnected'] as bool? ?? false;
    final agentPlatform = normalizeSystemPlatform(
      serverData['agentPlatform'] as String?,
    );
    final mobilePlatform = normalizeSystemPlatform(
      serverData['mobilePlatform'] as String?,
    );
    final desktopOnlineStatus = serverData['desktopStatus'] != null
        ? LinkStatusValue.fromString(serverData['desktopStatus'] as String)
        : null;
    final mobileOnlineStatus = serverData['mobileStatus'] != null
        ? LinkStatusValue.fromString(serverData['mobileStatus'] as String)
        : null;
    DesktopStatusSnapshot? desktopStatus;
    final statusJson = serverData['deviceStatus'] as Map<String, dynamic>?;
    if (statusJson != null) {
      desktopStatus = DesktopStatusSnapshot.fromJson(statusJson);
    }
    final desktopHealthy =
        desktopStatus?.overallStatus == DesktopHealth.healthy ||
        desktopStatus?.overallStatus == DesktopHealth.degraded;
    final online = agentConnected || desktopHealthy;

    return ConnectionLink(
      id: previous?.id ?? sessionId,
      serverUrl: serverUrl,
      token: token,
      sessionId: sessionId,
      cliType: CliType.claude,
      hostName: (hostName?.trim().isEmpty ?? true)
          ? previous?.hostName
          : hostName,
      desktopDeviceId: desktopId ?? previous?.desktopDeviceId,
      mobileDeviceId: mobileId ?? previous?.mobileDeviceId,
      desktopPlatform: agentPlatform.isEmpty
          ? normalizeSystemPlatform(desktopStatus?.platform)
          : agentPlatform,
      mobilePlatform: mobilePlatform.isEmpty
          ? (previous?.mobilePlatform ?? _socketService.mobilePlatform)
          : mobilePlatform,
      desktopOnlineStatus: desktopOnlineStatus,
      mobileOnlineStatus: mobileOnlineStatus,
      desktopStatus: desktopStatus,
      status: online ? LinkStatus.online : LinkStatus.offline,
      lastCheckedAt: now,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    );
  }

  Future<ConnectionLink> saveFromScan({
    required String serverUrl,
    required String token,
    required String sessionId,
    String? desktopDeviceId,
  }) async {
    final saved = await _sessionService.saveOrUpdateLink(
      serverUrl: serverUrl,
      token: token,
      sessionId: sessionId,
      cliType: CliType.claude,
      setActive: true,
      desktopDeviceId: desktopDeviceId,
      mobilePlatform: _socketService.mobilePlatform,
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
      links: [],
      initializing: false,
      refreshing: false,
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
      await _dio.delete<void>(
        '${link.serverUrl}/api/session/${link.sessionId}',
      );
    } catch (_) {
      // Server may already be gone; local removal is sufficient
    }
  }

  /// Called when server broadcasts session:deleted (deleted by desktop side).
  Future<void> handleSessionDeleted(String sessionId) async {
    final matches = _sessionService.links
        .where((l) => l.sessionId == sessionId)
        .toList();
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
      socketService: ref.watch(socketServiceProvider),
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
