import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/fs_model.dart';
import '../providers/connection_provider.dart';

class FileBrowser extends ConsumerStatefulWidget {
  const FileBrowser({
    super.key,
    required this.onSelected,
    this.initialPath,
  });

  final ValueChanged<String> onSelected;
  final String? initialPath;

  @override
  ConsumerState<FileBrowser> createState() => _FileBrowserState();
}

class _FileBrowserState extends ConsumerState<FileBrowser> {
  StreamSubscription<FsListResult>? _subscription;
  Timer? _loadingTimeoutTimer;
  String? _currentPath;
  List<FsEntry> _entries = [];
  String _searchQuery = '';
  bool _isLoading = true;
  String? _error;

  Future<void> _confirmSelectCurrentPath() async {
    final path = _currentPath;
    if (path == null || _isLoading) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('确认切换目录'),
          content: const Text('切换工作目录会重连会话，并返回列表页。是否继续？'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('确认切换'),
            ),
          ],
        );
      },
    );
    if (confirmed != true) return;
    widget.onSelected(path);
  }

  @override
  void initState() {
    super.initState();
    _currentPath = widget.initialPath;
    final socketService = ref.read(socketServiceProvider);
    
    _subscription = socketService.fsListResult.listen((result) {
      if (!mounted) return;
      _loadingTimeoutTimer?.cancel();
      setState(() {
        _currentPath = result.path;
        _entries = result.entries;
        _isLoading = false;
        _error = result.error;
      });
    });

    // Initial request
    _refresh();
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _loadingTimeoutTimer?.cancel();
    super.dispose();
  }

  void _refresh() {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    _startLoadingTimeout();
    ref.read(socketServiceProvider).sendFsList(_currentPath);
  }

  void _navigateTo(String path) {
    setState(() {
      _currentPath = path;
      _isLoading = true;
      _error = null;
    });
    _startLoadingTimeout();
    ref.read(socketServiceProvider).sendFsList(path);
  }

  void _startLoadingTimeout() {
    _loadingTimeoutTimer?.cancel();
    _loadingTimeoutTimer = Timer(const Duration(seconds: 10), () {
      if (!mounted || !_isLoading) return;
      setState(() {
        _isLoading = false;
        _error = '目录加载超时，请检查 Desktop 端是否在线';
      });
    });
  }

  bool _isWindowsPath(String path) {
    return path.contains('\\');
  }

  String _joinPath(String base, String name) {
    final separator = _isWindowsPath(base) ? '\\' : '/';
    if (base.endsWith(separator)) return '$base$name';
    return '$base$separator$name';
  }

  String _parentPath(String path) {
    final isWindows = _isWindowsPath(path);
    final separator = isWindows ? '\\' : '/';

    if (!isWindows) {
      if (path == '/') return '/';
      final normalized = path.endsWith('/') && path.length > 1
          ? path.substring(0, path.length - 1)
          : path;
      final index = normalized.lastIndexOf('/');
      if (index <= 0) return '/';
      return normalized.substring(0, index);
    }

    final normalized = path.endsWith('\\') && path.length > 3
        ? path.substring(0, path.length - 1)
        : path;
    final driveRootMatch = RegExp(r'^[A-Za-z]:\\?$').hasMatch(normalized);
    if (driveRootMatch) {
      return normalized.endsWith('\\') ? normalized : '$normalized\\';
    }
    final index = normalized.lastIndexOf(separator);
    if (index <= 2) {
      return '${normalized.substring(0, 2)}\\';
    }
    return normalized.substring(0, index);
  }

  void _goUp() {
    if (_currentPath == null) return;
    final parent = _parentPath(_currentPath!);
    if (parent == _currentPath) return;
    _navigateTo(parent);
  }

  List<FsEntry> _buildVisibleFolders() {
    final query = _searchQuery.trim().toLowerCase();
    final folders = _entries.where((e) => e.isDirectory).toList();
    folders.sort((a, b) {
      final aHidden = a.name.startsWith('.');
      final bHidden = b.name.startsWith('.');
      if (aHidden != bHidden) return aHidden ? 1 : -1;
      return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
    if (query.isEmpty) return folders;
    return folders.where((e) => e.name.toLowerCase().contains(query)).toList();
  }

  @override
  Widget build(BuildContext context) {
    final visibleFolders = _buildVisibleFolders();
    return Container(
      height: MediaQuery.of(context).size.height * 0.88,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      child: Column(
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                const Text(
                  '切换工作目录',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          
          // Current Path & Up Button
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10),
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.arrow_upward),
                  onPressed: _goUp,
                  tooltip: '上一级',
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.all(6),
                  constraints: const BoxConstraints(
                    minWidth: 34,
                    minHeight: 34,
                  ),
                ),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                    decoration: BoxDecoration(
                      color: Colors.grey[100],
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.grey[300]!),
                    ),
                    child: Text(
                      _currentPath ?? 'Loading...',
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 13,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.refresh),
                  onPressed: _refresh,
                  tooltip: '刷新',
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.all(6),
                  constraints: const BoxConstraints(
                    minWidth: 34,
                    minHeight: 34,
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
            child: TextField(
              onChanged: (value) {
                setState(() {
                  _searchQuery = value;
                });
              },
              decoration: InputDecoration(
                hintText: '搜索当前页文件夹',
                prefixIcon: const Icon(Icons.search, size: 20),
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 10,
                ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFFE0E0E0)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFFE0E0E0)),
                ),
              ),
            ),
          ),
          const Divider(),

          // List
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.error_outline, color: Colors.red, size: 48),
                              const SizedBox(height: 16),
                              Text(
                                _error!,
                                style: const TextStyle(color: Colors.red),
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 16),
                              ElevatedButton(
                                onPressed: _refresh,
                                child: const Text('重试'),
                              ),
                            ],
                          ),
                        ),
                      )
                    : ListView.builder(
                        itemCount: visibleFolders.length,
                        itemBuilder: (context, index) {
                          final entry = visibleFolders[index];
                          return ListTile(
                            leading: const Icon(
                              Icons.folder,
                              color: Colors.amber,
                            ),
                            title: Text(entry.name),
                            onTap: () {
                              final base = _currentPath ?? '';
                              if (base.isEmpty) return;
                              final newPath = _joinPath(base, entry.name);
                              _navigateTo(newPath);
                            },
                          );
                        },
                      ),
          ),

          // Footer
          Padding(
            padding: const EdgeInsets.all(16),
            child: SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: (_currentPath != null && !_isLoading)
                    ? _confirmSelectCurrentPath
                    : null,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.black,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Text('选择当前目录'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
