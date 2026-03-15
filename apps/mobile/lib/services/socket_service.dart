import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../models/claude_prompt_model.dart';
import '../models/session_model.dart';
import '../utils/app_logger.dart';

String normalizeSystemPlatform(String? value) {
  switch ((value ?? '').toLowerCase()) {
    case 'darwin':
    case 'macos':
      return 'macOS';
    case 'win32':
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
    case 'ios':
      return 'iOS';
    case 'android':
      return 'Android';
    default:
      return (value ?? '').trim();
  }
}

String currentMobilePlatform() {
  if (kIsWeb) return 'Web';
  return normalizeSystemPlatform(Platform.operatingSystem);
}

/// Manages the Socket.IO connection to the relay server and exposes typed
/// streams for all inbound events, as well as methods for all outbound events.
class SocketService {
  SocketService();

  io.Socket? _socket;
  Timer? _pingTimer;
  String? _currentSessionId;
  String? _pendingRuntimeCliType;

  // ---------------------------------------------------------------------------
  // Stream controllers for typed inbound events
  // ---------------------------------------------------------------------------

  final _terminalOutputController =
      StreamController<TerminalOutput>.broadcast();
  final _terminalSnapshotController =
      StreamController<TerminalSnapshot>.broadcast();
  final _claudePromptsController = StreamController<ClaudePrompt>.broadcast();
  final _sessionStatesController =
      StreamController<SessionStateEvent>.broadcast();
  final _sessionPairsController = StreamController<SessionPair>.broadcast();
  final _sessionErrorsController = StreamController<SessionError>.broadcast();
  final _runtimeStatusController =
      StreamController<RuntimeStatusEvent>.broadcast();
  final _connectionStatusController =
      StreamController<SocketConnectionStatus>.broadcast();
  final _desktopStatusController =
      StreamController<Map<String, dynamic>>.broadcast();
  final _sessionDeletedController =
      StreamController<Map<String, dynamic>>.broadcast();

  // ---------------------------------------------------------------------------
  // Public streams
  // ---------------------------------------------------------------------------

  /// Raw terminal output chunks from the host agent.
  Stream<TerminalOutput> get terminalOutput => _terminalOutputController.stream;

  /// Complete terminal state snapshots from the server.
  Stream<TerminalSnapshot> get terminalSnapshot =>
      _terminalSnapshotController.stream;

  /// Interactive Claude prompts detected by the host agent.
  Stream<ClaudePrompt> get claudePrompts => _claudePromptsController.stream;

  /// Session lifecycle state changes.
  Stream<SessionStateEvent> get sessionStates =>
      _sessionStatesController.stream;

  /// Confirmation events when pairing succeeds.
  Stream<SessionPair> get sessionPairs => _sessionPairsController.stream;

  /// Error events from the relay server.
  Stream<SessionError> get sessionErrors => _sessionErrorsController.stream;

  Stream<RuntimeStatusEvent> get runtimeStatus =>
      _runtimeStatusController.stream;

  /// Raw socket connection status (connected / disconnected / error).
  Stream<SocketConnectionStatus> get connectionStatus =>
      _connectionStatusController.stream;

  /// Desktop daemon health status updates forwarded from server.
  Stream<Map<String, dynamic>> get desktopStatus =>
      _desktopStatusController.stream;

  /// Fired when the session is deleted by either side.
  Stream<Map<String, dynamic>> get sessionDeleted =>
      _sessionDeletedController.stream;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  bool get isConnected => _socket?.connected ?? false;
  String get mobilePlatform => currentMobilePlatform();

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
    AppLogger.info('SocketService', 'connect — sessionId: $sessionId');

    // Clean up any existing connection before establishing a new one.
    await disconnect();
    AppLogger.info('SocketService', '已断开旧连接，创建新 socket');

    _currentSessionId = sessionId;

    _socket = io.io(
      serverUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({
            'sessionId': sessionId,
            'token': token,
            'role': 'mobile',
            'deviceId': deviceId,
          })
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
    AppLogger.info('SocketService', '发送 terminal:input bytes=${data.length}');
    _socket!.emit('terminal:input', {
      'sessionId': _currentSessionId,
      'data': data,
    });
  }

