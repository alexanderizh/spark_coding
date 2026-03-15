import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/router.dart';
import '../models/connection_link_model.dart';
import '../providers/connection_provider.dart';
import '../providers/link_provider.dart';
import '../providers/session_provider.dart';
import '../providers/terminal_provider.dart';
import '../utils/app_logger.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> with RouteAware {
  DateTime? _lastBackPressTime;
  StreamSubscription<Map<String, dynamic>>? _deletedSub;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(linkNotifierProvider.notifier).init());
    _listenForDeletion();
    // 每 30s 自动刷新一次，确保桌面端启动后能及时显示在线状态
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) {
        ref.read(linkNotifierProvider.notifier).refreshStatus();
      }
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final route = ModalRoute.of(context);
    if (route != null) {
      routeObserver.subscribe(this, route);
    }
  }

  @override
  void didPopNext() {
    // User returned from terminal/scan/settings — refresh session list
    ref.read(linkNotifierProvider.notifier).refreshStatus();
  }

  void _listenForDeletion() {
    final socket = ref.read(socketServiceProvider);
    _deletedSub = socket.sessionDeleted.listen((data) {
      final sessionId = data['sessionId'] as String?;
      if (sessionId == null) return;
      ref.read(linkNotifierProvider.notifier).handleSessionDeleted(sessionId);
    });
  }

  @override
  void dispose() {
    routeObserver.unsubscribe(this);
    _deletedSub?.cancel();
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _openLink(ConnectionLink link) async {
    AppLogger.info('HomeScreen', '打开连接: ${link.sessionId}');
    await ref.read(linkNotifierProvider.notifier).setActiveLink(link);
    ref
        .read(sessionNotifierProvider.notifier)
        .initSession(
          sessionId: link.sessionId,
          token: link.token,
          serverUrl: link.serverUrl,
        );
    ref.read(terminalNotifierProvider.notifier).reset();
    if (!mounted) return;
    AppLogger.info('HomeScreen', '会话参数已准备，跳转到终端并在页面内发起连接');
    await context.push(AppRoutes.terminal);
    // Refresh link status after returning from terminal (connection may have changed)
    if (mounted) {
      ref.read(linkNotifierProvider.notifier).refreshStatus();
    }
  }

  @override
  Widget build(BuildContext context) {
    final linkState = ref.watch(linkNotifierProvider);
    final onlineLinks = ref.watch(onlineLinksProvider);
    final offlineLinks = ref.watch(offlineLinksProvider);
    final connectionStatus = ref.watch(connectionProvider);

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
        appBar: AppBar(
          title: const Text('连接管理'),
          actions: [
            IconButton(
              onPressed: () => context.push(AppRoutes.scan),
              icon: const Icon(Icons.qr_code_scanner),
            ),
            IconButton(
              onPressed: () => context.push(AppRoutes.settings),
              icon: const Icon(Icons.settings),
            ),
          ],
        ),
        body: SafeArea(
          child: linkState.initializing
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: () =>
                      ref.read(linkNotifierProvider.notifier).refreshStatus(),
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                    children: [
                      _buildConnectionSummary(
                        connectionStatus,
                        linkState.links,
                      ),
                      const SizedBox(height: 16),
                      _buildSectionTitle('在线连接'),
                      const SizedBox(height: 8),
                      if (onlineLinks.isEmpty)
                        _buildEmptyCard('暂无在线连接')
                      else
                        ...onlineLinks.map(
                          (link) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _LinkCard(
                              link: link,
                              onTap: () => unawaited(_openLink(link)),
                              onDelete: () => unawaited(_confirmDelete(link)),
                            ),
                          ),
                        ),
                      const SizedBox(height: 14),
                      _buildSectionTitle('离线连接'),
                      const SizedBox(height: 8),
                      if (offlineLinks.isEmpty)
                        _buildEmptyCard('暂无离线连接')
                      else
                        ...offlineLinks.map(
                          (link) => Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _buildOfflineDismissibleCard(link),
                          ),
                        ),
                      if (linkState.refreshing) ...[
                        const SizedBox(height: 12),
                        const Center(
                          child: SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
        ),
      ),
    );
  }

  Future<void> _confirmDelete(ConnectionLink link) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('删除连接'),
        content: Text(
          '确定要删除与「${link.hostName ?? '该主机'}」的配对记录吗？\n两端的配对信息都将被清除。',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('删除'),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      await ref.read(linkNotifierProvider.notifier).deleteLink(link);
    }
  }

  Widget _buildOfflineDismissibleCard(ConnectionLink link) {
    return Dismissible(
      key: ValueKey('offline-${link.id}'),
      direction: DismissDirection.endToStart,
      confirmDismiss: (_) async {
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('删除离线连接'),
            content: Text(
              '确定要删除与「${link.hostName ?? '该主机'}」的离线连接记录吗？\n两端的配对信息都将被清除。',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('取消'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx, true),
                style: TextButton.styleFrom(foregroundColor: Colors.red),
                child: const Text('删除'),
              ),
            ],
          ),
        );
        if (confirmed != true || !mounted) {
          return false;
        }
        await ref.read(linkNotifierProvider.notifier).deleteLink(link);
        return true;
      },
      background: Container(
        decoration: BoxDecoration(
          color: Colors.red.shade50,
          borderRadius: BorderRadius.circular(12),
        ),
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 16),
        child: const Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            Icon(Icons.delete_outline, color: Colors.red),
            SizedBox(width: 6),
            Text(
              '删除',
              style: TextStyle(color: Colors.red, fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
      child: _LinkCard(
        link: link,
        onTap: () => unawaited(_openLink(link)),
        onDelete: () => unawaited(_confirmDelete(link)),
      ),
    );
  }

  Widget _buildConnectionSummary(
    ConnectionStatus status,
    List<ConnectionLink> links,
  ) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          const Icon(Icons.hub, color: Colors.black87),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '当前连接状态：${status.name}，已保存 ${links.length} 个连接',
              style: const TextStyle(fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
    );
  }

  Widget _buildEmptyCard(String text) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(text, style: const TextStyle(color: Colors.black54)),
    );
  }
}

