import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

typedef InputCallback = void Function(String data);

/// A persistent toolbar attached to the bottom of the terminal screen.
///
/// Contains:
///   - A horizontally scrollable row of quick-action chips.
///   - A text input field with a Send button.
///   - A "Multi-line" toggle that expands the input to a multi-line area.
class InputToolbar extends StatefulWidget {
  const InputToolbar({
    super.key,
    required this.onSendInput,
  });

  final InputCallback onSendInput;

  @override
  State<InputToolbar> createState() => _InputToolbarState();
}

class _InputToolbarState extends State<InputToolbar> {
  final _textController = TextEditingController();
  final _focusNode = FocusNode();
  bool _multilineMode = false;

  @override
  void dispose() {
    _textController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // Quick action definitions
  // ---------------------------------------------------------------------------

  List<_QuickAction> get _quickActions => [
        _QuickAction(label: 'y', data: 'y\r', tooltip: 'Send "y" (yes)'),
        _QuickAction(label: 'n', data: 'n\r', tooltip: 'Send "n" (no)'),
        _QuickAction(
          label: 'Ctrl+C',
          data: '\x03',
          tooltip: 'Interrupt (Ctrl+C)',
        ),
        _QuickAction(
          label: 'Ctrl+D',
          data: '\x04',
          tooltip: 'EOF / logout (Ctrl+D)',
        ),
        _QuickAction(label: 'Tab', data: '\t', tooltip: 'Tab completion'),
        _QuickAction(label: '↑', data: '\x1b[A', tooltip: 'Arrow up'),
        _QuickAction(label: '↓', data: '\x1b[B', tooltip: 'Arrow down'),
        _QuickAction(label: 'Esc', data: '\x1b', tooltip: 'Escape'),
        _QuickAction(
          label: '/clear',
          data: '/clear\r',
          tooltip: 'Clear Claude context',
        ),
        _QuickAction(
          label: '/help',
          data: '/help\r',
          tooltip: 'Show Claude help',
        ),
        _QuickAction(
          label: '/compact',
          data: '/compact\r',
          tooltip: 'Compact Claude output',
        ),
      ];

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  void _sendQuickAction(_QuickAction action) {
    widget.onSendInput(action.data);
    HapticFeedback.selectionClick();
  }

  void _sendTextInput() {
    final text = _textController.text;
    if (text.isEmpty) return;

    if (_multilineMode) {
      // In multi-line mode, send the text followed by a carriage return.
      widget.onSendInput('$text\r');
    } else {
      widget.onSendInput('$text\r');
    }

    _textController.clear();
    _focusNode.requestFocus();
  }

  void _toggleMultiline() {
    setState(() {
      _multilineMode = !_multilineMode;
    });
    _focusNode.requestFocus();
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF111111),
        border: Border(
          top: BorderSide(color: Color(0xFF2A2A2A)),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildQuickActionRow(),
          _buildInputRow(),
        ],
      ),
    );
  }

  Widget _buildQuickActionRow() {
    return SizedBox(
      height: 36,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        itemCount: _quickActions.length,
        separatorBuilder: (_, __) => const SizedBox(width: 6),
        itemBuilder: (context, index) {
          final action = _quickActions[index];
          return _QuickActionChip(
            action: action,
            onTap: () => _sendQuickAction(action),
          );
        },
      ),
    );
  }

  Widget _buildInputRow() {
    return Padding(
      padding: EdgeInsets.only(
        left: 8,
        right: 8,
        top: 4,
        bottom: MediaQuery.of(context).padding.bottom + 4,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          // Multi-line toggle button
          _ToolbarIconButton(
            icon: _multilineMode ? Icons.unfold_less : Icons.unfold_more,
            tooltip: _multilineMode ? 'Single line' : 'Multi-line input',
            isActive: _multilineMode,
            onTap: _toggleMultiline,
          ),
          const SizedBox(width: 6),

          // Text input field
          Expanded(
            child: TextField(
              controller: _textController,
              focusNode: _focusNode,
              maxLines: _multilineMode ? 4 : 1,
              minLines: 1,
              style: const TextStyle(
                fontFamily: 'monospace',
                fontSize: 13,
                color: Color(0xFFE0E0E0),
              ),
              decoration: const InputDecoration(
                hintText: 'Enter command or message…',
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                isDense: true,
              ),
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _sendTextInput(),
              keyboardType: _multilineMode
                  ? TextInputType.multiline
                  : TextInputType.text,
              textCapitalization: TextCapitalization.none,
              autocorrect: false,
              enableSuggestions: false,
            ),
          ),
          const SizedBox(width: 6),

          // Send button
          _ToolbarIconButton(
            icon: Icons.send,
            tooltip: 'Send',
            onTap: _sendTextInput,
            isPrimary: true,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Supporting widgets
// ---------------------------------------------------------------------------

class _QuickAction {
  const _QuickAction({
    required this.label,
    required this.data,
    required this.tooltip,
  });

  final String label;
  final String data;
  final String tooltip;
}

class _QuickActionChip extends StatelessWidget {
  const _QuickActionChip({
    required this.action,
    required this.onTap,
  });

  final _QuickAction action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: action.tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(4),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: const Color(0xFF2A2A2A),
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: const Color(0xFF404040)),
          ),
          child: Text(
            action.label,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 12,
              color: Color(0xFFE0E0E0),
            ),
          ),
        ),
      ),
    );
  }
}

class _ToolbarIconButton extends StatelessWidget {
  const _ToolbarIconButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.isActive = false,
    this.isPrimary = false,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final bool isActive;
  final bool isPrimary;

  @override
  Widget build(BuildContext context) {
    final bg = isPrimary
        ? const Color(0xFF00FF41)
        : isActive
            ? const Color(0xFF003300)
            : const Color(0xFF2A2A2A);

    final iconColor = isPrimary
        ? Colors.black
        : isActive
            ? const Color(0xFF00FF41)
            : const Color(0xFF9E9E9E);

    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(4),
        child: Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(
              color: isPrimary
                  ? const Color(0xFF00FF41)
                  : const Color(0xFF404040),
            ),
          ),
          child: Icon(icon, size: 18, color: iconColor),
        ),
      ),
    );
  }
}
