import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/session_model.dart';
import '../services/socket_service.dart';
import 'connection_provider.dart';

// ---------------------------------------------------------------------------
// Session notifier
// ---------------------------------------------------------------------------

class SessionNotifier extends StateNotifier<SessionModel?> {
  SessionNotifier({required SocketService socketService})
      : _socketService = socketService,
        super(null) {
    _listenToEvents();
  }

  final SocketService _socketService;
  StreamSubscription<SessionStateEvent>? _stateSub;
  StreamSubscription<SessionPair>? _pairSub;

  void _listenToEvents() {
    _stateSub = _socketService.sessionStates.listen((event) {
      _onSessionState(event);
    }, onError: (Object e) {
      debugPrint('[SessionNotifier] sessionStates error: $e');
    });

    _pairSub = _socketService.sessionPairs.listen((pair) {
      _onSessionPair(pair);
    }, onError: (Object e) {
      debugPrint('[SessionNotifier] sessionPairs error: $e');
    });
  }

  void _onSessionState(SessionStateEvent event) {
    if (state == null) {
      // First state event — create initial SessionModel from the event data.
      // serverUrl and token are set externally via [initSession].
      state = SessionModel(
        sessionId: event.sessionId,
        token: '',
        serverUrl: '',
        state: event.state,
        agentConnected: event.agentConnected,
        mobileConnected: event.mobileConnected,
      );
    } else {
      state = state!.copyWith(
        state: event.state,
        agentConnected: event.agentConnected,
        mobileConnected: event.mobileConnected,
      );
    }

    debugPrint(
      '[SessionNotifier] State updated: ${event.state.value}, '
      'agent=${event.agentConnected}, mobile=${event.mobileConnected}',
    );
  }

  void _onSessionPair(SessionPair pair) {
    if (state != null) {
      state = state!.copyWith(
        state: SessionState.paired,
        mobileConnected: true,
        pairedAt: pair.pairedAt,
      );
    }
    debugPrint('[SessionNotifier] Paired at ${pair.pairedAt}');
  }

  /// Initialises (or replaces) the local session model with the QR-scanned
  /// credentials. Called by [ConnectionNotifier] before connecting.
  void initSession({
    required String sessionId,
    required String token,
    required String serverUrl,
  }) {
    state = SessionModel(
      sessionId: sessionId,
      token: token,
      serverUrl: serverUrl,
      state: SessionState.unknown,
    );
  }

  /// Clears the session model (called on disconnect / reset).
  void clearSession() {
    state = null;
  }

  @override
  void dispose() {
    _stateSub?.cancel();
    _pairSub?.cancel();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final sessionNotifierProvider =
    StateNotifierProvider<SessionNotifier, SessionModel?>((ref) {
  final socketService = ref.watch(socketServiceProvider);
  return SessionNotifier(socketService: socketService);
});

/// Convenience provider for the nullable [SessionModel].
final sessionProvider = Provider<SessionModel?>((ref) {
  return ref.watch(sessionNotifierProvider);
});
