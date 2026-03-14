import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../providers/connection_provider.dart';
import '../providers/session_provider.dart';
import '../providers/terminal_provider.dart';
import '../utils/app_logger.dart';
import '../widgets/connection_badge.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _isRestoring = true;
  bool _hasSavedSession = false;
  DateTime? _lastBackPressTime;

  @override
  void initState() {
    super.initState();
    _restoreSession();
  }

  Future<void> _restoreSession() async {
    final sessionService = ref.read(sessionServiceProvider);
    await sessionService.restore();

    if (!mounted) return;
    setState(() {
      _isRestoring = false;
      _hasSavedSession = sessionService.hasSavedSession;
    });
  }

  Future<void> _reconnectLastSession() async {
    AppLogger.info('HomeScreen', '重连上次会话');
    final sessionService = ref.read(sessionServiceProvider);
    final serverUrl = sessionService.serverUrl;
    final token = sessionService.token;
    final sessionId = sessionService.sessionId;

    if (serverUrl == null || token == null || sessionId == null) {
      AppLogger.warn('HomeScreen', '无已保存会话', 'serverUrl=$serverUrl');
      _showError('未找到保存的会话，请扫描二维码。');
      return;
    }

    AppLogger.info(
      'HomeScreen',
      '重连 — serverUrl: $serverUrl, sessionId: $sessionId',
    );

    // Initialise the session model before connecting.
    ref
        .read(sessionNotifierProvider.notifier)
        .initSession(sessionId: sessionId, token: token, serverUrl: serverUrl);

    // Reset terminal state for the new session.
    ref.read(terminalNotifierProvider.notifier).reset();

    await ref
        .read(connectionNotifierProvider.notifier)
        .connect(serverUrl: serverUrl, token: token, sessionId: sessionId);

    if (!mounted) return;
    AppLogger.info('HomeScreen', '重连请求已发送，跳转到终端');
    context.push(AppRoutes.terminal);
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final connectionStatus = ref.watch(connectionProvider);
    final session = ref.watch(sessionProvider);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;

        final now = DateTime.now();
        if (_lastBackPressTime == null ||
            now.difference(_lastBackPressTime!) > const Duration(seconds: 2)) {
          _lastBackPressTime = now;
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('再按一次退出应用'),
              duration: Duration(seconds: 2),
            ),
          );
        } else {
          SystemNavigator.pop();
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Column(
              children: [
                const SizedBox(height: 80),
                _buildHeader(context),
                const SizedBox(height: 48),
                _buildStatusSection(connectionStatus, session?.serverUrl),
                const Spacer(),
                _buildActions(context, connectionStatus),
                const SizedBox(height: 48),
                _buildFooter(context),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Column(
      children: [
        // Terminal icon / logo
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(
            color: const Color(0xFFF5F5F5),
            borderRadius: BorderRadius.circular(20),
          ),
          child: const Icon(Icons.terminal, size: 48, color: Colors.black),
        ),
        const SizedBox(height: 24),
        Text(
          '远程终端',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontSize: 24, letterSpacing: 1.2),
        ),
        const SizedBox(height: 8),
        Text(
          '移动端控制器',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 14),
        ),
      ],
    );
  }

  Widget _buildStatusSection(ConnectionStatus status, String? serverUrl) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [ConnectionBadge(status: status)],
        ),
        if (serverUrl != null && serverUrl.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(
            serverUrl,
            style: Theme.of(context).textTheme.bodySmall,
            overflow: TextOverflow.ellipsis,
            maxLines: 1,
          ),
        ],
      ],
    );
  }

  Widget _buildActions(BuildContext context, ConnectionStatus status) {
    final isConnected = status == ConnectionStatus.connected;
    final isConnecting = status == ConnectionStatus.connecting;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Primary action: scan QR
        ElevatedButton.icon(
          onPressed: isConnecting ? null : () => context.push(AppRoutes.scan),
          icon: const Icon(Icons.qr_code_scanner, size: 20),
          label: const Text('扫描二维码'),
          style: ElevatedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 16),
          ),
        ),
        const SizedBox(height: 12),

        // If already connected, jump straight to terminal.
        if (isConnected)
          OutlinedButton.icon(
            onPressed: () => context.push(AppRoutes.terminal),
            icon: const Icon(Icons.open_in_new, size: 18),
            label: const Text('打开终端'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),

        // Reconnect last session (visible when we have stored credentials
        // and are not already connected or connecting).
        if (!isConnected && !isConnecting && !_isRestoring && _hasSavedSession)
          OutlinedButton.icon(
            onPressed: _reconnectLastSession,
            icon: const Icon(Icons.refresh, size: 18),
            label: const Text('重连上次会话'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),

        if (isConnecting) ...[
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  valueColor: AlwaysStoppedAnimation<Color>(Colors.black),
                ),
              ),
              const SizedBox(width: 12),
              Text('连接中...', style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildFooter(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        TextButton.icon(
          onPressed: () => context.push(AppRoutes.settings),
          icon: const Icon(Icons.settings, size: 16),
          label: const Text('设置'),
          style: TextButton.styleFrom(foregroundColor: const Color(0xFF9E9E9E)),
        ),
      ],
    );
  }
}
