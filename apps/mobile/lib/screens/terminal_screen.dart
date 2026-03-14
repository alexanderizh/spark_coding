import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../models/claude_prompt_model.dart';
import '../models/session_model.dart';
import '../providers/connection_provider.dart';
import '../providers/session_provider.dart';
import '../services/socket_service.dart';
import '../utils/app_logger.dart';
import '../utils/claude_chat_parser.dart';
import '../widgets/connection_badge.dart';
import '../widgets/input_toolbar.dart';

class TerminalScreen extends ConsumerStatefulWidget {
  const TerminalScreen({super.key});

  @override
  ConsumerState<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends ConsumerState<TerminalScreen> {
  StreamSubscription<SessionError>? _errorSub;
  StreamSubscription<TerminalOutput>? _outputSub;
  StreamSubscription<ClaudePrompt>? _promptSub;
  StreamSubscription<RuntimeStatusEvent>? _runtimeSub;
  final ScrollController _scrollController = ScrollController();
  final StringBuffer _assistantBuffer = StringBuffer();
  final ClaudeChatParser _chatParser = ClaudeChatParser();
  final Map<int, TerminalOutput> _pendingOutputs = {};
  Timer? _assistantFlushTimer;
  int _messageSeed = 0;
  int _lastOutputSeq = -1;
  final List<_ChatMessage> _messages = [];
  bool _isTyping = false;
  bool _runtimeEnsuring = true;

  @override
  void initState() {
    super.initState();
    _listenForErrors();
    _listenForOutput();
    _listenForPrompts();
    _listenForRuntime();
    _ensureRuntime();
  }

  @override
  void dispose() {
    _errorSub?.cancel();
    _outputSub?.cancel();
    _promptSub?.cancel();
    _runtimeSub?.cancel();
    _assistantFlushTimer?.cancel();
    _scrollController.dispose();
    super.dispose();
  }

  void _listenForErrors() {
    final socketService = ref.read(socketServiceProvider);
    _errorSub = socketService.sessionErrors.listen((error) {
      AppLogger.error('TerminalScreen', '收到服务端 session 错误', error.message);
      if (!mounted) return;
      _showSessionError(error.message);
    });
  }

  void _listenForOutput() {
    final socketService = ref.read(socketServiceProvider);
    _outputSub = socketService.terminalOutput.listen(_handleTerminalOutput);
  }

  void _handleTerminalOutput(TerminalOutput output) {
    final expectedSeq = _lastOutputSeq + 1;
    if (_lastOutputSeq == -1 || output.seq == expectedSeq) {
      _ingestOutputChunk(output);
      var currentSeq = output.seq;
      while (_pendingOutputs.containsKey(currentSeq + 1)) {
        currentSeq += 1;
        final buffered = _pendingOutputs.remove(currentSeq)!;
        _ingestOutputChunk(buffered);
      }
      _lastOutputSeq = currentSeq;
      return;
    }
    if (output.seq > expectedSeq) {
      _pendingOutputs[output.seq] = output;
    }
  }

  void _ingestOutputChunk(TerminalOutput output) {
    final clean = _chatParser.parseAssistantChunk(output.data);
    if (clean == null || clean.isEmpty) return;
    if (_assistantBuffer.isNotEmpty) _assistantBuffer.writeln();
    _assistantBuffer.write(clean);
    _assistantFlushTimer?.cancel();
    _assistantFlushTimer = Timer(
      const Duration(milliseconds: 220),
      _flushAssistantBuffer,
    );
  }

  void _listenForPrompts() {
    final socketService = ref.read(socketServiceProvider);
    _promptSub = socketService.claudePrompts.listen((prompt) {
      final displayText = _chatParser.formatPromptText(
        type: prompt.promptType,
        rawText: prompt.rawText,
        fallbackTitle: _promptTitle(prompt.promptType),
      );
      _appendMessage(
        _ChatMessage(
          id: _nextMessageId(),
          role: _ChatRole.assistant,
          text: displayText,
          time: DateTime.now(),
          promptType: prompt.promptType.requiresYesNo
              ? prompt.promptType
              : null,
        ),
      );
    });
  }

  void _listenForRuntime() {
    final socketService = ref.read(socketServiceProvider);
    _runtimeSub = socketService.runtimeStatus.listen((event) {
      final session = ref.read(sessionProvider);
      if (session == null || event.sessionId != session.sessionId) return;
      if (!mounted) return;
      setState(() {
        _runtimeEnsuring = false;
      });
      if (!event.ready) {
        _showSessionError(event.message ?? 'Claude 启动失败');
      }
    });
  }

  void _ensureRuntime() {
    final socketService = ref.read(socketServiceProvider);
    setState(() {
      _runtimeEnsuring = true;
    });
    socketService.sendRuntimeEnsure('claude');
  }

  String _nextMessageId() {
    _messageSeed += 1;
    return '${DateTime.now().microsecondsSinceEpoch}_$_messageSeed';
  }

  void _flushAssistantBuffer() {
    final text = _assistantBuffer.toString().trim();
    _assistantBuffer.clear();
    if (text.isEmpty) return;
    final now = DateTime.now();
    if (_messages.isNotEmpty &&
        _messages.last.role == _ChatRole.assistant &&
        _messages.last.promptType == null &&
        now.difference(_messages.last.time).inSeconds <= 1) {
      setState(() {
        final last = _messages.removeLast();
        _messages.add(last.copyWith(text: '${last.text}\n$text', time: now));
      });
      _scrollToBottom();
      return;
    }
    _appendMessage(
      _ChatMessage(
        id: _nextMessageId(),
        role: _ChatRole.assistant,
        text: text,
        time: now,
      ),
    );
  }

  void _appendMessage(_ChatMessage message) {
    if (!mounted) return;
    setState(() => _messages.add(message));
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOut,
      );
    });
  }

  void _sendMessage(String text) {
    final socketService = ref.read(socketServiceProvider);
    _chatParser.registerUserInput(text);
    socketService.sendInput('$text\r');
    _appendMessage(
      _ChatMessage(
        id: _nextMessageId(),
        role: _ChatRole.user,
        text: text,
        time: DateTime.now(),
      ),
    );
  }

  void _handleTypingChanged(bool isTyping) {
    if (_isTyping == isTyping) return;
    setState(() => _isTyping = isTyping);
  }

  String _resolveHostName(String? agentHostname) {
    final name = agentHostname?.trim() ?? '';
    if (name.isEmpty) return '主机名获取中';
    return name;
  }

  void _sendPromptDecision({
    required _ChatMessage message,
    required bool approved,
  }) {
    final socketService = ref.read(socketServiceProvider);
    _chatParser.registerUserInput(approved ? 'y' : 'n');
    socketService.sendInput(approved ? 'y\r' : 'n\r');
    setState(() {
      final index = _messages.indexWhere((item) => item.id == message.id);
      if (index >= 0) {
        _messages[index] = _messages[index].copyWith(promptResolved: true);
      }
    });
    _appendMessage(
      _ChatMessage(
        id: _nextMessageId(),
        role: _ChatRole.user,
        text: approved ? '同意' : '拒绝',
        time: DateTime.now(),
      ),
    );
  }

  void _showSessionError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('服务端: $message'),
        backgroundColor: const Color(0xFFD32F2F),
        duration: const Duration(seconds: 5),
        action: SnackBarAction(
          label: '忽略',
          textColor: Colors.white,
          onPressed: () => ScaffoldMessenger.of(context).hideCurrentSnackBar(),
        ),
      ),
    );
  }

  Future<void> _reconnect() async {
    AppLogger.info('TerminalScreen', '用户点击重试重连');
    final session = ref.read(sessionProvider);
    if (session == null) {
      AppLogger.warn('TerminalScreen', '无 session，返回首页');
      context.go(AppRoutes.home);
      return;
    }

    AppLogger.info('TerminalScreen', '重连会话，sessionId: ${session.sessionId}');
    await ref
        .read(connectionNotifierProvider.notifier)
        .connect(
          serverUrl: session.serverUrl,
          token: session.token,
          sessionId: session.sessionId,
        );
    _ensureRuntime();
  }

  Future<void> _disconnect() async {
    await ref.read(connectionNotifierProvider.notifier).disconnect();
    if (!mounted) return;
    context.go(AppRoutes.home);
  }

  @override
  Widget build(BuildContext context) {
    final connectionState = ref.watch(connectionNotifierProvider);
    final session = ref.watch(sessionProvider);
    final connectionStatus = connectionState.status;
    final showBanner =
        connectionStatus == ConnectionStatus.disconnected ||
        connectionStatus == ConnectionStatus.error;

    return Scaffold(
      backgroundColor: const Color(0xFFECEFF3),
      appBar: _buildAppBar(
        context,
        connectionStatus,
        hostName: _resolveHostName(session?.agentHostname),
        isTyping: _isTyping,
      ),
      body: Column(
        children: [
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 250),
            child: showBanner
                ? _ReconnectBanner(
                    key: const ValueKey('reconnect_banner'),
                    onReconnect: _reconnect,
                    onDisconnect: _disconnect,
                    isError: connectionStatus == ConnectionStatus.error,
                    errorMessage: connectionState.errorMessage,
                  )
                : const SizedBox.shrink(key: ValueKey('no_banner')),
          ),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 180),
            child: _runtimeEnsuring
                ? Container(
                    key: const ValueKey('runtime_loading'),
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    color: const Color(0xFFFFF3E0),
                    child: const Text(
                      '正在检查 Claude 运行状态...',
                      style: TextStyle(fontSize: 12),
                    ),
                  )
                : const SizedBox.shrink(key: ValueKey('runtime_ready')),
          ),
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
              itemCount: _messages.length + (_messages.isEmpty ? 1 : 0),
              itemBuilder: (context, index) {
                if (_messages.isEmpty) {
                  return const _EmptyChat();
                }
                final message = _messages[index];
                return _ChatBubble(
                  message: message,
                  onDecision: (approved) =>
                      _sendPromptDecision(message: message, approved: approved),
                );
              },
            ),
          ),
          InputToolbar(
            onSendMessage: _sendMessage,
            onTypingChanged: _handleTypingChanged,
          ),
        ],
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(
    BuildContext context,
    ConnectionStatus status, {
    required String hostName,
    required bool isTyping,
  }) {
    return AppBar(
      backgroundColor: Colors.white,
      foregroundColor: Colors.black,
      leading: IconButton(
        icon: const Icon(Icons.arrow_back_ios, size: 18),
        onPressed: () {
          if (context.canPop()) {
            context.pop();
          } else {
            context.go(AppRoutes.home);
          }
        },
        tooltip: '返回',
      ),
      title: Row(
        children: [
          Flexible(
            child: Text(hostName, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 180),
            switchInCurve: Curves.easeOutCubic,
            switchOutCurve: Curves.easeOutCubic,
            child: isTyping
                ? const Padding(
                    key: ValueKey('typing_indicator'),
                    padding: EdgeInsets.only(left: 8),
                    child: _TypingIndicator(),
                  )
                : const SizedBox.shrink(key: ValueKey('typing_none')),
          ),
        ],
      ),
      actions: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
          child: ConnectionBadge(status: status),
        ),
        IconButton(
          icon: const Icon(Icons.settings, size: 20),
          onPressed: () => context.push(AppRoutes.settings),
          tooltip: '设置',
        ),
        const SizedBox(width: 4),
      ],
    );
  }
}