class _LinkCard extends StatelessWidget {
  const _LinkCard({
    required this.link,
    required this.onTap,
    required this.onDelete,
  });

  final ConnectionLink link;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final online = link.status == LinkStatus.online;
    final hostName = (link.hostName ?? '').trim().isEmpty
        ? '未命名主机'
        : link.hostName!;
    final ds = link.desktopStatus;
    final desktopPlatform = (link.desktopPlatform ?? ds?.platform ?? '').trim();
    final mobilePlatform = (link.mobilePlatform ?? '').trim();

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        onLongPress: onDelete,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    Icons.computer,
                    color: online ? const Color(0xFF2E7D32) : Colors.black45,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          hostName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          link.cliType.value,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12,
                            color: Colors.black54,
                          ),
                        ),
                      ],
                    ),
                  ),
                  _StatusBadge(online: online),
                ],
              ),
              const SizedBox(height: 10),
              const Divider(height: 1, color: Color(0xFFEEEEEE)),
              const SizedBox(height: 8),
              _IdAndPlatformRow(
                icon: Icons.computer_outlined,
                title: '主机',
                idValue: link.desktopDeviceId,
                platformValue: desktopPlatform,
              ),
              const SizedBox(height: 6),
              _IdAndPlatformRow(
                icon: Icons.phone_android_outlined,
                title: '移动端',
                idValue: link.mobileDeviceId,
                platformValue: mobilePlatform,
              ),
              // Desktop health status (if available)
              if (ds != null) ...[
                const SizedBox(height: 10),
                const Divider(height: 1, color: Color(0xFFEEEEEE)),
                const SizedBox(height: 8),
                _DesktopHealthRow(status: ds),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _IdAndPlatformRow extends StatelessWidget {
  const _IdAndPlatformRow({
    required this.icon,
    required this.title,
    required this.idValue,
    required this.platformValue,
  });

  final IconData icon;
  final String title;
  final String? idValue;
  final String? platformValue;

  @override
  Widget build(BuildContext context) {
    final idText = (idValue ?? '').trim().isEmpty ? '—' : idValue!;
    final platformText = (platformValue ?? '').trim().isEmpty
        ? '未知'
        : platformValue!;
    return Row(
      children: [
        Icon(icon, size: 14, color: Colors.black45),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            '$title ID: $idText',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12, color: Colors.black54),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          '系统: $platformText',
          style: const TextStyle(fontSize: 12, color: Colors.black87),
        ),
      ],
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.online});
  final bool online;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: online ? const Color(0xFFE8F5E9) : const Color(0xFFF5F5F5),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        online ? '在线' : '离线',
        style: TextStyle(
          fontSize: 12,
          color: online ? const Color(0xFF2E7D32) : Colors.black54,
        ),
      ),
    );
  }
}

class _DesktopHealthRow extends StatelessWidget {
  const _DesktopHealthRow({required this.status});
  final DesktopStatusSnapshot status;

  Color get _healthColor {
    switch (status.overallStatus) {
      case DesktopHealth.healthy:
        return const Color(0xFF2E7D32);
      case DesktopHealth.degraded:
        return const Color(0xFFF57C00);
      case DesktopHealth.offline:
        return const Color(0xFFD32F2F);
      case DesktopHealth.unknown:
        return Colors.black45;
    }
  }

  @override
  Widget build(BuildContext context) {
    final claudeOk = status.claudeStatus == 'running';
    final terminalOk = status.terminalStatus == 'running';
    return Row(
      children: [
        Icon(Icons.monitor_heart_outlined, size: 14, color: _healthColor),
        const SizedBox(width: 6),
        Text(
          '主机状态: ${status.overallStatus.label}',
          style: TextStyle(
            fontSize: 12,
            color: _healthColor,
            fontWeight: FontWeight.w500,
          ),
        ),
        const Spacer(),
        _ServiceDot(label: 'Claude', ok: claudeOk),
        const SizedBox(width: 8),
        _ServiceDot(label: '终端', ok: terminalOk),
      ],
    );
  }
}

class _ServiceDot extends StatelessWidget {
  const _ServiceDot({required this.label, required this.ok});
  final String label;
  final bool ok;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: ok ? const Color(0xFF2E7D32) : const Color(0xFFD32F2F),
          ),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(fontSize: 11, color: Colors.black54),
        ),
      ],
    );
  }
}
