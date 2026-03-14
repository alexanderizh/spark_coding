import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/session_service.dart';
import '../services/socket_service.dart';

// ---------------------------------------------------------------------------
// Service providers (singleton instances shared across the app)
// ---------------------------------------------------------------------------

/// Single [SocketService] instance for the lifetime of the app.
final socketServiceProvider = Provider<SocketService>((ref) {
  final service = SocketService();
  ref.onDispose(service.dispose);
  return service;
});

/// Single [SessionService] instance. Note: [SessionService.restore] must be
/// called before dependent providers are read (done in HomeScreen initState).
final sessionServiceProvider = Provider<SessionService>((ref) {
  return SessionService();
});

// ---------------------------------------------------------------------------
// Connection status enum
// ---------------------------------------------------------------------------

enum ConnectionStatus {
  disconnected,
  connecting,
  connected,
  error,
}

// ---------------------------------------------------------------------------
// Connection state
// Deliberately named AppConnectionState to avoid shadowing Flutter's
// widgets.ConnectionState enum if material.dart is imported elsewhere.
// ---------------------------------------------------------------------------

class AppConnectionState {
  const AppConnectionState({
    this.status = ConnectionStatus.disconnected,
    this.errorMessage,
    this.serverUrl,
  });

  final ConnectionStatus status;
  final String? errorMessage;
  final String? serverUrl;

  AppConnectionState copyWith({
    ConnectionStatus? status,
    String? errorMessage,
    String? serverUrl,
  }) {
    return AppConnectionState(
      status: status ?? this.status,
      errorMessage: errorMessage,
      serverUrl: serverUrl ?? this.serverUrl,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is AppConnectionState &&
        other.status == status &&
        other.errorMessage == errorMessage &&
        other.serverUrl == serverUrl;
  }

  @override
  int get hashCode => Object.hash(status, errorMessage, serverUrl);
}

// ---------------------------------------------------------------------------
// Connection notifier
// ---------------------------------------------------------------------------

class ConnectionNotifier extends StateNotifier<AppConnectionState> {
  ConnectionNotifier({
    required SocketService socketService,
    required SessionService sessionService,
  })  : _socketService = socketService,
        _sessionService = sessionService,
        super(const AppConnectionState()) {
    _listenToSocketStatus();
  }

  final SocketService _socketService;
  final SessionService _sessionService;

  StreamSubscription<SocketConnectionStatus>? _statusSub;

  void _listenToSocketStatus() {
    _statusSub = _socketService.connectionStatus.listen((socketStatus) {
      switch (socketStatus) {
        case SocketConnectionStatus.connected:
          state = state.copyWith(status: ConnectionStatus.connected);
        case SocketConnectionStatus.disconnected:
          // Only move to disconnected if we were previously connected or
          // connecting. Avoids spurious state flips on startup.
          if (state.status != ConnectionStatus.disconnected) {
            state = state.copyWith(status: ConnectionStatus.disconnected);
          }
        case SocketConnectionStatus.reconnecting:
          state = state.copyWith(status: ConnectionStatus.connecting);
        case SocketConnectionStatus.error:
          state = state.copyWith(
            status: ConnectionStatus.error,
            errorMessage: 'Connection error. Retrying…',
          );
      }
    });
  }

  /// Initiates a connection to the relay server.
  Future<void> connect({
    required String serverUrl,
    required String token,
    required String sessionId,
  }) async {
    if (state.status == ConnectionStatus.connecting ||
        state.status == ConnectionStatus.connected) {
      return;
    }

    state = AppConnectionState(
      status: ConnectionStatus.connecting,
      serverUrl: serverUrl,
    );

    try {
      final deviceId = await _sessionService.generateDeviceId();

      await _socketService.connect(
        serverUrl: serverUrl,
        token: token,
        sessionId: sessionId,
        deviceId: deviceId,
      );

      // The status will be updated by the socket status listener.
    } catch (e, st) {
      debugPrint('[ConnectionNotifier] connect error: $e\n$st');
      state = AppConnectionState(
        status: ConnectionStatus.error,
        errorMessage: e.toString(),
        serverUrl: serverUrl,
      );
    }
  }

  /// Closes the socket connection.
  Future<void> disconnect() async {
    await _socketService.disconnect();
    state = const AppConnectionState(status: ConnectionStatus.disconnected);
  }

  @override
  void dispose() {
    _statusSub?.cancel();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final connectionNotifierProvider =
    StateNotifierProvider<ConnectionNotifier, AppConnectionState>((ref) {
  return ConnectionNotifier(
    socketService: ref.watch(socketServiceProvider),
    sessionService: ref.watch(sessionServiceProvider),
  );
});

/// Convenience provider that exposes only the [ConnectionStatus] enum value
/// for use in the router redirect logic.
final connectionProvider = Provider<ConnectionStatus>((ref) {
  return ref.watch(connectionNotifierProvider).status;
});
