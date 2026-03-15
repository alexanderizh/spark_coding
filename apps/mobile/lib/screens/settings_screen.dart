import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../models/connection_link_model.dart';
import '../models/session_model.dart';
import '../providers/connection_provider.dart';
import '../providers/session_provider.dart';
import '../providers/terminal_provider.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  late double _fontSize;
  bool _isSaving = false;

  static const _appVersion = '1.0.0';

  @override
  void initState() {
    super.initState();
    _initValues();
  }

  void _initValues() {
    final currentFontSize = ref.read(terminalNotifierProvider).fontSize;

    _fontSize = currentFontSize;
  }

  Future<void> _saveFontSize(double value) async {
    final sessionService = ref.read(sessionServiceProvider);
    ref.read(terminalNotifierProvider.notifier).setFontSize(value);
    await sessionService.saveFontSize(value);
  }

  Future<void> _disconnectAndReset() async {
    final confirmed = await _showConfirmDialog(
      title: '断开并重置',
      message:
          '这将断开与中继服务器的连接并清除所有保存的会话数据。您需要重新扫描二维码才能连接。\n\n'
          '继续？',
      confirmLabel: '重置',
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
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('重置失败: $e')));
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
        backgroundColor: Colors.white,
        title: Text(
          title,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: Colors.black,
          ),
        ),
        content: Text(
          message,
          style: const TextStyle(
            color: Colors.black87,
            fontSize: 14,
            height: 1.5,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('取消', style: TextStyle(color: Colors.grey)),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(
              confirmLabel,
              style: TextStyle(
                color: destructive ? const Color(0xFFD32F2F) : Colors.black,
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
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go(AppRoutes.home);
            }
          },
        ),
        title: const Text('设置'),
      ),
      body: _isSaving
          ? const Center(
              child: CircularProgressIndicator(
                valueColor: AlwaysStoppedAnimation<Color>(Colors.black),
              ),
            )
          : _buildForm(context),
    );
  }

  Widget _buildForm(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final sessionService = ref.watch(sessionServiceProvider);
    final activeLink = sessionService.activeLink;
    final mobileDeviceId = sessionService.deviceId;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // ----------------------------------------------------------------
        // Connection section - 会话完整信息
        // ----------------------------------------------------------------
        _sectionHeader('会话信息'),
        const SizedBox(height: 12),

        if (session != null || activeLink != null) ...[
          _readOnlyField(
            label: '会话 ID',
            value: session?.sessionId ?? activeLink?.sessionId ?? '—',
          ),
          const SizedBox(height: 8),
          _readOnlyField(
            label: '主机 ID',
            value: activeLink?.desktopDeviceId ?? '—',
          ),
          const SizedBox(height: 8),
          _readOnlyField(
            label: 'Mobile ID',
            value: activeLink?.mobileDeviceId ?? mobileDeviceId ?? '—',
          ),
          const SizedBox(height: 8),
          _readOnlyField(
            label: '连接地址',
            value: session?.serverUrl ?? activeLink?.serverUrl ?? '—',
          ),
          const SizedBox(height: 8),
          _readOnlyField(
            label: '主机名',
            value: session?.agentHostname ?? activeLink?.hostName ?? '—',
          ),
          const SizedBox(height: 8),
          _readOnlyField(
            label: '状态',
            value: session?.state.label ?? activeLink?.status.label ?? '—',
          ),
          if (session?.pairedAt != null) ...[
            const SizedBox(height: 8),
            _readOnlyField(
              label: '配对时间',
              value: DateTime.fromMillisecondsSinceEpoch(session!.pairedAt!)
                  .toLocal()
                  .toString(),
            ),
          ],
          const SizedBox(height: 16),
        ] else ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              '无活动会话。请扫描二维码连接。',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          const SizedBox(height: 16),
        ],

        // ----------------------------------------------------------------
        // Terminal section
        // ----------------------------------------------------------------
        _sectionHeader('终端设置'),
        const SizedBox(height: 12),

        // Font size slider
        Row(
          children: [
            Text(
              '字体大小',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Colors.black87,
                fontSize: 14,
              ),
            ),
            const Spacer(),
            Text(
              '${_fontSize.toStringAsFixed(0)}px',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                color: Colors.black,
                fontSize: 14,
              ),
            ),
          ],
        ),
        Slider(
          value: _fontSize,
          min: 8,
          max: 24,
          divisions: 16,
          activeColor: Colors.black,
          inactiveColor: const Color(0xFFEEEEEE),
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
              Text('8px', style: Theme.of(context).textTheme.bodySmall),
              Text('24px', style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),

        const SizedBox(height: 32),
        const Divider(color: Color(0xFFEEEEEE)),
        const SizedBox(height: 24),

        // ----------------------------------------------------------------
        // Danger zone
        // ----------------------------------------------------------------
        _sectionHeader('危险区域'),
        const SizedBox(height: 12),

        OutlinedButton.icon(
          onPressed: _disconnectAndReset,
          icon: const Icon(Icons.delete_forever, size: 18),
          label: const Text('断开连接并重置'),
          style: OutlinedButton.styleFrom(
            foregroundColor: const Color(0xFFD32F2F),
            side: const BorderSide(color: Color(0xFFD32F2F)),
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
        ),

        const SizedBox(height: 48),
        const Divider(color: Color(0xFFEEEEEE)),
        const SizedBox(height: 24),

        // ----------------------------------------------------------------
        // About section
        // ----------------------------------------------------------------
        _sectionHeader('关于'),
        const SizedBox(height: 12),
        _readOnlyField(label: '版本', value: _appVersion),
        const SizedBox(height: 8),
        _readOnlyField(label: '平台', value: 'Flutter 3.19+'),
        const SizedBox(height: 40),
      ],
    );
  }

  Widget _sectionHeader(String title) {
    return Text(
      title,
      style: const TextStyle(
        color: Colors.black54,
        fontSize: 12,
        letterSpacing: 1.2,
        fontWeight: FontWeight.bold,
      ),
    );
  }

  Widget _readOnlyField({required String label, required String value}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFF5F5F5),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '$label: ',
            style: const TextStyle(color: Colors.grey, fontSize: 13),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: const TextStyle(
                color: Colors.black87,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
