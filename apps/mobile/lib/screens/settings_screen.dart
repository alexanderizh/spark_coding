import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../app/router.dart';
import '../config/app_config.dart';
import '../models/connection_link_model.dart';
import '../providers/connection_provider.dart';
import '../providers/session_provider.dart';
import '../providers/update_provider.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  String _appVersion = '';
  late TextEditingController _updateUrlController;
  String? _checkResult; // null=idle, ''=checking, 'ok'=up-to-date, or error msg

  @override
  void initState() {
    super.initState();
    _updateUrlController = TextEditingController();
    _loadVersion();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Sync controller text after provider loads persisted URL
    final url = ref.read(updateProvider).updateBaseUrl;
    if (_updateUrlController.text != url) {
      _updateUrlController.text = url;
    }
  }

  Future<void> _loadVersion() async {
    final info = await PackageInfo.fromPlatform();
    if (mounted) setState(() => _appVersion = info.version);
  }

  @override
  void dispose() {
    _updateUrlController.dispose();
    super.dispose();
  }

  Future<void> _checkForUpdate() async {
    setState(() => _checkResult = '');
    final notifier = ref.read(updateProvider.notifier);
    final hasUpdate = await notifier.checkForUpdate(_appVersion);
    if (!mounted) return;
    if (hasUpdate) {
      setState(() => _checkResult = null); // widget already shows available state
      _showUpdateDialog(ref.read(updateProvider));
    } else {
      final err = ref.read(updateProvider).errorMessage;
      setState(() => _checkResult = err ?? 'ok');
    }
  }

  void _showUpdateDialog(UpdateState updateState) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('发现新版本 ${updateState.availableVersion}'),
        content: updateState.releaseNotes != null &&
                updateState.releaseNotes!.isNotEmpty
            ? Text(updateState.releaseNotes!)
            : const Text('有新版本可供下载，建议立即更新。'),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              ref.read(updateProvider.notifier).dismissUpdate();
            },
            child: const Text('暂不更新'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              ref.read(updateProvider.notifier).startDownload();
            },
            child: const Text('立即下载'),
          ),
        ],
      ),
    );
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
      body: _buildForm(context),
    );
  }

  Widget _buildForm(BuildContext context) {
    final session = ref.watch(sessionProvider);
    final sessionService = ref.watch(sessionServiceProvider);
    final activeLink = sessionService.activeLink;
    final mobileDeviceId = sessionService.deviceId;
    final updateState = ref.watch(updateProvider);

    // Collect unique server URLs from all saved links
    final sessionUrls = sessionService.links
        .map((l) => l.serverUrl)
        .toSet()
        .toList();

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // ----------------------------------------------------------------
        // Connection section
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
        // Update section
        // ----------------------------------------------------------------
        _sectionHeader('版本更新'),
        const SizedBox(height: 12),
        _readOnlyField(label: '当前版本', value: _appVersion.isEmpty ? '…' : _appVersion),
        const SizedBox(height: 12),

        // Update base URL input
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFFF5F5F5),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '更新服务器地址',
                style: TextStyle(color: Colors.grey, fontSize: 12),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _updateUrlController,
                      style: const TextStyle(fontSize: 13, color: Colors.black87),
                      decoration: InputDecoration(
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(vertical: 4),
                        border: InputBorder.none,
                        hintText: AppConfig.defaultUpdateBaseUrl,
                        hintStyle: const TextStyle(color: Colors.black38, fontSize: 13),
                        suffixIcon: _updateUrlController.text.isNotEmpty &&
                                _updateUrlController.text != AppConfig.defaultUpdateBaseUrl
                            ? GestureDetector(
                                onTap: () {
                                  _updateUrlController.text = AppConfig.defaultUpdateBaseUrl;
                                  ref.read(updateProvider.notifier).setUpdateBaseUrl('');
                                },
                                child: const Icon(Icons.restore, size: 18, color: Colors.black38),
                              )
                            : null,
                      ),
                      onSubmitted: (val) =>
                          ref.read(updateProvider.notifier).setUpdateBaseUrl(val),
                      onEditingComplete: () =>
                          ref.read(updateProvider.notifier).setUpdateBaseUrl(
                                _updateUrlController.text,
                              ),
                    ),
                  ),
                  if (sessionUrls.isNotEmpty)
                    PopupMenuButton<String>(
                      icon: const Icon(Icons.expand_more, size: 20, color: Colors.black45),
                      tooltip: '从会话中选择',
                      onSelected: (url) {
                        _updateUrlController.text = url;
                        ref.read(updateProvider.notifier).setUpdateBaseUrl(url);
                      },
                      itemBuilder: (_) => sessionUrls
                          .map(
                            (url) => PopupMenuItem<String>(
                              value: url,
                              child: Text(url, style: const TextStyle(fontSize: 13)),
                            ),
                          )
                          .toList(),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 4),
        Text(
          '默认: ${AppConfig.defaultUpdateBaseUrl}',
          style: const TextStyle(fontSize: 11, color: Colors.black38),
        ),
        const SizedBox(height: 12),

        // Check button + status
        Row(
          children: [
            ElevatedButton.icon(
              onPressed: updateState.status == UpdateStatus.checking ||
                      _checkResult == ''
                  ? null
                  : _checkForUpdate,
              icon: updateState.status == UpdateStatus.checking || _checkResult == ''
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.system_update_alt, size: 16),
              label: const Text('检测更新'),
              style: ElevatedButton.styleFrom(
                textStyle: const TextStyle(fontSize: 13),
              ),
            ),
            const SizedBox(width: 12),
            if (_checkResult == 'ok')
              const Row(
                children: [
                  Icon(Icons.check_circle, size: 16, color: Color(0xFF2E7D32)),
                  SizedBox(width: 4),
                  Text('已是最新版本', style: TextStyle(fontSize: 13, color: Color(0xFF2E7D32))),
                ],
              )
            else if (_checkResult != null && _checkResult!.isNotEmpty && _checkResult != 'ok')
              Expanded(
                child: Text(
                  _checkResult!,
                  style: const TextStyle(fontSize: 12, color: Color(0xFFD32F2F)),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
          ],
        ),

        // Show download progress / install button if triggered from settings
        if (updateState.status == UpdateStatus.downloading) ...[
          const SizedBox(height: 12),
          LinearProgressIndicator(value: updateState.downloadProgress),
          const SizedBox(height: 4),
          Text(
            '下载中 ${(updateState.downloadProgress * 100).toStringAsFixed(0)}%',
            style: const TextStyle(fontSize: 12, color: Colors.black54),
          ),
        ] else if (updateState.status == UpdateStatus.downloaded) ...[
          const SizedBox(height: 12),
          ElevatedButton.icon(
            onPressed: () =>
                ref.read(updateProvider.notifier).installUpdate(),
            icon: const Icon(Icons.install_mobile, size: 16),
            label: const Text('立即安装'),
          ),
        ],
        const SizedBox(height: 24),

        // ----------------------------------------------------------------
        // About section
        // ----------------------------------------------------------------
        _sectionHeader('关于'),
        const SizedBox(height: 12),
        _readOnlyField(label: '版本', value: _appVersion.isEmpty ? '…' : _appVersion),
        const SizedBox(height: 8),
        _readOnlyField(label: '平台', value: 'Flutter'),
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
