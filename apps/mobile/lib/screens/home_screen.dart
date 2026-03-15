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

class _HomeScreenState extends ConsumerState<HomeScreen> {
  DateTime? _lastBackPressTime;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(linkNotifierProvider.notifier).init());
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
    await ref
        .read(connectionNotifierProvider.notifier)
        .connect(
          serverUrl: link.serverUrl,
          token: link.token,
          sessionId: link.sessionId,
        );
    if (!mounted) return;
    AppLogger.info('HomeScreen', '连接请求已发送，跳转到终端');
    await context.push(AppRoutes.terminal);
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
                            child: _LinkCard(
                              link: link,
                              onTap: () => unawaited(_openLink(link)),
                            ),
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
  const _LinkCard({required this.link, required this.onTap});

  final ConnectionLink link;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final online = link.status == LinkStatus.online;
    final hostName = (link.hostName ?? '').trim().isEmpty
        ? '未命名主机'
        : link.hostName!;
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
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
                    const SizedBox(height: 4),
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
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: online
                      ? const Color(0xFFE8F5E9)
                      : const Color(0xFFF5F5F5),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  online ? '在线' : '离线',
                  style: TextStyle(
                    fontSize: 12,
                    color: online ? const Color(0xFF2E7D32) : Colors.black54,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
