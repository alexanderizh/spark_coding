import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../models/session_model.dart';
import '../providers/connection_provider.dart';
import '../providers/prompt_provider.dart';
import '../providers/session_provider.dart';
import '../providers/terminal_provider.dart';
import '../services/socket_service.dart';
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
      if (!mounted) return;
      _showSessionError(error.message);
    });
  }

  void _showSessionError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Server: $message'),
        backgroundColor: const Color(0xFF3A1A1A),
        duration: const Duration(seconds: 5),
        action: SnackBarAction(
          label: 'Dismiss',
          textColor: const Color(0xFFFF5252),
          onPressed: () =>
              ScaffoldMessenger.of(context).hideCurrentSnackBar(),
        ),
      ),
    );
  }

  Future<void> _reconnect() async {
    final session = ref.read(sessionProvider);
    if (session == null) {
      context.go(AppRoutes.home);
      return;
    }

    setState(() => _showReconnectBanner = false);

    await ref.read(connectionNotifierProvider.notifier).connect(
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
    final showBanner = connectionStatus == ConnectionStatus.disconnected ||
        connectionStatus == ConnectionStatus.error;

    return Scaffold(
      backgroundColor: Colors.black,
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
                    ref
                        .read(socketServiceProvider)
                        .sendResize(cols, rows);
                  },
                ),

                // Prompt overlay (slides in from bottom)
                if (currentPrompt != null)
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
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
      BuildContext context, ConnectionStatus status) {
    return AppBar(
      leading: IconButton(
        icon: const Icon(Icons.arrow_back_ios, size: 18),
        onPressed: () => context.go(AppRoutes.home),
        tooltip: 'Back to home',
      ),
      title: const Text('TERMINAL'),
      actions: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
          child: ConnectionBadge(status: status),
        ),
        IconButton(
          icon: const Icon(Icons.settings, size: 20),
          onPressed: () => context.go(AppRoutes.settings),
          tooltip: 'Settings',
        ),
        const SizedBox(width: 4),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Reconnect banner widget
// ---------------------------------------------------------------------------

class _ReconnectBanner extends StatelessWidget {
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
  Widget build(BuildContext context) {
    return Container(
      color: isError ? const Color(0xFF2A0A0A) : const Color(0xFF1A1A0A),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Icon(
            isError ? Icons.error_outline : Icons.wifi_off,
            size: 18,
            color: isError ? const Color(0xFFFF5252) : const Color(0xFFFFB300),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              errorMessage ??
                  (isError
                      ? 'Connection error. Tap to retry.'
                      : 'Disconnected from relay server.'),
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                color: isError
                    ? const Color(0xFFFF8A80)
                    : const Color(0xFFFFE082),
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 8),
          InkWell(
            onTap: onReconnect,
            child: const Text(
              'RETRY',
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                color: Color(0xFF00FF41),
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          const SizedBox(width: 16),
          InkWell(
            onTap: onDisconnect,
            child: const Text(
              'QUIT',
              style: TextStyle(
                fontFamily: 'monospace',
                fontSize: 12,
                color: Color(0xFF9E9E9E),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
