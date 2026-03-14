import 'package:flutter/foundation.dart';

/// All possible session lifecycle states as reported by the relay server.
enum SessionState {
  /// Server created the session; waiting for the host agent to connect.
  waitingForAgent('waiting_for_agent'),

  /// Agent is connected; waiting for the mobile client to join.
  waitingForMobile('waiting_for_mobile'),

  /// Both sides are connected and the session is active.
  paired('paired'),

  /// The host agent disconnected unexpectedly.
  agentDisconnected('agent_disconnected'),

  /// The mobile client disconnected unexpectedly.
  mobileDisconnected('mobile_disconnected'),

  /// The session token has expired on the server.
  expired('expired'),

  /// A server-side or protocol error occurred.
  error('error'),

  /// Initial local state before any server message is received.
  unknown('unknown');

  const SessionState(this.value);

  final String value;

  static SessionState fromString(String value) {
    return SessionState.values.firstWhere(
      (e) => e.value == value,
      orElse: () => SessionState.unknown,
    );
  }
}

/// Immutable data class representing the current pairing session.
@immutable
class SessionModel {
  const SessionModel({
    required this.sessionId,
    required this.token,
    required this.serverUrl,
    this.state = SessionState.unknown,
    this.agentConnected = false,
    this.mobileConnected = false,
    this.pairedAt,
  });

  /// The session identifier assigned by the relay server.
  final String sessionId;

  /// The pairing token parsed from the QR code.
  final String token;

  /// The relay server URL parsed from the QR code.
  final String serverUrl;

  /// The current session lifecycle state.
  final SessionState state;

  /// Whether the host agent is currently connected.
  final bool agentConnected;

  /// Whether this mobile client is currently connected.
  final bool mobileConnected;

  /// Unix epoch milliseconds when the session was successfully paired.
  final int? pairedAt;

  /// Returns true when both sides are actively connected.
  bool get isActive => state == SessionState.paired;

  /// Returns true when the session has ended and cannot be resumed.
  bool get isTerminal =>
      state == SessionState.expired || state == SessionState.error;

  SessionModel copyWith({
    String? sessionId,
    String? token,
    String? serverUrl,
    SessionState? state,
    bool? agentConnected,
    bool? mobileConnected,
    int? pairedAt,
  }) {
    return SessionModel(
      sessionId: sessionId ?? this.sessionId,
      token: token ?? this.token,
      serverUrl: serverUrl ?? this.serverUrl,
      state: state ?? this.state,
      agentConnected: agentConnected ?? this.agentConnected,
      mobileConnected: mobileConnected ?? this.mobileConnected,
      pairedAt: pairedAt ?? this.pairedAt,
    );
  }

  Map<String, dynamic> toJson() => {
        'sessionId': sessionId,
        'token': token,
        'serverUrl': serverUrl,
        'state': state.value,
        'agentConnected': agentConnected,
        'mobileConnected': mobileConnected,
        'pairedAt': pairedAt,
      };

  factory SessionModel.fromJson(Map<String, dynamic> json) => SessionModel(
        sessionId: json['sessionId'] as String,
        token: json['token'] as String,
        serverUrl: json['serverUrl'] as String,
        state: SessionState.fromString(json['state'] as String? ?? 'unknown'),
        agentConnected: json['agentConnected'] as bool? ?? false,
        mobileConnected: json['mobileConnected'] as bool? ?? false,
        pairedAt: json['pairedAt'] as int?,
      );

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is SessionModel &&
        other.sessionId == sessionId &&
        other.token == token &&
        other.serverUrl == serverUrl &&
        other.state == state &&
        other.agentConnected == agentConnected &&
        other.mobileConnected == mobileConnected &&
        other.pairedAt == pairedAt;
  }

  @override
  int get hashCode => Object.hash(
        sessionId,
        token,
        serverUrl,
        state,
        agentConnected,
        mobileConnected,
        pairedAt,
      );

  @override
  String toString() =>
      'SessionModel(sessionId: $sessionId, state: ${state.value}, '
      'agentConnected: $agentConnected, mobileConnected: $mobileConnected)';
}

/// Represents a pairing confirmation event from the server.
@immutable
class SessionPair {
  const SessionPair({
    required this.sessionId,
    required this.mobileDeviceId,
    required this.pairedAt,
  });

  final String sessionId;
  final String mobileDeviceId;
  final int pairedAt;

  factory SessionPair.fromJson(Map<String, dynamic> json) => SessionPair(
        sessionId: json['sessionId'] as String,
        mobileDeviceId: json['mobileDeviceId'] as String,
        pairedAt: json['pairedAt'] as int,
      );
}

/// Represents a session error event from the server.
@immutable
class SessionError {
  const SessionError({
    required this.code,
    required this.message,
  });

  final String code;
  final String message;

  factory SessionError.fromJson(Map<String, dynamic> json) => SessionError(
        code: json['code'] as String? ?? 'UNKNOWN',
        message: json['message'] as String? ?? 'An unknown error occurred.',
      );

  @override
  String toString() => 'SessionError(code: $code, message: $message)';
}

/// Represents a terminal output chunk from the host agent.
@immutable
class TerminalOutput {
  const TerminalOutput({
    required this.sessionId,
    required this.data,
    required this.timestamp,
    required this.seq,
  });

  final String sessionId;

  /// Raw terminal data (may contain ANSI escape sequences).
  final String data;

  final int timestamp;

  /// Monotonically increasing sequence number for ordering.
  final int seq;

  factory TerminalOutput.fromJson(Map<String, dynamic> json) => TerminalOutput(
        sessionId: json['sessionId'] as String,
        data: json['data'] as String,
        timestamp: json['timestamp'] as int,
        seq: json['seq'] as int,
      );
}
