import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_prompt_model.dart';
import '../services/socket_service.dart';
import 'connection_provider.dart';

// ---------------------------------------------------------------------------
// Prompt notifier
// ---------------------------------------------------------------------------

class PromptNotifier extends StateNotifier<ClaudePrompt?> {
  PromptNotifier({required SocketService socketService})
    : _socketService = socketService,
      super(null) {
    _listenToPrompts();
  }

  final SocketService _socketService;
  StreamSubscription<ClaudePrompt>? _promptSub;
  Timer? _autoClearTimer;

  /// Duration after which an unacknowledged prompt is automatically dismissed.
  static const _autoClearDuration = Duration(seconds: 60);

  void _listenToPrompts() {
    _promptSub = _socketService.claudePrompts.listen(
      (prompt) {
        _onPrompt(prompt);
      },
      onError: (Object e) {
        debugPrint('[PromptNotifier] claudePrompts error: $e');
      },
    );
  }

  void _onPrompt(ClaudePrompt prompt) {
    state = prompt;
    _resetAutoClearTimer();
    debugPrint('[PromptNotifier] Prompt received: ${prompt.promptType.value}');
  }

  /// Manually dismisses the current prompt (e.g. user tapped dismiss button).
  void dismiss() {
    _autoClearTimer?.cancel();
    state = null;
  }

  void _resetAutoClearTimer() {
    _autoClearTimer?.cancel();
    _autoClearTimer = Timer(_autoClearDuration, () {
      if (mounted) {
        debugPrint('[PromptNotifier] Auto-cleared prompt after 60s');
        state = null;
      }
    });
  }

  @override
  void dispose() {
    _promptSub?.cancel();
    _autoClearTimer?.cancel();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final promptNotifierProvider =
    StateNotifierProvider<PromptNotifier, ClaudePrompt?>((ref) {
      final socketService = ref.watch(socketServiceProvider);
      return PromptNotifier(socketService: socketService);
    });

/// Convenience provider for the current nullable [ClaudePrompt].
final currentPromptProvider = Provider<ClaudePrompt?>((ref) {
  return ref.watch(promptNotifierProvider);
});
