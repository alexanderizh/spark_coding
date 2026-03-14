import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../providers/connection_provider.dart';
import '../providers/session_provider.dart';
import '../providers/terminal_provider.dart';
import '../services/session_service.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _serverUrlController = TextEditingController();
  late double _fontSize;
  bool _isSaving = false;

  static const _appVersion = '1.0.0';

  @override
  void initState() {
    super.initState();
    _initValues();
  }

  void _initValues() {
    final session = ref.read(sessionProvider);
    final sessionService = ref.read(sessionServiceProvider);
    final currentFontSize = ref.read(terminalNotifierProvider).fontSize;

    _serverUrlController.text =
        session?.serverUrl ?? sessionService.serverUrl ?? '';
    _fontSize = currentFontSize;
  }

  @override
  void dispose() {
    _serverUrlController.dispose();
    super.dispose();
  }

  Future<void> _saveFontSize(double value) async {
    final sessionService = ref.read(sessionServiceProvider);
    ref.read(terminalNotifierProvider.notifier).setFontSize(value);
    await sessionService.saveFontSize(value);
  }

  Future<void> _disconnectAndReset() async {
    final confirmed = await _showConfirmDialog(
      title: 'Disconnect & Reset',
      message:
          'This will disconnect from the relay server and clear all saved '
          'session data. You will need to scan a new QR code to reconnect.\n\n'
          'Continue?',
      confirmLabel: 'RESET',
      destructive: true,
    );

    if (!confirmed || !mounted) return;

    setState(() => _isSaving = true);

    try {
      await ref.read(connectionNotifierProvider.notifier).disconnect();
      await ref.read(sessionServiceProvider).clear();
      ref.read(sessionNotifierProvider.notifier).clearSession();
      ref.read(terminalNotifierProvider.notifier).reset();

      if (!mounted) return;
      context.go(AppRoutes.home);
    } catch (e) {
      setState(() => _isSaving = false);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Reset failed: $e')),
      );
    }
  }

  Future<bool> _showConfirmDialog({
    required String title,
    required String message,
    required String confirmLabel,
    bool destructive = false,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A1A),
        title: Text(
          title,
          style: const TextStyle(
            fontFamily: 'monospace',
            color: Color(0xFFE0E0E0),
            fontSize: 16,
          ),
        ),
        content: Text(
          message,
          style: const TextStyle(
            fontFamily: 'monospace',
            color: Color(0xFF9E9E9E),
            fontSize: 13,
            height: 1.5,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text(
              'CANCEL',
              style: TextStyle(
                fontFamily: 'monospace',
                color: Color(0xFF9E9E9E),
              ),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(
              confirmLabel,
              style: TextStyle(
                fontFamily: 'monospace',
                color: destructive
                    ? const Color(0xFFFF5252)
                    : const Color(0xFF00FF41),
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios, size: 18),
          onPressed: () => context.go(AppRoutes.terminal),
        ),
        title: const Text('SETTINGS'),
      ),
      body: _isSaving
          ? const Center(
              child: CircularProgressIndicator(
                valueColor:
                    AlwaysStoppedAnimation<Color>(Color(0xFF00FF41)),
              ),
            )
          : _buildForm(context),
    );
  }

  Widget _buildForm(BuildContext context) {
    final session = ref.watch(sessionProvider);

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // ----------------------------------------------------------------
        // Connection section
        // ----------------------------------------------------------------
        _sectionHeader('CONNECTION'),
        const SizedBox(height: 12),

        // Display-only fields for current session
        if (session != null) ...[
          _readOnlyField(
            label: 'Server URL',
            value: session.serverUrl,
          ),
          const SizedBox(height: 8),
          _readOnlyField(
            label: 'Session ID',
            value: session.sessionId,
          ),
          const SizedBox(height: 8),
          _readOnlyField(
            label: 'Status',
            value: session.state.value,
          ),
          const SizedBox(height: 16),
        ] else ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              'No active session. Scan a QR code to connect.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          const SizedBox(height: 16),
        ],

        // ----------------------------------------------------------------
        // Terminal section
        // ----------------------------------------------------------------
        _sectionHeader('TERMINAL'),
        const SizedBox(height: 12),

        // Font size slider
        Row(
          children: [
            Text(
              'Font Size',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: const Color(0xFF9E9E9E),
                    fontSize: 13,
                  ),
            ),
            const Spacer(),
            Text(
              '${_fontSize.toStringAsFixed(0)}px',
              style: const TextStyle(
                fontFamily: 'monospace',
                color: Color(0xFF00FF41),
                fontSize: 13,
              ),
            ),
          ],
        ),
        Slider(
          value: _fontSize,
          min: 8,
          max: 24,
          divisions: 16,
          activeColor: const Color(0xFF00FF41),
          inactiveColor: const Color(0xFF2A2A2A),
          onChanged: (value) {
            setState(() => _fontSize = value);
            _saveFontSize(value);
          },
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '8px',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              Text(
                '24px',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),

        const SizedBox(height: 32),
        const Divider(color: Color(0xFF2A2A2A)),
        const SizedBox(height: 24),

        // ----------------------------------------------------------------
        // Danger zone
        // ----------------------------------------------------------------
        _sectionHeader('DANGER ZONE'),
        const SizedBox(height: 12),

        OutlinedButton.icon(
          onPressed: _disconnectAndReset,
          icon: const Icon(Icons.power_settings_new, size: 18),
          label: const Text('DISCONNECT & RESET'),
          style: OutlinedButton.styleFrom(
            foregroundColor: const Color(0xFFFF5252),
            side: const BorderSide(color: Color(0xFFFF5252)),
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
        ),

        const SizedBox(height: 48),
        const Divider(color: Color(0xFF2A2A2A)),
        const SizedBox(height: 24),

        // ----------------------------------------------------------------
        // About section
        // ----------------------------------------------------------------
        _sectionHeader('ABOUT'),
        const SizedBox(height: 12),
        _readOnlyField(label: 'Version', value: _appVersion),
        const SizedBox(height: 8),
        _readOnlyField(label: 'Platform', value: 'Flutter 3.19+'),
        const SizedBox(height: 40),
      ],
    );
  }

  Widget _sectionHeader(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontFamily: 'monospace',
        color: Color(0xFF00FF41),
        fontSize: 11,
        letterSpacing: 2,
        fontWeight: FontWeight.bold,
      ),
    );
  }

  Widget _readOnlyField({required String label, required String value}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: const Color(0xFF2A2A2A)),
      ),
      child: Row(
        children: [
          Text(
            '$label: ',
            style: const TextStyle(
              fontFamily: 'monospace',
              color: Color(0xFF9E9E9E),
              fontSize: 12,
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontFamily: 'monospace',
                color: Color(0xFFE0E0E0),
                fontSize: 12,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
