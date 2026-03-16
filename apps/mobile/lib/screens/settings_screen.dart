import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../models/connection_link_model.dart';
import '../providers/connection_provider.dart';
import '../providers/session_provider.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  static const _appVersion = '1.0.0';

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
      body: _buildForm(context),
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
