import 'package:flutter/foundation.dart';

/// All Claude interactive prompt types that the host agent may signal.
enum ClaudePromptType {
  /// Claude is requesting permission to perform an action.
  permissionRequest('permission_request', 'Permission Request'),

  /// A yes/no confirmation dialog from Claude.
  yesNoConfirm('yes_no_confirm', 'Confirmation Required'),

  /// Approval needed before a tool is invoked.
  toolUseApproval('tool_use_approval', 'Tool Use Approval'),

  /// Claude is requesting multi-line text input.
  multilineInput('multiline_input', 'Multi-line Input'),

  /// A hint about available slash commands.
  slashCommandHint('slash_command_hint', 'Slash Command'),

  /// A general input prompt from Claude.
  generalInput('general_input', 'Input Requested'),

  /// Fallback for unrecognised prompt types.
  unknown('unknown', 'Prompt');

  const ClaudePromptType(this.value, this.displayName);

  final String value;
  final String displayName;

  static ClaudePromptType fromString(String value) {
    return ClaudePromptType.values.firstWhere(
      (e) => e.value == value,
      orElse: () => ClaudePromptType.unknown,
    );
  }

  /// Returns true when this prompt type expects a yes/no binary response.
  bool get requiresYesNo =>
      this == ClaudePromptType.permissionRequest ||
      this == ClaudePromptType.yesNoConfirm ||
      this == ClaudePromptType.toolUseApproval;

  /// Returns true when this prompt type expects multi-line text.
  bool get requiresMultilineInput => this == ClaudePromptType.multilineInput;
}

/// An interactive prompt detected on the host Claude session.
@immutable
class ClaudePrompt {
  const ClaudePrompt({
    required this.sessionId,
    required this.promptType,
    required this.rawText,
    required this.timestamp,
  });

  final String sessionId;
  final ClaudePromptType promptType;

  /// The raw terminal text content of the prompt (may contain ANSI codes).
  final String rawText;

  /// Unix epoch milliseconds when the prompt was detected.
  final int timestamp;

  factory ClaudePrompt.fromJson(Map<String, dynamic> json) => ClaudePrompt(
        sessionId: json['sessionId'] as String,
        promptType: ClaudePromptType.fromString(
          json['promptType'] as String? ?? 'unknown',
        ),
        rawText: json['rawText'] as String? ?? '',
        timestamp: json['timestamp'] as int,
      );

  Map<String, dynamic> toJson() => {
        'sessionId': sessionId,
        'promptType': promptType.value,
        'rawText': rawText,
        'timestamp': timestamp,
      };

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is ClaudePrompt &&
        other.sessionId == sessionId &&
        other.promptType == promptType &&
        other.rawText == rawText &&
        other.timestamp == timestamp;
  }

  @override
  int get hashCode =>
      Object.hash(sessionId, promptType, rawText, timestamp);

  @override
  String toString() =>
      'ClaudePrompt(type: ${promptType.value}, session: $sessionId)';
}
