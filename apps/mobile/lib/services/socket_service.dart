import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../models/claude_prompt_model.dart';
import '../models/session_model.dart';
import '../utils/app_logger.dart';

/// Manages the Socket.IO connection to the relay server and exposes typed
/// streams for all inbound events, as well as methods for all outbound events.
class SocketService {
  SocketService();

  io.Socket? _socket;
  Timer? _pingTimer;
  String? _currentSessionId;

  // ---------------------------------------------------------------------------
  // Stream controllers for typed inbound events
  // ---------------------------------------------------------------------------

  final _terminalOutputController =
      StreamController<TerminalOutput>.broadcast();
  final _claudePromptsController = StreamController<ClaudePrompt>.broadcast();
  final _sessionStatesController =
      StreamController<SessionStateEvent>.broadcast();
  final _sessionPairsController = StreamController<SessionPair>.broadcast();
  final _sessionErrorsController = StreamController<SessionError>.broadcast();
  final _connectionStatusController =
      StreamController<SocketConnectionStatus>.broadcast();

  // ---------------------------------------------------------------------------
  // Public streams
  // ---------------------------------------------------------------------------

  /// Raw terminal output chunks from the host agent.
  Stream<TerminalOutput> get terminalOutput => _terminalOutputController.stream;

  /// Interactive Claude prompts detected by the host agent.
  Stream<ClaudePrompt> get claudePrompts => _claudePromptsController.stream;

  /// Session lifecycle state changes.
  Stream<SessionStateEvent> get sessionStates =>
      _sessionStatesController.stream;

  /// Confirmation events when pairing succeeds.
  Stream<SessionPair> get sessionPairs => _sessionPairsController.stream;

  /// Error events from the relay server.
  Stream<SessionError> get sessionErrors => _sessionErrorsController.stream;

  /// Raw socket connection status (connected / disconnected / error).
  Stream<SocketConnectionStatus> get connectionStatus =>
      _connectionStatusController.stream;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  bool get isConnected => _socket?.connected ?? false;

