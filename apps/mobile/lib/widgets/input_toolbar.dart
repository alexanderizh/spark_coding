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
  const InputToolbar({super.key, required this.onSendInput});

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
    _QuickAction(label: 'y', data: 'y\r', tooltip: '发送 "y" (是)'),
    _QuickAction(label: 'n', data: 'n\r', tooltip: '发送 "n" (否)'),
    _QuickAction(label: 'Ctrl+C', data: '\x03', tooltip: '中断 (Ctrl+C)'),
    _QuickAction(label: 'Ctrl+D', data: '\x04', tooltip: 'EOF / 退出 (Ctrl+D)'),
    _QuickAction(label: 'Tab', data: '\t', tooltip: 'Tab 补全'),
    _QuickAction(label: '↑', data: '\x1b[A', tooltip: '向上箭头'),
    _QuickAction(label: '↓', data: '\x1b[B', tooltip: '向下箭头'),
    _QuickAction(label: 'Esc', data: '\x1b', tooltip: 'Esc 键'),
    _QuickAction(label: '/clear', data: '/clear\r', tooltip: '清除上下文'),
    _QuickAction(label: '/help', data: '/help\r', tooltip: '显示帮助'),
    _QuickAction(label: '/compact', data: '/compact\r', tooltip: '压缩输出'),
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
        color: Colors.white,
        border: Border(top: BorderSide(color: Color(0xFFEEEEEE))),
        boxShadow: [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 4,
            offset: Offset(0, -2),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [_buildQuickActionRow(), _buildInputRow()],
      ),
    );
  }

  Widget _buildQuickActionRow() {
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
        itemCount: _quickActions.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
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
        left: 16,
        right: 16,
        top: 8,
        bottom: MediaQuery.of(context).padding.bottom + 8,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          // Multi-line toggle button
          _ToolbarIconButton(
            icon: _multilineMode ? Icons.unfold_less : Icons.unfold_more,
            tooltip: _multilineMode ? '单行模式' : '多行模式',
            isActive: _multilineMode,
            onTap: _toggleMultiline,
          ),
          const SizedBox(width: 8),

          // Text input field (Chat style)
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: const Color(0xFFF5F5F5),
                borderRadius: BorderRadius.circular(24),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _textController,
                focusNode: _focusNode,
                maxLines: _multilineMode ? 4 : 1,
                minLines: 1,
                style: const TextStyle(fontSize: 14, color: Colors.black),
                decoration: const InputDecoration(
                  hintText: '输入命令或消息...',
                  hintStyle: TextStyle(color: Colors.grey),
                  border: InputBorder.none,
                  contentPadding: EdgeInsets.symmetric(vertical: 10),
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
          ),
          const SizedBox(width: 8),

          // Send button
          _ToolbarIconButton(
            icon: Icons.send,
            tooltip: '发送',
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
  const _QuickActionChip({required this.action, required this.onTap});

  final _QuickAction action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: action.tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          decoration: BoxDecoration(
            color: const Color(0xFFF0F0F0),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFE0E0E0)),
          ),
          child: Text(
            action.label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: Colors.black87,
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
        ? Colors.black
        : isActive
        ? Colors.black12
        : Colors.transparent;

    final iconColor = isPrimary
        ? Colors.white
        : isActive
        ? Colors.black
        : Colors.grey;

    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
          child: Icon(icon, size: 20, color: iconColor),
        ),
      ),
    );
  }
}
