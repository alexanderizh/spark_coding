import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../providers/connection_provider.dart';
import '../providers/session_provider.dart';
import '../providers/terminal_provider.dart';
import '../services/session_service.dart';
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
      _showError('No saved session found. Please scan a QR code.');
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
    context.go(AppRoutes.terminal);
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: const Color(0xFF2A2A2A),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final connectionStatus = ref.watch(connectionProvider);
    final session = ref.watch(sessionProvider);

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            children: [
              const SizedBox(height: 60),
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
            border: Border.all(color: const Color(0xFF00FF41), width: 2),
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Icon(Icons.terminal, size: 48, color: Color(0xFF00FF41)),
        ),
        const SizedBox(height: 20),
        Text(
          'REMOTE CLAUDE',
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontSize: 22, letterSpacing: 4),
        ),
        const SizedBox(height: 8),
        Text(
          'Mobile terminal controller',
          style: Theme.of(
            context,
          ).textTheme.bodySmall?.copyWith(letterSpacing: 1.5),
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
          onPressed: isConnecting ? null : () => context.go(AppRoutes.scan),
          icon: const Icon(Icons.qr_code_scanner, size: 20),
          label: const Text('SCAN QR CODE'),
          style: ElevatedButton.styleFrom(
            padding: const EdgeInsets.symmetric(vertical: 16),
          ),
        ),
        const SizedBox(height: 12),

        // If already connected, jump straight to terminal.
        if (isConnected)
          OutlinedButton.icon(
            onPressed: () => context.go(AppRoutes.terminal),
            icon: const Icon(Icons.open_in_new, size: 18),
            label: const Text('OPEN TERMINAL'),
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
            label: const Text('RECONNECT LAST SESSION'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),

        if (isConnecting) ...[
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  valueColor: AlwaysStoppedAnimation<Color>(Color(0xFF00FF41)),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                'Connecting...',
                style: Theme.of(context).textTheme.bodySmall,
              ),
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
          onPressed: () => context.go(AppRoutes.settings),
          icon: const Icon(Icons.settings, size: 16),
          label: const Text('Settings'),
          style: TextButton.styleFrom(
            foregroundColor: const Color(0xFF9E9E9E),
            textStyle: const TextStyle(
              fontFamily: 'monospace',
              fontSize: 12,
              letterSpacing: 1.0,
            ),
          ),
        ),
      ],
    );
  }
}