  /// Establishes a Socket.IO connection to [serverUrl] and immediately emits
  /// the `mobile:join` event with the supplied credentials.
  ///
  /// Safe to call multiple times — will disconnect any existing socket first.
  Future<void> connect({
    required String serverUrl,
    required String token,
    required String sessionId,
    required String deviceId,
  }) async {
    AppLogger.info(
      'SocketService',
      'connect — serverUrl: $serverUrl, sessionId: $sessionId',
    );

    // Clean up any existing connection before establishing a new one.
    await disconnect();
    AppLogger.info('SocketService', '已断开旧连接，创建新 socket');

    _currentSessionId = sessionId;

    _socket = io.io(
      serverUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token, 'role': 'mobile'})
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(30000)
          // 不设置 setReconnectionAttempts，使用默认值 Infinity（无限重连）
          .setTimeout(10000)
          .build(),
    );

    _registerEventHandlers(
      token: token,
      sessionId: sessionId,
      deviceId: deviceId,
    );

    AppLogger.info('SocketService', 'Socket 已创建，等待连接（autoConnect=true，连接为异步）');
    // socket_io_client connects automatically; no explicit .connect() needed
    // when autoConnect is true (which is the default).
  }

  /// Sends a raw terminal input string to the host agent.
  void sendInput(String data) {
    if (!isConnected || _currentSessionId == null) return;
    _socket!.emit('terminal:input', {
      'sessionId': _currentSessionId,
      'data': data,
    });
  }

  /// Notifies the host agent that the terminal dimensions have changed.
  void sendResize(int cols, int rows) {
    if (!isConnected || _currentSessionId == null) return;
    _socket!.emit('terminal:resize', {
      'sessionId': _currentSessionId,
      'cols': cols,
      'rows': rows,
    });
  }

  /// Gracefully closes the socket and cleans up all resources.
  Future<void> disconnect() async {
    _stopPing();
    _socket?.dispose();
    _socket = null;
    _currentSessionId = null;
  }

  /// Releases all stream controllers. Call this only when the service is being
  /// permanently torn down (e.g. app shutdown).
  void dispose() {
    disconnect();
    _terminalOutputController.close();
    _claudePromptsController.close();
    _sessionStatesController.close();
    _sessionPairsController.close();
    _sessionErrorsController.close();
    _connectionStatusController.close();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  void _registerEventHandlers({
    required String token,
    required String sessionId,
    required String deviceId,
  }) {
    final socket = _socket!;

    socket.onConnect((_) {
      AppLogger.info('SocketService', 'onConnect: 已连接到中继服务器');
      _connectionStatusController.add(SocketConnectionStatus.connected);

      // Emit join immediately upon (re)connection.
      socket.emit('mobile:join', {'sessionToken': token, 'deviceId': deviceId});
      AppLogger.info('SocketService', '已发送 mobile:join');

      _startPing(sessionId);
    });

    socket.onDisconnect((reason) {
      AppLogger.warn('SocketService', 'onDisconnect: 断开连接', reason);
      _stopPing();
      _connectionStatusController.add(SocketConnectionStatus.disconnected);
    });

    socket.onConnectError((error) {
      AppLogger.error(
        'SocketService',
        'onConnectError: 连接失败（请检查 serverUrl、网络、服务器是否启动）',
        error,
      );
      _connectionStatusController.add(SocketConnectionStatus.error);
    });

    socket.onError((error) {
      AppLogger.error('SocketService', 'onError: Socket 错误', error);
      _connectionStatusController.add(SocketConnectionStatus.error);
    });

    socket.onReconnect((_) {
      AppLogger.info('SocketService', 'onReconnect: 重连成功');
      _connectionStatusController.add(SocketConnectionStatus.connected);
    });

    socket.onReconnecting((_) {
      AppLogger.info('SocketService', 'onReconnecting: 正在重连...');
      _connectionStatusController.add(SocketConnectionStatus.reconnecting);
    });

    // ------------------------------------------------------------------
    // Inbound event: terminal output from the host agent
    // ------------------------------------------------------------------
    socket.on('terminal:output', (data) {
      try {
        final map = _toMap(data);
        if (map != null) {
          _terminalOutputController.add(TerminalOutput.fromJson(map));
        }
      } catch (e) {
        debugPrint('[SocketService] Error parsing terminal:output: $e');
      }
    });

    // ------------------------------------------------------------------
    // Inbound event: Claude interactive prompt detected
    // ------------------------------------------------------------------
    socket.on('claude:prompt', (data) {
      try {
        final map = _toMap(data);
        if (map != null) {
          _claudePromptsController.add(ClaudePrompt.fromJson(map));
        }
      } catch (e) {
        debugPrint('[SocketService] Error parsing claude:prompt: $e');
      }
    });

    // ------------------------------------------------------------------
    // Inbound event: session lifecycle state change
    // ------------------------------------------------------------------
    socket.on('session:state', (data) {
      try {
        final map = _toMap(data);
        if (map != null) {
          _sessionStatesController.add(SessionStateEvent.fromJson(map));
        }
      } catch (e) {
        debugPrint('[SocketService] Error parsing session:state: $e');
      }
    });

    // ------------------------------------------------------------------
    // Inbound event: pairing confirmed
    // ------------------------------------------------------------------
    socket.on('session:pair', (data) {
      try {
        AppLogger.info('SocketService', 'session:pair: 配对成功');
        final map = _toMap(data);
        if (map != null) {
          _sessionPairsController.add(SessionPair.fromJson(map));
        }
      } catch (e) {
        AppLogger.error('SocketService', '解析 session:pair 失败', e);
      }
    });

    // ------------------------------------------------------------------
    // Inbound event: server error
    // ------------------------------------------------------------------
    socket.on('session:error', (data) {
      try {
        AppLogger.error(
          'SocketService',
          'session:error 服务端错误',
          data is Map ? data['message'] ?? data : data,
        );
        final map = _toMap(data);
        if (map != null) {
          _sessionErrorsController.add(SessionError.fromJson(map));
        }
      } catch (e) {
        AppLogger.error('SocketService', '解析 session:error 失败', e);
      }
    });
  }

  /// Sends a keepalive ping to the server every 30 seconds.
  void _startPing(String sessionId) {
    _stopPing();
    _pingTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (isConnected) {
        _socket!.emit('session:ping', {
          'sessionId': sessionId,
          'timestamp': DateTime.now().millisecondsSinceEpoch,
        });
      }
    });
  }

  void _stopPing() {
    _pingTimer?.cancel();
    _pingTimer = null;
  }

  /// Safely converts the raw socket.io event [data] to a Map.
  /// socket_io_client may deliver either a Map or a List with one Map element.
  Map<String, dynamic>? _toMap(dynamic data) {
    if (data is Map<String, dynamic>) return data;
    if (data is Map) return Map<String, dynamic>.from(data);
    if (data is List && data.isNotEmpty) {
      final first = data.first;
      if (first is Map<String, dynamic>) return first;
      if (first is Map) return Map<String, dynamic>.from(first);
    }
    debugPrint('[SocketService] Unexpected data type: ${data.runtimeType}');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/// Raw socket connection status (separate from the high-level [ConnectionStatus]
/// tracked by the connection provider).
enum SocketConnectionStatus { connected, disconnected, reconnecting, error }

/// Typed wrapper for a `session:state` event payload.
class SessionStateEvent {
  const SessionStateEvent({
    required this.sessionId,
    required this.state,
    required this.agentConnected,
    required this.mobileConnected,
    required this.timestamp,
  });

  final String sessionId;
  final SessionState state;
  final bool agentConnected;
  final bool mobileConnected;
  final int timestamp;

  factory SessionStateEvent.fromJson(Map<String, dynamic> json) =>
      SessionStateEvent(
        sessionId: json['sessionId'] as String,
        state: SessionState.fromString(json['state'] as String? ?? 'unknown'),
        agentConnected: json['agentConnected'] as bool? ?? false,
        mobileConnected: json['mobileConnected'] as bool? ?? false,
        timestamp: json['timestamp'] as int,
      );
}
