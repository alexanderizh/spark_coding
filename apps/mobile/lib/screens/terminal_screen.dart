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

// ---------------------------------------------------------------------------
// Turn model
// ---------------------------------------------------------------------------

enum _TurnRole { user, claude }

class _Turn {
  _Turn({
    required this.role,
    required this.text,
    this.promptType,
    this.promptResolved = false,
  });

  final _TurnRole role;
  String text;
  final ClaudePromptType? promptType;
  bool promptResolved;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

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
  final ClaudeChatParser _chatParser = ClaudeChatParser();
  final Map<int, TerminalOutput> _pendingOutputs = {};
  int _lastOutputSeq = -1;
  final List<_Turn> _turns = [];
  bool _isClaudeStreaming = false;
  bool _isTyping = false;
  bool _runtimeEnsuring = false;

  @override
  void initState() {
    super.initState();
    _listenForErrors();
    _listenForOutput();
    _listenForPrompts();
    _listenForRuntime();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final session = ref.read(sessionProvider);
      if (session?.agentConnected == true) _ensureRuntime();
    });
  }

  @override
  void dispose() {
    _errorSub?.cancel();
    _outputSub?.cancel();
    _promptSub?.cancel();
    _runtimeSub?.cancel();
    _scrollController.dispose();
    super.dispose();
  }

  void _listenForErrors() {
    final socketService = ref.read(socketServiceProvider);
    _errorSub = socketService.sessionErrors.listen((error) {
      AppLogger.error('TerminalScreen', '收到服务端 session 错误', error.message);
      if (!mounted) return;
      if (_runtimeEnsuring) setState(() { _runtimeEnsuring = false; });
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
    if (!mounted) return;
    setState(() {
      if (_isClaudeStreaming &&
          _turns.isNotEmpty &&
          _turns.last.role == _TurnRole.claude &&
          _turns.last.promptType == null) {
        _turns.last.text = clean; // replace in-place
      } else {
        _turns.add(_Turn(role: _TurnRole.claude, text: clean));
        _isClaudeStreaming = true;
      }
    });
    _scrollToBottom();
  }

  void _listenForPrompts() {
    final socketService = ref.read(socketServiceProvider);
    _promptSub = socketService.claudePrompts.listen((prompt) {
      final displayText = _chatParser.formatPromptText(
        type: prompt.promptType,
        rawText: prompt.rawText,
        fallbackTitle: _promptTitle(prompt.promptType),
      );
      if (!mounted) return;
      setState(() {
        _isClaudeStreaming = false;
        _turns.add(_Turn(
          role: _TurnRole.claude,
          text: displayText,
          promptType: prompt.promptType.requiresYesNo ? prompt.promptType : null,
        ));
      });
      _scrollToBottom();
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
    if (!mounted) return;
    setState(() {
      _isClaudeStreaming = false;
      _turns.add(_Turn(role: _TurnRole.user, text: text));
    });
    _scrollToBottom();
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

  void _sendPromptDecision({required _Turn turn, required bool approved}) {
    final socketService = ref.read(socketServiceProvider);
    _chatParser.registerUserInput(approved ? 'y' : 'n');
    socketService.sendInput(approved ? 'y\r' : 'n\r');
    if (!mounted) return;
    setState(() {
      turn.promptResolved = true;
      _isClaudeStreaming = false;
      _turns.add(_Turn(role: _TurnRole.user, text: approved ? '同意' : '拒绝'));
    });
    _scrollToBottom();
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

  ConnectionStatus _getEffectiveStatus(
    ConnectionStatus socketStatus,
    SessionModel? session,
  ) {
    if (socketStatus != ConnectionStatus.connected) {
      return socketStatus;
    }
    if (session == null) {
      return ConnectionStatus.connecting;
    }

    if (session.agentConnected) {
      return ConnectionStatus.connected;
    }

    switch (session.state) {
      case SessionState.agentDisconnected:
      case SessionState.expired:
        return ConnectionStatus.disconnected;
      case SessionState.error:
        return ConnectionStatus.error;
      case SessionState.waitingForAgent:
      case SessionState.waitingForMobile:
      case SessionState.unknown:
      default:
        return ConnectionStatus.connecting;
    }
  }

  Widget _buildTurn(_Turn turn) {
    if (turn.role == _TurnRole.user) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '❯  ',
              style: TextStyle(
                color: Color(0xFF9E9E9E),
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
            Expanded(
              child: Text(
                turn.text,
                style: const TextStyle(
                  color: Color(0xFF616161),
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ),
      );
    }

    // Claude turn
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            turn.text,
            style: const TextStyle(
              color: Colors.black87,
              fontSize: 14,
              height: 1.6,
            ),
          ),
          if (turn.promptType != null && !turn.promptResolved) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () =>
                        _sendPromptDecision(turn: turn, approved: false),
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
                    onPressed: () =>
                        _sendPromptDecision(turn: turn, approved: true),
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
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final connectionState = ref.watch(connectionNotifierProvider);
    final session = ref.watch(sessionProvider);
    final connectionStatus = connectionState.status;
    final effectiveStatus = _getEffectiveStatus(connectionStatus, session);

    ref.listen<SessionModel?>(sessionProvider, (prev, next) {
      if (next?.agentConnected == true && prev?.agentConnected != true) {
        _ensureRuntime();
      }
    });
    final showBanner =
        connectionStatus == ConnectionStatus.disconnected ||
        connectionStatus == ConnectionStatus.error;

    return Scaffold(
      backgroundColor: const Color(0xFFECEFF3),
      appBar: _buildAppBar(
        context,
        effectiveStatus,
        session: session,
        isTyping: _isTyping,
        runtimeEnsuring: _runtimeEnsuring,
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
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.fromLTRB(0, 12, 0, 12),
              itemCount: _turns.isEmpty ? 1 : _turns.length,
              itemBuilder: (context, index) {
                if (_turns.isEmpty) {
                  return const Padding(
                    padding: EdgeInsets.only(top: 80),
                    child: Center(
                      child: Column(
                        children: [
                          Icon(Icons.terminal, color: Colors.black26, size: 28),
                          SizedBox(height: 8),
                          Text(
                            '开始对话',
                            style: TextStyle(
                              color: Colors.black38,
                              fontSize: 13,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }
                return _buildTurn(_turns[index]);
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
    required SessionModel? session,
    required bool isTyping,
    required bool runtimeEnsuring,
  }) {
    final hostName = _resolveHostName(session?.agentHostname);
    final agentConnected = session?.agentConnected ?? false;

    Widget? statusLine;
    if (runtimeEnsuring) {
      statusLine = const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 10,
            height: 10,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              valueColor: AlwaysStoppedAnimation<Color>(Color(0xFFE6831A)),
            ),
          ),
          SizedBox(width: 5),
          Text(
            '正在检查 Claude...',
            style: TextStyle(
              fontSize: 11,
              color: Color(0xFFE6831A),
              fontWeight: FontWeight.normal,
            ),
          ),
        ],
      );
    } else if (agentConnected) {
      statusLine = const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.circle, size: 7, color: Color(0xFF2E7D32)),
          SizedBox(width: 4),
          Text(
            'Claude 运行中',
            style: TextStyle(
              fontSize: 11,
              color: Color(0xFF2E7D32),
              fontWeight: FontWeight.normal,
            ),
          ),
        ],
      );
    }

    return AppBar(
      backgroundColor: Colors.white,
      foregroundColor: Colors.black,
      centerTitle: false,
      titleSpacing: 0,
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
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: Text(
                  hostName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 16),
                ),
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
          if (statusLine != null) ...[
            const SizedBox(height: 1),
            statusLine,
          ],
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

// ---------------------------------------------------------------------------
// Typing indicator widget
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

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
