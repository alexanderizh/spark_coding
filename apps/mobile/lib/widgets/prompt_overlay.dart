import 'dart:async';

import 'package:flutter/material.dart';

import '../models/claude_prompt_model.dart';

/// Slides up from the bottom of the terminal screen when a Claude interactive
/// prompt is detected.
///
/// Displays:
///   - Prompt type title and badge
///   - Raw text content (scrollable)
///   - YES/NO action buttons for binary prompts
///   - A multi-line input hint for multiline prompts
///   - A dismiss (X) button
///   - An auto-dismiss countdown (60 seconds)
class PromptOverlay extends StatefulWidget {
  const PromptOverlay({
    super.key,
    required this.prompt,
    required this.onDismiss,
    required this.onSendInput,
  });

  final ClaudePrompt prompt;
  final VoidCallback onDismiss;
  final void Function(String data) onSendInput;

  @override
  State<PromptOverlay> createState() => _PromptOverlayState();
}

class _PromptOverlayState extends State<PromptOverlay>
    with SingleTickerProviderStateMixin {
  late final AnimationController _animController;
  late final Animation<Offset> _slideAnimation;

  Timer? _countdownTimer;
  int _remainingSeconds = 60;

  // For multiline input mode
  final _multilineController = TextEditingController();

  @override
  void initState() {
    super.initState();

    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );

    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, 1),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _animController,
      curve: Curves.easeOutCubic,
    ));

    _animController.forward();
    _startCountdown();
  }

  @override
  void didUpdateWidget(PromptOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.prompt != widget.prompt) {
      // New prompt received — reset countdown.
      _countdownTimer?.cancel();
      _remainingSeconds = 60;
      _animController.forward(from: 0);
      _startCountdown();
    }
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _animController.dispose();
    _multilineController.dispose();
    super.dispose();
  }

  void _startCountdown() {
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() {
        _remainingSeconds--;
        if (_remainingSeconds <= 0) {
          timer.cancel();
          widget.onDismiss();
        }
      });
    });
  }

  Future<void> _dismiss() async {
    _countdownTimer?.cancel();
    await _animController.reverse();
    widget.onDismiss();
  }

  void _sendResponse(String data) {
    widget.onSendInput(data);
    _dismiss();
  }

  void _sendMultilineInput() {
    final text = _multilineController.text.trim();
    if (text.isEmpty) return;
    _sendResponse('$text\r');
  }

  @override
  Widget build(BuildContext context) {
    return SlideTransition(
      position: _slideAnimation,
      child: _buildCard(context),
    );
  }

  Widget _buildCard(BuildContext context) {
    final prompt = widget.prompt;

    return Material(
      color: Colors.transparent,
      child: Container(
        margin: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A1A),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: _borderColorForType(prompt.promptType)),
          boxShadow: const [
            BoxShadow(
              color: Colors.black54,
              blurRadius: 20,
              offset: Offset(0, -4),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildHeader(prompt),
            const Divider(color: Color(0xFF2A2A2A), height: 1),
            _buildContent(prompt),
            const Divider(color: Color(0xFF2A2A2A), height: 1),
            _buildActions(prompt),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(ClaudePrompt prompt) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          Icon(
            _iconForType(prompt.promptType),
            size: 18,
            color: _accentColorForType(prompt.promptType),
          ),
          const SizedBox(width: 8),
          Text(
            prompt.promptType.displayName.toUpperCase(),
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: 11,
              fontWeight: FontWeight.bold,
              letterSpacing: 1.5,
              color: _accentColorForType(prompt.promptType),
            ),
          ),
          const Spacer(),
          // Countdown badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: const Color(0xFF2A2A2A),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              '${_remainingSeconds}s',
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 10,
                color: Color(0xFF9E9E9E),
              ),
            ),
          ),
          const SizedBox(width: 8),
          InkWell(
            onTap: _dismiss,
            borderRadius: BorderRadius.circular(20),
            child: const Padding(
              padding: EdgeInsets.all(4),
              child: Icon(
                Icons.close,
                size: 18,
                color: Color(0xFF9E9E9E),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildContent(ClaudePrompt prompt) {
    // Strip ANSI escape sequences for display in the overlay.
    final cleanText = _stripAnsi(prompt.rawText);

    return Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 120),
            child: SingleChildScrollView(
              child: Text(
                cleanText.isEmpty ? '(no additional context)' : cleanText,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: Color(0xFFCCCCCC),
                  height: 1.5,
                ),
              ),
            ),
          ),

          // Multi-line input field
          if (prompt.promptType.requiresMultilineInput) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _multilineController,
              maxLines: 3,
              minLines: 2,
              autofocus: true,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 13,
                color: Color(0xFFE0E0E0),
              ),
              decoration: const InputDecoration(
                hintText: 'Type your multi-line input here…',
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                isDense: true,
              ),
              textCapitalization: TextCapitalization.none,
              autocorrect: false,
              enableSuggestions: false,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildActions(ClaudePrompt prompt) {
    if (prompt.promptType.requiresYesNo) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => _sendResponse('n\r'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFFF5252),
                  side: const BorderSide(color: Color(0xFFFF5252)),
                  padding: const EdgeInsets.symmetric(vertical: 10),
                ),
                child: const Text(
                  'NO',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1.5,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton(
                onPressed: () => _sendResponse('y\r'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00FF41),
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 10),
                ),
                child: const Text(
                  'YES',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1.5,
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    }

    if (prompt.promptType.requiresMultilineInput) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            OutlinedButton(
              onPressed: _dismiss,
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF9E9E9E),
                side: const BorderSide(color: Color(0xFF404040)),
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 10,
                ),
              ),
              child: const Text(
                'CANCEL',
                style: TextStyle(fontFamily: 'monospace', letterSpacing: 1),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton(
                onPressed: _sendMultilineInput,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00FF41),
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 10),
                ),
                child: const Text(
                  'SEND',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1.5,
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    }

    // General / slash command hint: just a dismiss button.
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: OutlinedButton(
        onPressed: _dismiss,
        style: OutlinedButton.styleFrom(
          foregroundColor: const Color(0xFF9E9E9E),
          side: const BorderSide(color: Color(0xFF404040)),
          padding: const EdgeInsets.symmetric(vertical: 10),
        ),
        child: const Text(
          'DISMISS',
          style: TextStyle(fontFamily: 'monospace', letterSpacing: 1.5),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  Color _borderColorForType(ClaudePromptType type) {
    switch (type) {
      case ClaudePromptType.permissionRequest:
      case ClaudePromptType.toolUseApproval:
        return const Color(0xFFFFB300);
      case ClaudePromptType.yesNoConfirm:
        return const Color(0xFF448AFF);
      case ClaudePromptType.multilineInput:
        return const Color(0xFF00FF41);
      default:
        return const Color(0xFF404040);
    }
  }

  Color _accentColorForType(ClaudePromptType type) {
    switch (type) {
      case ClaudePromptType.permissionRequest:
      case ClaudePromptType.toolUseApproval:
        return const Color(0xFFFFB300);
      case ClaudePromptType.yesNoConfirm:
        return const Color(0xFF448AFF);
      case ClaudePromptType.multilineInput:
        return const Color(0xFF00FF41);
      default:
        return const Color(0xFF9E9E9E);
    }
  }

  IconData _iconForType(ClaudePromptType type) {
    switch (type) {
      case ClaudePromptType.permissionRequest:
        return Icons.security;
      case ClaudePromptType.yesNoConfirm:
        return Icons.help_outline;
      case ClaudePromptType.toolUseApproval:
        return Icons.build_circle_outlined;
      case ClaudePromptType.multilineInput:
        return Icons.edit_note;
      case ClaudePromptType.slashCommandHint:
        return Icons.code;
      default:
        return Icons.chat_bubble_outline;
    }
  }

  /// Strips ANSI escape sequences from [text] for clean display.
  static String _stripAnsi(String text) {
    // Matches ESC[ sequences and single-character ESC sequences.
    return text.replaceAll(
      RegExp(r'\x1B(?:\[[0-9;]*[A-Za-z]|[^[\x1B])'),
      '',
    );
  }
}