class _TypingIndicator extends StatefulWidget {
  const _TypingIndicator();

  @override
  State<_TypingIndicator> createState() => _TypingIndicatorState();
}

class _TypingIndicatorState extends State<_TypingIndicator>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  double _opacityAt(double begin, double end) {
    final t = _controller.value;
    if (t < begin || t > end) return 0.35;
    final normalized = (t - begin) / (end - begin);
    if (normalized <= 0.5) return 0.35 + normalized * 1.2;
    return 0.95 - (normalized - 0.5) * 1.2;
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 24,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          return Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _dot(_opacityAt(0.0, 0.45)),
              _dot(_opacityAt(0.2, 0.65)),
              _dot(_opacityAt(0.4, 0.85)),
            ],
          );
        },
      ),
    );
  }

  Widget _dot(double opacity) {
    return Opacity(
      opacity: opacity,
      child: Container(
        width: 4,
        height: 4,
        decoration: const BoxDecoration(
          color: Colors.black54,
          shape: BoxShape.circle,
        ),
      ),
    );
  }
}

enum _ChatRole { user, assistant }

class _ChatMessage {
  const _ChatMessage({
    required this.id,
    required this.role,
    required this.text,
    required this.time,
    this.promptType,
    this.promptResolved = false,
  });

  final String id;
  final _ChatRole role;
  final String text;
  final DateTime time;
  final ClaudePromptType? promptType;
  final bool promptResolved;

