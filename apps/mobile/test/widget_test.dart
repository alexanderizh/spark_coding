// Unit and widget tests for remote_claude_mobile.
//
// Running tests:
//   flutter test
//
// Running with coverage:
//   flutter test --coverage

import 'package:flutter_test/flutter_test.dart';

import '../lib/models/session_model.dart';
import '../lib/models/claude_prompt_model.dart';

// ---------------------------------------------------------------------------
// SessionModel tests
// ---------------------------------------------------------------------------

void main() {
  group('SessionState', () {
    test('fromString returns correct enum value for known states', () {
      expect(SessionState.fromString('paired'), equals(SessionState.paired));
      expect(
        SessionState.fromString('waiting_for_agent'),
        equals(SessionState.waitingForAgent),
      );
      expect(
        SessionState.fromString('waiting_for_mobile'),
        equals(SessionState.waitingForMobile),
      );
      expect(
        SessionState.fromString('agent_disconnected'),
        equals(SessionState.agentDisconnected),
      );
      expect(
        SessionState.fromString('mobile_disconnected'),
        equals(SessionState.mobileDisconnected),
      );
      expect(SessionState.fromString('expired'), equals(SessionState.expired));
      expect(SessionState.fromString('error'), equals(SessionState.error));
    });

    test('fromString returns unknown for unrecognised values', () {
      expect(
        SessionState.fromString('not_a_real_state'),
        equals(SessionState.unknown),
      );
      expect(SessionState.fromString(''), equals(SessionState.unknown));
    });
  });

  group('SessionModel', () {
    const model = SessionModel(
      sessionId: 'session-123',
      token: 'tok-abc',
      serverUrl: 'https://relay.example.com',
      state: SessionState.paired,
      agentConnected: true,
      mobileConnected: true,
      pairedAt: 1700000000000,
    );

    test('isActive returns true only when state is paired', () {
      expect(model.isActive, isTrue);

      final notPaired = model.copyWith(state: SessionState.waitingForAgent);
      expect(notPaired.isActive, isFalse);
    });

    test('isTerminal returns true for expired and error states', () {
      final expired = model.copyWith(state: SessionState.expired);
      expect(expired.isTerminal, isTrue);

      final error = model.copyWith(state: SessionState.error);
      expect(error.isTerminal, isTrue);

      expect(model.isTerminal, isFalse);
    });

    test('copyWith creates a new instance with updated fields', () {
      final updated = model.copyWith(
        state: SessionState.agentDisconnected,
        agentConnected: false,
      );

      expect(updated.sessionId, equals(model.sessionId));
      expect(updated.token, equals(model.token));
      expect(updated.serverUrl, equals(model.serverUrl));
      expect(updated.state, equals(SessionState.agentDisconnected));
      expect(updated.agentConnected, isFalse);
      expect(updated.mobileConnected, isTrue); // unchanged
    });

    test('toJson / fromJson round-trip preserves all fields', () {
      final json = model.toJson();
      final restored = SessionModel.fromJson(json);
      expect(restored, equals(model));
    });

    test('equality operator compares all fields', () {
      const same = SessionModel(
        sessionId: 'session-123',
        token: 'tok-abc',
        serverUrl: 'https://relay.example.com',
        state: SessionState.paired,
        agentConnected: true,
        mobileConnected: true,
        pairedAt: 1700000000000,
      );
      expect(model, equals(same));
      expect(model, isNot(equals(model.copyWith(sessionId: 'other'))));
    });
  });

  // ---------------------------------------------------------------------------
  // ClaudePromptType tests
  // ---------------------------------------------------------------------------

  group('ClaudePromptType', () {
    test('fromString returns correct enum values', () {
      expect(
        ClaudePromptType.fromString('permission_request'),
        equals(ClaudePromptType.permissionRequest),
      );
      expect(
        ClaudePromptType.fromString('yes_no_confirm'),
        equals(ClaudePromptType.yesNoConfirm),
      );
      expect(
        ClaudePromptType.fromString('tool_use_approval'),
        equals(ClaudePromptType.toolUseApproval),
      );
      expect(
        ClaudePromptType.fromString('multiline_input'),
        equals(ClaudePromptType.multilineInput),
      );
      expect(
        ClaudePromptType.fromString('slash_command_hint'),
        equals(ClaudePromptType.slashCommandHint),
      );
      expect(
        ClaudePromptType.fromString('general_input'),
        equals(ClaudePromptType.generalInput),
      );
    });

    test('fromString returns unknown for unrecognised values', () {
      expect(
        ClaudePromptType.fromString('garbage'),
        equals(ClaudePromptType.unknown),
      );
    });

    test('requiresYesNo is true for binary prompt types', () {
      expect(ClaudePromptType.permissionRequest.requiresYesNo, isTrue);
      expect(ClaudePromptType.yesNoConfirm.requiresYesNo, isTrue);
      expect(ClaudePromptType.toolUseApproval.requiresYesNo, isTrue);
      expect(ClaudePromptType.multilineInput.requiresYesNo, isFalse);
      expect(ClaudePromptType.generalInput.requiresYesNo, isFalse);
    });

    test('requiresMultilineInput is true only for multiline_input', () {
      expect(ClaudePromptType.multilineInput.requiresMultilineInput, isTrue);
      expect(
        ClaudePromptType.permissionRequest.requiresMultilineInput,
        isFalse,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // ClaudePrompt model tests
  // ---------------------------------------------------------------------------

  group('ClaudePrompt', () {
    final prompt = ClaudePrompt(
      sessionId: 'session-123',
      promptType: ClaudePromptType.permissionRequest,
      rawText: 'Allow Claude to read files?',
      timestamp: 1700000001000,
    );

    test('fromJson deserialises correctly', () {
      final json = {
        'sessionId': 'session-123',
        'promptType': 'permission_request',
        'rawText': 'Allow Claude to read files?',
        'timestamp': 1700000001000,
      };
      final result = ClaudePrompt.fromJson(json);
      expect(result, equals(prompt));
    });

    test('toJson / fromJson round-trip preserves all fields', () {
      final restored = ClaudePrompt.fromJson(prompt.toJson());
      expect(restored, equals(prompt));
    });

    test('equality operator compares all fields', () {
      final same = ClaudePrompt(
        sessionId: 'session-123',
        promptType: ClaudePromptType.permissionRequest,
        rawText: 'Allow Claude to read files?',
        timestamp: 1700000001000,
      );
      expect(prompt, equals(same));
    });
  });

  // ---------------------------------------------------------------------------
  // TerminalOutput tests
  // ---------------------------------------------------------------------------

  group('TerminalOutput', () {
    test('fromJson deserialises correctly', () {
      final json = {
        'sessionId': 'session-123',
        'data': '\x1b[32mHello world\x1b[0m\r\n',
        'timestamp': 1700000002000,
        'seq': 42,
      };
      final output = TerminalOutput.fromJson(json);
      expect(output.sessionId, equals('session-123'));
      expect(output.data, contains('Hello world'));
      expect(output.seq, equals(42));
    });
  });

  // ---------------------------------------------------------------------------
  // SessionPair tests
  // ---------------------------------------------------------------------------

  group('SessionPair', () {
    test('fromJson deserialises correctly', () {
      final json = {
        'sessionId': 'session-123',
        'mobileDeviceId': 'device-uuid-abc',
        'pairedAt': 1700000003000,
      };
      final pair = SessionPair.fromJson(json);
      expect(pair.sessionId, equals('session-123'));
      expect(pair.mobileDeviceId, equals('device-uuid-abc'));
      expect(pair.pairedAt, equals(1700000003000));
    });
  });

  // ---------------------------------------------------------------------------
  // SessionError tests
  // ---------------------------------------------------------------------------

  group('SessionError', () {
    test('fromJson deserialises correctly', () {
      final json = {
        'code': 'SESSION_EXPIRED',
        'message': 'The session token has expired.',
      };
      final error = SessionError.fromJson(json);
      expect(error.code, equals('SESSION_EXPIRED'));
      expect(error.message, equals('The session token has expired.'));
    });

    test('fromJson provides defaults for missing fields', () {
      final error = SessionError.fromJson({});
      expect(error.code, equals('UNKNOWN'));
      expect(error.message, isNotEmpty);
    });
  });
}
