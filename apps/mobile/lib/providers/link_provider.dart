import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/connection_link_model.dart';
import '../services/session_service.dart';
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
  LinkNotifier({required SessionService sessionService, Dio? dio})
    : _sessionService = sessionService,
      _dio = dio ?? Dio(),
      super(const LinkListState());

  final SessionService _sessionService;
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

  Future<void> refreshStatus() async {
    final currentLinks = _sessionService.links;
    state = state.copyWith(
      links: currentLinks,
      refreshing: true,
      initializing: false,
      errorMessage: null,
    );

    final now = DateTime.now().millisecondsSinceEpoch;
    final refreshed = <ConnectionLink>[];

    for (final link in currentLinks) {
      try {
        final response = await _dio.get<Map<String, dynamic>>(
          '${link.serverUrl}/api/session/${link.token}',
        );
        final data = response.data?['data'] as Map<String, dynamic>?;
        final online = data?['agentConnected'] as bool? ?? false;
        final hostName = data?['agentHostname'] as String?;
        refreshed.add(
          link.copyWith(
            status: online ? LinkStatus.online : LinkStatus.offline,
            hostName: hostName?.trim().isEmpty ?? true
                ? link.hostName
                : hostName,
            lastCheckedAt: now,
            updatedAt: now,
          ),
        );
      } catch (_) {
        refreshed.add(
          link.copyWith(
            status: LinkStatus.offline,
            lastCheckedAt: now,
            updatedAt: now,
          ),
        );
      }
    }

    await _sessionService.replaceLinks(refreshed);
    state = state.copyWith(
      links: _sessionService.links,
      refreshing: false,
      errorMessage: null,
    );
  }

  Future<ConnectionLink> saveFromScan({
    required String serverUrl,
    required String token,
    required String sessionId,
  }) async {
    final saved = await _sessionService.saveOrUpdateLink(
      serverUrl: serverUrl,
      token: token,
      sessionId: sessionId,
      cliType: CliType.claude,
      setActive: true,
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
}

final linkNotifierProvider = StateNotifierProvider<LinkNotifier, LinkListState>(
  (ref) {
    return LinkNotifier(sessionService: ref.watch(sessionServiceProvider));
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
