import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

typedef MessageCallback = void Function(String text);

class InputToolbar extends StatefulWidget {
  const InputToolbar({
    super.key,
    required this.onSendMessage,
    this.onTypingChanged,
  });

  final MessageCallback onSendMessage;
  final ValueChanged<bool>? onTypingChanged;

  @override
  State<InputToolbar> createState() => _InputToolbarState();
}

class _InputToolbarState extends State<InputToolbar> {
  final _textController = TextEditingController();
  final _focusNode = FocusNode();
  bool _hasText = false;
  final List<({String command, String title, String desc})> _commands = const [
    (command: '/help', title: '帮助', desc: '查看可用命令'),
    (command: '/clear', title: '清空上下文', desc: '清除当前会话上下文'),
    (command: '/compact', title: '压缩输出', desc: '减少冗余输出内容'),
    (command: '/status', title: '状态', desc: '查看当前会话与连接状态'),
    (command: '/config', title: '配置', desc: '查看当前运行配置'),
    (command: '/model', title: '模型', desc: '查看或切换当前模型'),
    (command: '/resume', title: '恢复会话', desc: '恢复最近一次会话上下文'),
    (command: '/cost', title: '成本统计', desc: '查看当前会话 token 消耗'),
    (command: '/memory', title: '记忆状态', desc: '查看当前记忆上下文'),
    (command: '/permissions', title: '权限设置', desc: '查看工具权限状态'),
    (command: '/review', title: '代码审查', desc: '让 Claude 审查当前改动'),
    (command: '/init', title: '初始化', desc: '初始化当前工作区能力'),
  ];

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_handleFocusChanged);
  }

  Future<void> _handleFocusChanged() async {
    if (_focusNode.hasFocus) return;
    await SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
  }

  @override
  void dispose() {
    _focusNode.removeListener(_handleFocusChanged);
    _textController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _send() {
    final text = _textController.text.trim();
    if (text.isEmpty) return;
    widget.onSendMessage(text);
    _textController.clear();
    setState(() => _hasText = false);
    widget.onTypingChanged?.call(false);
    HapticFeedback.selectionClick();
    _focusNode.requestFocus();
  }

  Future<void> _showCommandSheet() async {
    FocusScope.of(context).unfocus();
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        return SafeArea(
          top: false,
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.of(context).size.height * 0.8,
            ),
            child: SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 8, 12),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 36,
                      height: 4,
                      margin: const EdgeInsets.only(bottom: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFFDEDEDE),
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    ..._commands.map(
                      (item) => ListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 12),
                        title: Text(
                          item.title,
                          style: const TextStyle(
                            color: Colors.black87,
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: Text(
                          '${item.command} · ${item.desc}',
                          style: const TextStyle(
                            color: Colors.black54,
                            fontSize: 12,
                          ),
                        ),
                        trailing: const Icon(
                          Icons.chevron_right,
                          color: Colors.black38,
                        ),
                        onTap: () => Navigator.of(context).pop(item.command),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
    if (selected == null || selected.isEmpty) return;
    widget.onSendMessage(selected);
    widget.onTypingChanged?.call(false);
    await HapticFeedback.selectionClick();
    _focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFFF7F7F7),
        border: Border(top: BorderSide(color: Color(0xFFE5E5E5))),
      ),
      padding: EdgeInsets.only(
        left: 10,
        right: 10,
        top: 8,
        bottom: MediaQuery.of(context).padding.bottom + 8,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          IconButton(
            onPressed: _showCommandSheet,
            icon: const Icon(Icons.terminal, color: Colors.black54),
            splashRadius: 22,
            tooltip: '命令',
          ),
          Expanded(
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              curve: Curves.easeOutCubic,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(22),
                border: Border.all(color: const Color(0xFFE0E0E0)),
              ),
              child: TextField(
                controller: _textController,
                focusNode: _focusNode,
                minLines: 1,
                maxLines: 12,
                textInputAction: TextInputAction.newline,
                onSubmitted: (_) => _send(),
                onTapOutside: (_) => _focusNode.unfocus(),
                onChanged: (value) {
                  final next = value.trim().isNotEmpty;
                  if (next != _hasText) {
                    setState(() => _hasText = next);
                    widget.onTypingChanged?.call(next);
                  }
                },
                decoration: const InputDecoration(
                  hintText: '输入消息',
                  filled: false,
                  fillColor: Colors.transparent,
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  disabledBorder: InputBorder.none,
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(vertical: 10),
                ),
                style: const TextStyle(fontSize: 15, color: Colors.black87),
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 42,
            height: 42,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: _hasText ? Colors.black : const Color(0xFF9E9E9E),
                shape: BoxShape.circle,
              ),
              child: IconButton(
                onPressed: _hasText ? _send : null,
                icon: Icon(_hasText ? Icons.send_rounded : Icons.mic_none),
                color: Colors.white,
                splashRadius: 20,
                tooltip: _hasText ? '发送' : '语音',
              ),
            ),
          ),
        ],
      ),
    );
  }
}
