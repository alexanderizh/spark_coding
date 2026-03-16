import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../providers/connection_provider.dart';
import '../providers/link_provider.dart';
import '../providers/session_provider.dart';
import '../providers/terminal_provider.dart';

class SessionSettingsScreen extends ConsumerStatefulWidget {
  const SessionSettingsScreen({super.key});

  @override
  ConsumerState<SessionSettingsScreen> createState() =>
      _SessionSettingsScreenState();
}

class _SessionSettingsScreenState extends ConsumerState<SessionSettingsScreen> {
  bool _isSaving = false;

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

  Future<void> _disconnectThisSession() async {
    final confirmed = await _showConfirmDialog(
      title: '断开连接',
      message: '这将断开与中继服务器的连接，但不会删除保存的会话记录。\n\n继续？',
      confirmLabel: '断开',
      destructive: true,
    );

    if (!confirmed || !mounted) return;

    setState(() => _isSaving = true);
    try {
      await ref.read(connectionNotifierProvider.notifier).disconnect();
      ref.read(sessionNotifierProvider.notifier).clearSession();
      ref.read(terminalNotifierProvider.notifier).reset();

      if (!mounted) return;
      context.go(AppRoutes.home);
    } catch (e) {
      setState(() => _isSaving = false);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('断开失败: $e')));
    }
  }

  Future<void> _disconnectAndResetThisSession() async {
    final sessionService = ref.read(sessionServiceProvider);
    final activeLink = sessionService.activeLink;
    final sessionId =
        ref.read(sessionProvider)?.sessionId ?? activeLink?.sessionId ?? '—';

    final confirmed = await _showConfirmDialog(
      title: '断开并重置本会话',
      message: '这将断开连接，并删除本会话（$sessionId）的配对记录。\n\n继续？',
      confirmLabel: '重置',
      destructive: true,
    );

    if (!confirmed || !mounted) return;

    setState(() => _isSaving = true);

    try {
      await ref.read(connectionNotifierProvider.notifier).disconnect();
      if (activeLink != null) {
        await ref.read(linkNotifierProvider.notifier).deleteLink(activeLink);
      }
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

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final activeLink = ref.watch(sessionServiceProvider).activeLink;
    final hostName = session?.agentHostname ?? activeLink?.hostName ?? '—';
    final sessionId = session?.sessionId ?? activeLink?.sessionId ?? '—';

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
        title: const Text('会话设置'),
      ),
      body: _isSaving
          ? const Center(
              child: CircularProgressIndicator(
                valueColor: AlwaysStoppedAnimation<Color>(Colors.black),
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                _sectionHeader('当前会话'),
                const SizedBox(height: 12),
                _readOnlyField(label: '主机名', value: hostName),
                const SizedBox(height: 8),
                _readOnlyField(label: '会话 ID', value: sessionId),
                const SizedBox(height: 28),
                _sectionHeader('操作'),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _disconnectThisSession,
                  icon: const Icon(Icons.link_off, size: 18),
                  label: const Text('断开本会话连接'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFFD32F2F),
                    side: const BorderSide(color: Color(0xFFD32F2F)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  onPressed: _disconnectAndResetThisSession,
                  icon: const Icon(Icons.delete_forever, size: 18),
                  label: const Text('断开并重置本会话'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFFD32F2F),
                    side: const BorderSide(color: Color(0xFFD32F2F)),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
                const SizedBox(height: 40),
              ],
            ),
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
