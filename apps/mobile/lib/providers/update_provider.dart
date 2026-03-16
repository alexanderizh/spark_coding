import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:open_filex/open_filex.dart' show OpenFilex;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../config/app_config.dart';

enum UpdateStatus { idle, checking, available, downloading, downloaded, error }

class UpdateState {
  const UpdateState({
    this.status = UpdateStatus.idle,
    this.updateBaseUrl = AppConfig.defaultUpdateBaseUrl,
    this.availableVersion,
    this.downloadUrl,
    this.releaseNotes,
    this.downloadProgress = 0.0,
    this.localFilePath,
    this.dismissedVersion,
    this.errorMessage,
  });

  final UpdateStatus status;
  final String updateBaseUrl;
  final String? availableVersion;
  final String? downloadUrl;
  final String? releaseNotes;
  final double downloadProgress;
  final String? localFilePath;
  final String? dismissedVersion;
  final String? errorMessage;

  UpdateState copyWith({
    UpdateStatus? status,
    String? updateBaseUrl,
    String? availableVersion,
    String? downloadUrl,
    String? releaseNotes,
    double? downloadProgress,
    String? localFilePath,
    String? dismissedVersion,
    String? errorMessage,
  }) {
    return UpdateState(
      status: status ?? this.status,
      updateBaseUrl: updateBaseUrl ?? this.updateBaseUrl,
      availableVersion: availableVersion ?? this.availableVersion,
      downloadUrl: downloadUrl ?? this.downloadUrl,
      releaseNotes: releaseNotes ?? this.releaseNotes,
      downloadProgress: downloadProgress ?? this.downloadProgress,
      localFilePath: localFilePath ?? this.localFilePath,
      dismissedVersion: dismissedVersion ?? this.dismissedVersion,
      errorMessage: errorMessage ?? this.errorMessage,
    );
  }
}

class UpdateNotifier extends StateNotifier<UpdateState> {
  UpdateNotifier() : super(const UpdateState()) {
    _loadPersistedUrl();
  }

  final _dio = Dio();
  static const _dismissedKey = 'dismissed_update_version';
  static const _updateBaseUrlKey = 'update_base_url';

  Future<void> _loadPersistedUrl() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_updateBaseUrlKey);
    if (saved != null && saved.isNotEmpty) {
      state = state.copyWith(updateBaseUrl: saved);
    }
  }

  Future<void> setUpdateBaseUrl(String url) async {
    final trimmed = url.trim();
    final prefs = await SharedPreferences.getInstance();
    if (trimmed.isEmpty) {
      await prefs.remove(_updateBaseUrlKey);
      state = state.copyWith(updateBaseUrl: AppConfig.defaultUpdateBaseUrl);
    } else {
      await prefs.setString(_updateBaseUrlKey, trimmed);
      state = state.copyWith(updateBaseUrl: trimmed);
    }
  }

  /// Compares version strings like "1.0.10" vs "1.0.9" correctly.
  bool _isNewer(String remote, String current) {
    final remoteParts = remote.split('.').map(int.tryParse).toList();
    final currentParts = current.split('.').map(int.tryParse).toList();
    final len = remoteParts.length > currentParts.length
        ? remoteParts.length
        : currentParts.length;
    for (var i = 0; i < len; i++) {
      final r = i < remoteParts.length ? (remoteParts[i] ?? 0) : 0;
      final c = i < currentParts.length ? (currentParts[i] ?? 0) : 0;
      if (r > c) return true;
      if (r < c) return false;
    }
    return false;
  }

  /// Checks for updates. Returns true if a new version is available.
  Future<bool> checkForUpdate(String currentVersion) async {
    state = state.copyWith(status: UpdateStatus.checking);
    try {
      final prefs = await SharedPreferences.getInstance();
      final dismissed = prefs.getString(_dismissedKey);

      final resp = await _dio.get(
        '${state.updateBaseUrl}/api/version/latest',
        queryParameters: {'platform': 'android'},
        options: Options(receiveTimeout: const Duration(seconds: 10)),
      );

      final body = resp.data as Map<String, dynamic>?;
      if (body == null || body['success'] != true || body['data'] == null) {
        state = state.copyWith(status: UpdateStatus.idle);
        return false;
      }

      final data = body['data'] as Map<String, dynamic>;
      final remoteVersion = data['version'] as String? ?? '';
      final downloadUrl = data['downloadUrl'] as String? ?? '';
      final releaseNotes = data['releaseNotes'] as String?;

      if (!_isNewer(remoteVersion, currentVersion)) {
        state = state.copyWith(status: UpdateStatus.idle);
        return false;
      }

      state = state.copyWith(
        status: UpdateStatus.available,
        availableVersion: remoteVersion,
        downloadUrl: downloadUrl,
        releaseNotes: releaseNotes,
        dismissedVersion: dismissed,
      );
      return true;
    } catch (_) {
      state = state.copyWith(status: UpdateStatus.idle, errorMessage: '检查更新失败，请检查网络');
      return false;
    }
  }

  Future<void> startDownload() async {
    final url = state.downloadUrl;
    if (url == null || url.isEmpty) return;

    state = state.copyWith(status: UpdateStatus.downloading, downloadProgress: 0.0);
    try {
      final dir = await getTemporaryDirectory();
      final filePath = '${dir.path}/spark_coder_update.apk';

      await _dio.download(
        url,
        filePath,
        onReceiveProgress: (received, total) {
          if (total > 0) {
            state = state.copyWith(downloadProgress: received / total);
          }
        },
      );

      state = state.copyWith(
        status: UpdateStatus.downloaded,
        localFilePath: filePath,
        downloadProgress: 1.0,
      );
    } catch (_) {
      state = state.copyWith(status: UpdateStatus.error, errorMessage: '下载失败，请重试');
    }
  }

  Future<void> installUpdate() async {
    final path = state.localFilePath;
    if (path == null) return;
    if (Platform.isAndroid) {
      await OpenFilex.open(path);
    }
  }

  Future<void> dismissUpdate() async {
    final version = state.availableVersion;
    if (version != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_dismissedKey, version);
    }
    state = state.copyWith(status: UpdateStatus.idle);
  }

  void retryDownload() {
    state = state.copyWith(status: UpdateStatus.available, downloadProgress: 0.0);
  }
}

final updateProvider =
    StateNotifierProvider<UpdateNotifier, UpdateState>((ref) => UpdateNotifier());
