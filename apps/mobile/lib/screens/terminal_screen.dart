import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../models/session_model.dart';
import '../providers/connection_provider.dart';
import '../providers/prompt_provider.dart';
import '../providers/session_provider.dart';
import '../utils/app_logger.dart';
import '../widgets/connection_badge.dart';
import '../widgets/input_toolbar.dart';
import '../widgets/prompt_overlay.dart';
import '../widgets/terminal_view.dart';

class TerminalScreen extends ConsumerStatefulWidget {
  const TerminalScreen({super.key});

  @override
  ConsumerState<TerminalScreen> createState() => _TerminalScreenState();
}

class _TerminalScreenState extends ConsumerState<TerminalScreen> {
  StreamSubscription<SessionError>? _errorSub;
  bool _showReconnectBanner = false;

  @override
  void initState() {
    super.initState();
    _listenForErrors();
  }

  @override
  void dispose() {
    _errorSub?.cancel();
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

    setState(() => _showReconnectBanner = false);

    AppLogger.info(
      'TerminalScreen',
      '重连 — serverUrl: ${session.serverUrl}, sessionId: ${session.sessionId}',
    );
    await ref
        .read(connectionNotifierProvider.notifier)
        .connect(
          serverUrl: session.serverUrl,
          token: session.token,
          sessionId: session.sessionId,
        );
  }

  Future<void> _disconnect() async {
    await ref.read(connectionNotifierProvider.notifier).disconnect();
    if (!mounted) return;
    context.go(AppRoutes.home);
  }

  @override
  Widget build(BuildContext context) {
    final connectionState = ref.watch(connectionNotifierProvider);
    final connectionStatus = connectionState.status;
    final currentPrompt = ref.watch(currentPromptProvider);

    // Show reconnect banner when disconnected
    final showBanner =
        connectionStatus == ConnectionStatus.disconnected ||
        connectionStatus == ConnectionStatus.error;

    return Scaffold(
      backgroundColor: Colors.black, // Keep terminal background black
      appBar: _buildAppBar(context, connectionStatus),
      body: Column(
        children: [
          // Reconnect banner
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

          // Main content: terminal + prompt overlay
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                // Terminal view
                TerminalViewWidget(
                  onResize: (cols, rows) {
                    ref.read(socketServiceProvider).sendResize(cols, rows);
                  },
                ),

                // Prompt overlay (Chat bubble style on the left)
                if (currentPrompt != null)
                  Positioned(
                    left: 16,
                    right:
                        64, // Leave space on right to look like "left bubble"
                    bottom: 16,
                    child: PromptOverlay(
                      prompt: currentPrompt,
                      onDismiss: () =>
                          ref.read(promptNotifierProvider.notifier).dismiss(),
                      onSendInput: (data) =>
                          ref.read(socketServiceProvider).sendInput(data),
                    ),
                  ),
              ],
            ),
          ),

          // Input toolbar
          InputToolbar(
            onSendInput: (data) =>
                ref.read(socketServiceProvider).sendInput(data),
          ),
        ],
      ),
    );
  }

  PreferredSizeWidget _buildAppBar(
    BuildContext context,
    ConnectionStatus status,
  ) {
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
      title: const Text('终端'),
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