  /// Notifies the host agent that the terminal dimensions have changed.
  void sendResize(int cols, int rows) {
    if (!isConnected || _currentSessionId == null) return;
    AppLogger.info('SocketService', '发送 terminal:resize cols=$cols rows=$rows');
    _socket!.emit('terminal:resize', {
      'sessionId': _currentSessionId,
      'cols': cols,
      'rows': rows,
    });
  }

  void sendRuntimeEnsure(String cliType) {
    _pendingRuntimeCliType = cliType;
    if (!isConnected || _currentSessionId == null) return;
    AppLogger.info('SocketService', '发送 runtime:ensure cliType=$cliType');
    _socket!.emit('runtime:ensure', {
      'sessionId': _currentSessionId,
      'cliType': cliType,
    });
  }

  /// Gracefully closes the socket and cleans up all resources.
  Future<void> disconnect() async {
    _stopPing();
    if (_socket != null) {
      // Emit disconnected before nulling the reference so the ConnectionNotifier
      // receives the event immediately, before any async socket callbacks fire.
      _connectionStatusController.add(SocketConnectionStatus.disconnected);
      _socket!.dispose();
      _socket = null;
    }
    _currentSessionId = null;
    _pendingRuntimeCliType = null;
  }

  /// Releases all stream controllers. Call this only when the service is being
  /// permanently torn down (e.g. app shutdown).
  void dispose() {
    disconnect();
    _terminalOutputController.close();
    _terminalSnapshotController.close();
    _claudePromptsController.close();
    _sessionStatesController.close();
    _sessionPairsController.close();
    _sessionErrorsController.close();
    _runtimeStatusController.close();
    _connectionStatusController.close();
    _desktopStatusController.close();
    _sessionDeletedController.close();
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
      if (_socket != socket) return; // Stale socket — ignore
      AppLogger.info('SocketService', 'onConnect: 已连接到中继服务器');
      _connectionStatusController.add(SocketConnectionStatus.connected);

      // Emit join immediately upon (re)connection.
      socket.emit('mobile:join', {
        'sessionToken': token,
        'deviceId': deviceId,
        'mobilePlatform': mobilePlatform,
      });
      AppLogger.info('SocketService', '已发送 mobile:join');

      if (_pendingRuntimeCliType != null) {
        socket.emit('runtime:ensure', {
          'sessionId': sessionId,
          'cliType': _pendingRuntimeCliType,
        });
      }

      _startPing(sessionId);
    });

    socket.onDisconnect((reason) {
      if (_socket != socket) return; // Stale socket — ignore
      AppLogger.warn('SocketService', 'onDisconnect: 断开连接', reason);
      _stopPing();
      _connectionStatusController.add(SocketConnectionStatus.disconnected);
    });

    socket.onConnectError((error) {
      if (_socket != socket) return; // Stale socket — ignore
      AppLogger.error(
        'SocketService',
        'onConnectError: 连接失败（请检查网络与服务状态）',
        error,
      );
      _connectionStatusController.add(SocketConnectionStatus.error);
    });

    socket.onError((error) {
      if (_socket != socket) return; // Stale socket — ignore
      AppLogger.error('SocketService', 'onError: Socket 错误', error);
      _connectionStatusController.add(SocketConnectionStatus.error);
    });

    socket.onReconnect((_) {
      if (_socket != socket) return; // Stale socket — ignore
      AppLogger.info('SocketService', 'onReconnect: 重连成功');
      _connectionStatusController.add(SocketConnectionStatus.connected);
    });

    socket.onReconnecting((_) {
      if (_socket != socket) return; // Stale socket — ignore
      AppLogger.info('SocketService', 'onReconnecting: 正在重连...');
      _connectionStatusController.add(SocketConnectionStatus.reconnecting);
    });

    // ------------------------------------------------------------------
    // Inbound event: terminal output from the host agent
    // ------------------------------------------------------------------
    socket.on('terminal:output', (data) {
      if (_socket != socket) return; // Stale socket — ignore
      try {
        final map = _toMap(data);
        if (map != null) {
          final seq = (map['seq'] as num?)?.toInt();
          final dataStr = map['data'] as String? ?? '';
          if (seq != null && seq % 50 == 0) {
            AppLogger.info(
              'SocketService',
              '收到 terminal:output seq=$seq bytes=${dataStr.length}',
            );
          }
          _terminalOutputController.add(TerminalOutput.fromJson(map));
        }
      } catch (e) {
        debugPrint('[SocketService] Error parsing terminal:output: $e');
      }
    });

    // ------------------------------------------------------------------
    // Inbound event: terminal snapshot from the server
    // ------------------------------------------------------------------
    socket.on('terminal:snapshot', (data) {
      if (_socket != socket) return; // Stale socket — ignore
      try {
        final map = _toMap(data);
        if (map != null) {
          final snapshot = map['snapshot'] as String? ?? '';
          AppLogger.info(
            'SocketService',
            '收到 terminal:snapshot bytes=${snapshot.length}',
          );
          _terminalSnapshotController.add(TerminalSnapshot.fromJson(map));
        }
      } catch (e) {
        debugPrint('[SocketService] Error parsing terminal:snapshot: $e');
      }
    });

    // ------------------------------------------------------------------
    // Inbound event: Claude interactive prompt detected
    // ------------------------------------------------------------------
    socket.on('claude:prompt', (data) {
      if (_socket != socket) return; // Stale socket — ignore
      try {
        final map = _toMap(data);
        if (map != null) {
          AppLogger.info(
            'SocketService',
            '收到 claude:prompt type=${map['promptType']}',
          );
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
      if (_socket != socket) return; // Stale socket — ignore
      try {
        final map = _toMap(data);
        if (map != null) {
          AppLogger.info(
            'SocketService',
            '收到 session:state state=${map['state']}',
          );
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
      if (_socket != socket) return; // Stale socket — ignore
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
      if (_socket != socket) return; // Stale socket — ignore
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

    socket.on('runtime:status', (data) {
      if (_socket != socket) return; // Stale socket — ignore
      try {
        final map = _toMap(data);
        if (map != null) {
          AppLogger.info(
            'SocketService',
            '收到 runtime:status ready=${map['ready']}',
          );
          _runtimeStatusController.add(RuntimeStatusEvent.fromJson(map));
        }
      } catch (e) {
        AppLogger.error('SocketService', '解析 runtime:status 失败', e);
      }
    });

    // Desktop daemon health updates (forwarded by server from desktop daemon)
    socket.on('desktop:status:update', (data) {
      if (_socket != socket) return; // Stale socket — ignore
      try {
        final map = _toMap(data);
        if (map != null) {
          AppLogger.info('SocketService', '收到 desktop:status:update');
          _desktopStatusController.add(map);
        }
      } catch (e) {
        AppLogger.error('SocketService', '解析 desktop:status:update 失败', e);
      }
    });

    // Session deleted by either side
    socket.on('session:deleted', (data) {
      if (_socket != socket) return; // Stale socket — ignore
      try {
        final map = _toMap(data);
        if (map != null) {
          _sessionDeletedController.add(map);
        }
      } catch (e) {
        AppLogger.error('SocketService', '解析 session:deleted 失败', e);
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
    required this.agentHostname,
    required this.timestamp,
  });

  final String sessionId;
  final SessionState state;
  final bool agentConnected;
  final bool mobileConnected;
  final String? agentHostname;
  final int timestamp;

  factory SessionStateEvent.fromJson(Map<String, dynamic> json) =>
      SessionStateEvent(
        sessionId: json['sessionId'] as String,
        state: SessionState.fromString(json['state'] as String? ?? 'unknown'),
        agentConnected: json['agentConnected'] as bool? ?? false,
        mobileConnected: json['mobileConnected'] as bool? ?? false,
        agentHostname: json['agentHostname'] as String?,
        timestamp: json['timestamp'] as int,
      );
}

class RuntimeStatusEvent {
  const RuntimeStatusEvent({
    required this.sessionId,
    required this.cliType,
    required this.ready,
    required this.started,
    required this.message,
    required this.timestamp,
  });

  final String sessionId;
  final String cliType;
  final bool ready;
  final bool started;
  final String? message;
  final int timestamp;

  factory RuntimeStatusEvent.fromJson(Map<String, dynamic> json) {
    return RuntimeStatusEvent(
      sessionId: json['sessionId'] as String,
      cliType: json['cliType'] as String? ?? 'claude',
      ready: json['ready'] as bool? ?? false,
      started: json['started'] as bool? ?? false,
      message: json['message'] as String?,
      timestamp:
          json['timestamp'] as int? ?? DateTime.now().millisecondsSinceEpoch,
    );
  }
}
