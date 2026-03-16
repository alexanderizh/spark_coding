import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/session_service.dart';
import '../services/socket_service.dart';
import '../utils/app_logger.dart';

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

enum ConnectionStatus { disconnected, connecting, connected, error }

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
  }) : _socketService = socketService,
       _sessionService = sessionService,
       super(const AppConnectionState()) {
    _listenToSocketStatus();
  }

  final SocketService _socketService;
  final SessionService _sessionService;

  StreamSubscription<SocketConnectionStatus>? _statusSub;

  void _listenToSocketStatus() {
    _statusSub = _socketService.connectionStatus.listen((socketStatus) {
      AppLogger.info('Connection', 'Socket 状态变更: $socketStatus');
      switch (socketStatus) {
        case SocketConnectionStatus.connected:
          AppLogger.info('Connection', '已连接到中继服务器');
          state = state.copyWith(status: ConnectionStatus.connected);
        case SocketConnectionStatus.disconnected:
          AppLogger.warn('Connection', '已断开连接');
          // If we are actively rebuilding the connection (connecting state),
          // ignore the transient disconnected event emitted by internal
          // disconnect() — the new socket is already being established.
          if (state.status == ConnectionStatus.connecting) break;
          // Only move to disconnected if we were previously connected.
          // Avoids spurious state flips on startup.
          if (state.status != ConnectionStatus.disconnected) {
            state = state.copyWith(status: ConnectionStatus.disconnected);
          }
        case SocketConnectionStatus.reconnecting:
          AppLogger.info('Connection', '正在重连...');
          state = state.copyWith(status: ConnectionStatus.connecting);
        case SocketConnectionStatus.error:
          AppLogger.error(
            'Connection',
            '连接错误，当前 errorMessage: ${state.errorMessage}',
          );
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
    AppLogger.info('Connection', 'connect 调用 — sessionId: $sessionId');

    state = AppConnectionState(
      status: ConnectionStatus.connecting,
      serverUrl: serverUrl,
    );

    try {
      AppLogger.info('Connection', '正在生成 deviceId...');
      final deviceId = await _sessionService.generateDeviceId();
      AppLogger.info('Connection', 'deviceId 已生成: $deviceId');

      if (_socketService.isConnected &&
          state.serverUrl == serverUrl &&
          _socketService.currentSessionId == sessionId) {
        AppLogger.info('Connection', '连接已存在且 sessionId 相同，重发 mobile:join 校准会话');
        _socketService.rejoin(
          token: token,
          sessionId: sessionId,
          deviceId: deviceId,
        );
        state = AppConnectionState(
          status: ConnectionStatus.connected,
          serverUrl: serverUrl,
        );
        return;
      }

      AppLogger.info('Connection', '正在调用 SocketService.connect...');
      await _socketService.connect(
        serverUrl: serverUrl,
        token: token,
        sessionId: sessionId,
        deviceId: deviceId,
      );

      AppLogger.info(
        'Connection',
        'SocketService.connect 已返回（连接为异步，状态由 listener 更新）',
      );
      // The status will be updated by the socket status listener.
    } catch (e, st) {
      AppLogger.error('Connection', 'connect 异常', e, st);
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
