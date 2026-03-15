import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:xterm/xterm.dart';

import '../app/router.dart';
import '../models/claude_prompt_model.dart';
import '../models/session_model.dart';
import '../providers/connection_provider.dart';
import '../providers/session_provider.dart';
import '../services/socket_service.dart';
import '../utils/app_logger.dart';
import '../widgets/connection_badge.dart';
import '../widgets/input_toolbar.dart';

// ---------------------------------------------------------------------------
// Prompt model
// ---------------------------------------------------------------------------

class _PendingPrompt {
  _PendingPrompt({required this.type, required this.rawText});

  final ClaudePromptType type;
  final String rawText;
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
  StreamSubscription<TerminalSnapshot>? _snapshotSub;
  StreamSubscription<ClaudePrompt>? _promptSub;
  StreamSubscription<RuntimeStatusEvent>? _runtimeSub;
  late final Terminal _terminal;
  _PendingPrompt? _pendingPrompt;
  bool _isTyping = false;
  bool _runtimeEnsuring = false;
  bool _leaving = false;

  @override
  void initState() {
    super.initState();
    final socketService = ref.read(socketServiceProvider);
    _terminal = Terminal(maxLines: 10000);
    _terminal.onResize = (cols, rows, pixelWidth, pixelHeight) {
      socketService.sendResize(cols, rows);
    };
    _listenForErrors();
    _listenForSnapshot();
    _listenForPrompts();
    _listenForRuntime();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_connectOnEnter());
    });
  }

  @override
  void dispose() {
    _errorSub?.cancel();
    _outputSub?.cancel();
    _snapshotSub?.cancel();
    _promptSub?.cancel();
    _runtimeSub?.cancel();
    super.dispose();
  }

  void _listenForErrors() {
    final socketService = ref.read(socketServiceProvider);
    _errorSub = socketService.sessionErrors.listen((error) {
      AppLogger.error('TerminalScreen', '收到服务端 session 错误', error.message);
      if (!mounted) return;
      if (_runtimeEnsuring)
        setState(() {
          _runtimeEnsuring = false;
        });
      _showSessionError(error.message);
    });
  }

  void _listenForSnapshot() {
    final socketService = ref.read(socketServiceProvider);

    // Full snapshot on reconnect — reset terminal then write plain text
    _snapshotSub = socketService.terminalSnapshot.listen((snap) {
      if (!mounted) return;
      _terminal.write('\x1B[2J\x1B[H');
      _terminal.write(snap.snapshot);
    });

    // Incremental output — write raw ANSI data directly so colors/styles render
    _outputSub = socketService.terminalOutput.listen((output) {
      if (!mounted) return;
      _terminal.write(output.data);
    });
  }

  void _listenForPrompts() {
    final socketService = ref.read(socketServiceProvider);
    _promptSub = socketService.claudePrompts.listen((prompt) {
      if (!mounted) return;
      setState(() {
        _pendingPrompt = _PendingPrompt(
          type: prompt.promptType,
          rawText: prompt.rawText,
        );
      });
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

  void _sendMessage(String text) {
    final socketService = ref.read(socketServiceProvider);
    socketService.sendInput('$text\r');
  }

  /// Sends a raw terminal sequence (e.g. arrow keys, Esc, Enter) without
  /// appending \r or registering it as user input for echo suppression.
  void _sendRawInput(String sequence) {
    final socketService = ref.read(socketServiceProvider);
    socketService.sendInput(sequence);
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

  void _sendPromptDecision({required bool approved}) {
    final socketService = ref.read(socketServiceProvider);
    socketService.sendInput(approved ? 'y\r' : 'n\r');
    if (!mounted) return;
    setState(() {
      _pendingPrompt = null;
    });
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

  Future<void> _connectOnEnter() async {
    final session = ref.read(sessionProvider);
    if (session == null) {
      AppLogger.warn('TerminalScreen', '进入终端时缺少 session，返回首页');
      if (!mounted) return;
      context.go(AppRoutes.home);
      return;
    }

    final status = ref.read(connectionProvider);
    if (status == ConnectionStatus.disconnected ||
        status == ConnectionStatus.error) {
      AppLogger.info('TerminalScreen', '进入终端页后发起连接，sessionId: ${session.sessionId}');
      await ref
          .read(connectionNotifierProvider.notifier)
          .connect(
            serverUrl: session.serverUrl,
            token: session.token,
            sessionId: session.sessionId,
          );
    }

    if (!mounted || _leaving) return;
    final latestSession = ref.read(sessionProvider);
    if (latestSession?.agentConnected == true) {
      _ensureRuntime();
    }
  }

  Future<void> _leaveTerminal() async {
    if (_leaving) return;
    _leaving = true;
    try {
      await ref.read(connectionNotifierProvider.notifier).disconnect();
      if (!mounted) return;
      if (context.canPop()) {
        context.pop();
      } else {
        context.go(AppRoutes.home);
      }
    } finally {
      _leaving = false;
    }
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

  Widget _buildTerminalContent() {
    return Stack(
      children: [
        TerminalView(
          _terminal,
          readOnly: true,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          theme: const TerminalTheme(
            cursor: Color(0xFF4FC3F7),
            selection: Color(0x804FC3F7),
            foreground: Color(0xFFE0E0E0),
            background: Color(0xFF1A1A2E),
            black: Color(0xFF1A1A1A),
            red: Color(0xFFE06C75),
            green: Color(0xFF98C379),
            yellow: Color(0xFFE5C07B),
            blue: Color(0xFF61AFEF),
            magenta: Color(0xFFC678DD),
            cyan: Color(0xFF56B6C2),
            white: Color(0xFFABB2BF),
            brightBlack: Color(0xFF5C6370),
            brightRed: Color(0xFFE06C75),
            brightGreen: Color(0xFF98C379),
            brightYellow: Color(0xFFE5C07B),
            brightBlue: Color(0xFF61AFEF),
            brightMagenta: Color(0xFFC678DD),
            brightCyan: Color(0xFF56B6C2),
            brightWhite: Color(0xFFFFFFFF),
            searchHitBackground: Color(0xFFE5C07B),
            searchHitBackgroundCurrent: Color(0xFFE06C75),
            searchHitForeground: Color(0xFF1A1A1A),
          ),
        ),
        if (_pendingPrompt != null)
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF1A1A2E),
                border: const Border(
                  top: BorderSide(color: Color(0xFF3A3A5C), width: 1),
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.3),
                    blurRadius: 8,
                    offset: const Offset(0, -2),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      _getPromptTitle(_pendingPrompt!.type),
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: Color(0xFFE0E0E0),
                      ),
                    ),
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => _sendPromptDecision(approved: false),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            side: const BorderSide(color: Color(0xFF5C6370)),
                            foregroundColor: const Color(0xFFABB2BF),
                          ),
                          child: const Text('拒绝'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: () => _sendPromptDecision(approved: true),
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            backgroundColor: const Color(0xFF98C379),
                            foregroundColor: Colors.black,
                          ),
                          child: const Text('同意'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  String _getPromptTitle(ClaudePromptType type) {
    return type.displayName;
  }

  @override
  Widget build(BuildContext context) {
    final connectionState = ref.watch(connectionNotifierProvider);
    final session = ref.watch(sessionProvider);
    final connectionStatus = connectionState.status;
    final effectiveStatus = _getEffectiveStatus(connectionStatus, session);

    ref.listen<SessionModel?>(sessionProvider, (prev, next) {
      final becameConnected =
          next?.agentConnected == true && prev?.agentConnected != true;
      if (!becameConnected || _leaving) return;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _leaving) return;
        _ensureRuntime();
      });
    });
    final showBanner =
        connectionStatus == ConnectionStatus.disconnected ||
        connectionStatus == ConnectionStatus.error;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        unawaited(_leaveTerminal());
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF1A1A2E),
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
            Expanded(child: _buildTerminalContent()),
            InputToolbar(
              onSendMessage: _sendMessage,
              onTypingChanged: _handleTypingChanged,
              onRawInput: _sendRawInput,
            ),
          ],
        ),
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
              valueColor: AlwaysStoppedAnimation<Color>(Color(0xFFB38600)),
            ),
          ),
          SizedBox(width: 5),
          Text(
            '正在检查 Claude...',
            style: TextStyle(
              fontSize: 11,
              color: Color(0xFFB38600),
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
      foregroundColor: Colors.black87,
      centerTitle: false,
      titleSpacing: 0,
      leading: IconButton(
        icon: const Icon(Icons.arrow_back_ios, size: 18),
        onPressed: () => unawaited(_leaveTerminal()),
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
          if (statusLine != null) ...[const SizedBox(height: 1), statusLine],
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
        crossAxisAlignment: CrossAxisAlignment.center,
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
