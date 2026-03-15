import 'package:flutter/foundation.dart';

enum CliType { claude }

extension CliTypeValue on CliType {
  String get value {
    switch (this) {
      case CliType.claude:
        return 'claude';
    }
  }

  static CliType fromString(String value) {
    switch (value) {
      case 'claude':
        return CliType.claude;
      default:
        return CliType.claude;
    }
  }
}

enum LinkStatus { unknown, online, offline }

extension LinkStatusValue on LinkStatus {
  String get value {
    switch (this) {
      case LinkStatus.unknown:
        return 'unknown';
      case LinkStatus.online:
        return 'online';
      case LinkStatus.offline:
        return 'offline';
    }
  }

  /// 中文显示标签
  String get label {
    switch (this) {
      case LinkStatus.online:
        return '在线';
      case LinkStatus.offline:
        return '离线';
      case LinkStatus.unknown:
        return '未知';
    }
  }

  static LinkStatus fromString(String value) {
    switch (value) {
      case 'online':
        return LinkStatus.online;
      case 'offline':
        return LinkStatus.offline;
      default:
        return LinkStatus.unknown;
    }
  }
}

/// Desktop health status as reported by the daemon.
enum DesktopHealth { healthy, degraded, offline, unknown }

extension DesktopHealthValue on DesktopHealth {
  String get label {
    switch (this) {
      case DesktopHealth.healthy:
        return '健康';
      case DesktopHealth.degraded:
        return '部分异常';
      case DesktopHealth.offline:
        return '离线';
      case DesktopHealth.unknown:
        return '未知';
    }
  }

  static DesktopHealth fromString(String? value) {
    switch (value) {
      case 'healthy':
        return DesktopHealth.healthy;
      case 'degraded':
        return DesktopHealth.degraded;
      case 'offline':
        return DesktopHealth.offline;
      default:
        return DesktopHealth.unknown;
    }
  }
}

/// Snapshot of desktop daemon status (fetched from server).
@immutable
class DesktopStatusSnapshot {
  const DesktopStatusSnapshot({
    required this.overallStatus,
    required this.claudeStatus,
    required this.terminalStatus,
    this.claudePath,
    this.appVersion,
    this.platform,
    this.uptimeMs,
    this.reportedAt,
    this.updatedAt,
  });

  final DesktopHealth overallStatus;
  final String claudeStatus; // 'running' | 'stopped' | 'error' | 'unknown'
  final String terminalStatus; // same
  final String? claudePath;
  final String? appVersion;
  final String? platform;
  final int? uptimeMs;
  final int? reportedAt;
  final int? updatedAt;

  factory DesktopStatusSnapshot.fromJson(Map<String, dynamic> json) {
    return DesktopStatusSnapshot(
      overallStatus: DesktopHealthValue.fromString(
        json['overallStatus'] as String?,
      ),
      claudeStatus: json['claudeStatus'] as String? ?? 'unknown',
      terminalStatus: json['terminalStatus'] as String? ?? 'unknown',
      claudePath: json['claudePath'] as String?,
      appVersion: json['appVersion'] as String?,
      platform: json['platform'] as String?,
      uptimeMs: json['uptimeMs'] as int?,
      reportedAt: json['reportedAt'] as int?,
      updatedAt: json['updatedAt'] as int?,
    );
  }
}

@immutable
class ConnectionLink {
  const ConnectionLink({
    required this.id,
    required this.serverUrl,
    required this.token,
    required this.sessionId,
    this.connectionKey,
    this.cliType = CliType.claude,
    this.hostName,
    this.desktopDeviceId,
    this.mobileDeviceId,
    this.desktopPlatform,
    this.mobilePlatform,
    this.desktopStatus,
    this.status = LinkStatus.unknown,
    this.lastCheckedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String serverUrl;
  final String token;
  final String sessionId;

  /// Stable connection key: ${desktopFp}_${mobileFp}_${launchType}
  final String? connectionKey;
  final CliType cliType;
  final String? hostName;

  /// Desktop physical fingerprint (for status polling)
  final String? desktopDeviceId;

  /// Mobile physical device ID
  final String? mobileDeviceId;
  final String? desktopPlatform;
  final String? mobilePlatform;

  /// Latest desktop health status from server cache
  final DesktopStatusSnapshot? desktopStatus;
  final LinkStatus status;
  final int? lastCheckedAt;
  final int createdAt;
  final int updatedAt;

  ConnectionLink copyWith({
    String? id,
    String? serverUrl,
    String? token,
    String? sessionId,
    String? connectionKey,
    CliType? cliType,
    String? hostName,
    String? desktopDeviceId,
    String? mobileDeviceId,
    String? desktopPlatform,
    String? mobilePlatform,
    DesktopStatusSnapshot? desktopStatus,
    LinkStatus? status,
    int? lastCheckedAt,
    int? createdAt,
    int? updatedAt,
  }) {
    return ConnectionLink(
      id: id ?? this.id,
      serverUrl: serverUrl ?? this.serverUrl,
      token: token ?? this.token,
      sessionId: sessionId ?? this.sessionId,
      connectionKey: connectionKey ?? this.connectionKey,
      cliType: cliType ?? this.cliType,
      hostName: hostName ?? this.hostName,
      desktopDeviceId: desktopDeviceId ?? this.desktopDeviceId,
      mobileDeviceId: mobileDeviceId ?? this.mobileDeviceId,
      desktopPlatform: desktopPlatform ?? this.desktopPlatform,
      mobilePlatform: mobilePlatform ?? this.mobilePlatform,
      desktopStatus: desktopStatus ?? this.desktopStatus,
      status: status ?? this.status,
      lastCheckedAt: lastCheckedAt ?? this.lastCheckedAt,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'serverUrl': serverUrl,
    'token': token,
    'sessionId': sessionId,
    'connectionKey': connectionKey,
    'cliType': cliType.value,
    'hostName': hostName,
    'desktopDeviceId': desktopDeviceId,
    'mobileDeviceId': mobileDeviceId,
    'desktopPlatform': desktopPlatform,
    'mobilePlatform': mobilePlatform,
    // desktopStatus is transient — not persisted
    'status': status.value,
    'lastCheckedAt': lastCheckedAt,
    'createdAt': createdAt,
    'updatedAt': updatedAt,
  };

  factory ConnectionLink.fromJson(Map<String, dynamic> json) {
    return ConnectionLink(
      id: json['id'] as String,
      serverUrl: json['serverUrl'] as String,
      token: json['token'] as String,
      sessionId: json['sessionId'] as String,
      connectionKey: json['connectionKey'] as String?,
      cliType: CliTypeValue.fromString(
        json['cliType'] as String? ?? CliType.claude.value,
      ),
      hostName: json['hostName'] as String?,
      desktopDeviceId: json['desktopDeviceId'] as String?,
      mobileDeviceId: json['mobileDeviceId'] as String?,
      desktopPlatform: json['desktopPlatform'] as String?,
      mobilePlatform: json['mobilePlatform'] as String?,
      // desktopStatus is transient — rebuilt on refresh
      status: LinkStatusValue.fromString(
        json['status'] as String? ?? LinkStatus.unknown.value,
      ),
      lastCheckedAt: json['lastCheckedAt'] as int?,
      createdAt:
          json['createdAt'] as int? ?? DateTime.now().millisecondsSinceEpoch,
      updatedAt:
          json['updatedAt'] as int? ?? DateTime.now().millisecondsSinceEpoch,
    );
  }
}
