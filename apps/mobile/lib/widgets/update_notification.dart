import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/update_provider.dart';

/// Floating update notification card shown in the top-right corner.
/// Overlays the home screen via a Stack.
class UpdateNotificationWidget extends ConsumerWidget {
  const UpdateNotificationWidget({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(updateProvider);
    final notifier = ref.read(updateProvider.notifier);

    final visible = state.status == UpdateStatus.available ||
        state.status == UpdateStatus.downloading ||
        state.status == UpdateStatus.downloaded ||
        state.status == UpdateStatus.error;

    if (!visible) return const SizedBox.shrink();

    return Positioned(
      top: 8,
      right: 8,
      child: Material(
        elevation: 6,
        borderRadius: BorderRadius.circular(12),
        color: Colors.white,
        child: Container(
          width: 260,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFE0E0E0)),
          ),
          child: _buildContent(state, notifier),
        ),
      ),
    );
  }

  Widget _buildContent(UpdateState state, UpdateNotifier notifier) {
    switch (state.status) {
      case UpdateStatus.available:
        return _AvailableView(state: state, notifier: notifier);
      case UpdateStatus.downloading:
        return _DownloadingView(state: state);
      case UpdateStatus.downloaded:
        return _DownloadedView(notifier: notifier);
      case UpdateStatus.error:
        return _ErrorView(notifier: notifier, message: state.errorMessage);
      default:
        return const SizedBox.shrink();
    }
  }
}

class _AvailableView extends StatelessWidget {
  const _AvailableView({required this.state, required this.notifier});
  final UpdateState state;
  final UpdateNotifier notifier;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            const Icon(Icons.system_update, size: 16, color: Color(0xFF1565C0)),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                '新版本 ${state.availableVersion}',
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF1565C0),
                ),
              ),
            ),
            GestureDetector(
              onTap: notifier.dismissUpdate,
              child: const Icon(Icons.close, size: 16, color: Colors.black45),
            ),
          ],
        ),
        if (state.releaseNotes != null && state.releaseNotes!.isNotEmpty) ...[
          const SizedBox(height: 6),
          Text(
            state.releaseNotes!,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 11, color: Colors.black54),
          ),
        ],
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton(
            onPressed: notifier.startDownload,
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 6),
              textStyle: const TextStyle(fontSize: 12),
            ),
            child: const Text('立即下载'),
          ),
        ),
      ],
    );
  }
}

class _DownloadingView extends StatelessWidget {
  const _DownloadingView({required this.state});
  final UpdateState state;

  @override
  Widget build(BuildContext context) {
    final pct = (state.downloadProgress * 100).toStringAsFixed(0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            const Icon(Icons.downloading, size: 16, color: Color(0xFF1565C0)),
            const SizedBox(width: 6),
            const Expanded(
              child: Text(
                '下载中...',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
              ),
            ),
            Text(
              '$pct%',
              style: const TextStyle(fontSize: 12, color: Colors.black54),
            ),
          ],
        ),
        const SizedBox(height: 8),
        LinearProgressIndicator(
          value: state.downloadProgress,
          backgroundColor: const Color(0xFFE3F2FD),
          valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF1565C0)),
        ),
      ],
    );
  }
}

class _DownloadedView extends StatelessWidget {
  const _DownloadedView({required this.notifier});
  final UpdateNotifier notifier;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Row(
          children: [
            Icon(Icons.check_circle, size: 16, color: Color(0xFF2E7D32)),
            SizedBox(width: 6),
            Text(
              '下载完成',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: Color(0xFF2E7D32),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: ElevatedButton(
                onPressed: notifier.installUpdate,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  textStyle: const TextStyle(fontSize: 12),
                ),
                child: const Text('立即安装'),
              ),
            ),
            const SizedBox(width: 8),
            TextButton(
              onPressed: notifier.dismissUpdate,
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
                textStyle: const TextStyle(fontSize: 12),
              ),
              child: const Text('稍后'),
            ),
          ],
        ),
      ],
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.notifier, this.message});
  final UpdateNotifier notifier;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            const Icon(Icons.error_outline, size: 16, color: Color(0xFFD32F2F)),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                message ?? '下载失败',
                style: const TextStyle(fontSize: 12, color: Color(0xFFD32F2F)),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            GestureDetector(
              onTap: notifier.dismissUpdate,
              child: const Icon(Icons.close, size: 16, color: Colors.black45),
            ),
          ],
        ),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(
            onPressed: notifier.retryDownload,
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 6),
              textStyle: const TextStyle(fontSize: 12),
            ),
            child: const Text('重试'),
          ),
        ),
      ],
    );
  }
}