  _ChatMessage copyWith({String? text, DateTime? time, bool? promptResolved}) {
    return _ChatMessage(
      id: id,
      role: role,
      text: text ?? this.text,
      time: time ?? this.time,
      promptType: promptType,
      promptResolved: promptResolved ?? this.promptResolved,
    );
  }
}

class _EmptyChat extends StatelessWidget {
  const _EmptyChat();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.only(top: 80),
      child: Center(
        child: Column(
          children: [
            Icon(Icons.forum_outlined, color: Colors.black38, size: 32),
            SizedBox(height: 8),
            Text('开始对话', style: TextStyle(color: Colors.black45, fontSize: 14)),
          ],
        ),
      ),
    );
  }
}

class _ChatBubble extends StatelessWidget {
  const _ChatBubble({required this.message, required this.onDecision});

  final _ChatMessage message;
  final ValueChanged<bool> onDecision;

  @override
  Widget build(BuildContext context) {
    final isUser = message.role == _ChatRole.user;
    final radius = BorderRadius.only(
      topLeft: const Radius.circular(14),
      topRight: const Radius.circular(14),
      bottomLeft: Radius.circular(isUser ? 14 : 4),
      bottomRight: Radius.circular(isUser ? 4 : 14),
    );
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 300),
          child: Container(
            decoration: BoxDecoration(
              color: isUser ? Colors.black : Colors.white,
              borderRadius: radius,
              border: isUser
                  ? null
                  : Border.all(color: const Color(0xFFE2E2E2)),
            ),
            padding: const EdgeInsets.fromLTRB(12, 9, 12, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  message.text,
                  style: TextStyle(
                    color: isUser ? Colors.white : Colors.black87,
                    fontSize: 14,
                    height: 1.45,
                  ),
                ),
                if (message.promptType != null && !message.promptResolved) ...[
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => onDecision(false),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            side: const BorderSide(color: Color(0xFFBDBDBD)),
                          ),
                          child: const Text('拒绝'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: () => onDecision(true),
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            backgroundColor: Colors.black,
                            foregroundColor: Colors.white,
                          ),
                          child: const Text('同意'),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 2),
                Align(
                  alignment: Alignment.centerRight,
                  child: Text(
                    _formatTime(message.time),
                    style: TextStyle(
                      color: isUser ? Colors.white70 : Colors.black45,
                      fontSize: 10,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _formatTime(DateTime time) {
  final hh = time.hour.toString().padLeft(2, '0');
  final mm = time.minute.toString().padLeft(2, '0');
  return '$hh:$mm';
}

String _promptTitle(ClaudePromptType type) {
  switch (type) {
    case ClaudePromptType.permissionRequest:
      return '权限请求';
    case ClaudePromptType.yesNoConfirm:
      return '确认请求';
    case ClaudePromptType.toolUseApproval:
      return '工具调用审批';
    case ClaudePromptType.multilineInput:
      return '需要输入内容';
    case ClaudePromptType.slashCommandHint:
      return '命令提示';
    case ClaudePromptType.generalInput:
      return '输入请求';
    case ClaudePromptType.unknown:
      return '提示';
  }
}

// ---------------------------------------------------------------------------
// Reconnect banner widget
// ---------------------------------------------------------------------------

class _ReconnectBanner extends StatefulWidget {
  const _ReconnectBanner({
    super.key,
    required this.onReconnect,
    required this.onDisconnect,
    this.isError = false,
    this.errorMessage,
  });

  final VoidCallback onReconnect;
  final VoidCallback onDisconnect;
  final bool isError;
  final String? errorMessage;

  @override
  State<_ReconnectBanner> createState() => _ReconnectBannerState();
}

class _ReconnectBannerState extends State<_ReconnectBanner> {
  bool _expanded = false;

  String get _displayText =>
      widget.errorMessage ?? (widget.isError ? '连接错误。点击重试。' : '与中继服务器断开连接。');

  Future<void> _copyToClipboard() async {
    await Clipboard.setData(ClipboardData(text: _displayText));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('已复制到剪贴板'),
        backgroundColor: Color(0xFF333333),
        duration: Duration(seconds: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: widget.isError ? const Color(0xFFE57373) : const Color(0xFFFFD54F),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            widget.isError ? Icons.error_outline : Icons.wifi_off,
            size: 18,
            color: Colors.black87,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => setState(() => _expanded = !_expanded),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Tooltip(
                  message: _expanded ? '点击收起' : '点击展开查看详情',
                  child: AnimatedSize(
                    duration: const Duration(milliseconds: 200),
                    curve: Curves.easeOut,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _displayText,
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.black87,
                          ),
                          maxLines: _expanded ? null : 1,
                          overflow: _expanded ? null : TextOverflow.ellipsis,
                        ),
                        if (_expanded)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Row(
                              children: [
                                const Text(
                                  '点击收起',
                                  style: TextStyle(
                                    fontSize: 10,
                                    color: Colors.black54,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                InkWell(
                                  onTap: _copyToClipboard,
                                  child: const Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        Icons.copy,
                                        size: 14,
                                        color: Colors.black54,
                                      ),
                                      SizedBox(width: 4),
                                      Text(
                                        '复制',
                                        style: TextStyle(
                                          fontSize: 10,
                                          color: Colors.black54,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(width: 4),
          InkWell(
            onTap: _copyToClipboard,
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 4, vertical: 8),
              child: Icon(Icons.copy, size: 18, color: Colors.black54),
            ),
          ),
          const SizedBox(width: 4),
          InkWell(
            onTap: widget.onReconnect,
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 4, vertical: 8),
              child: Text(
                '重试',
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.black,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
          const SizedBox(width: 8),
          InkWell(
            onTap: widget.onDisconnect,
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: 4, vertical: 8),
              child: Text(
                '退出',
                style: TextStyle(fontSize: 12, color: Colors.black54),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
