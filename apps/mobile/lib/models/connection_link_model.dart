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

@immutable
class ConnectionLink {
  const ConnectionLink({
    required this.id,
    required this.serverUrl,
    required this.token,
    required this.sessionId,
    this.cliType = CliType.claude,
    this.hostName,
    this.status = LinkStatus.unknown,
    this.lastCheckedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String serverUrl;
  final String token;
  final String sessionId;
  final CliType cliType;
  final String? hostName;
  final LinkStatus status;
  final int? lastCheckedAt;
  final int createdAt;
  final int updatedAt;

  ConnectionLink copyWith({
    String? id,
    String? serverUrl,
    String? token,
    String? sessionId,
    CliType? cliType,
    String? hostName,
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
      cliType: cliType ?? this.cliType,
      hostName: hostName ?? this.hostName,
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
    'cliType': cliType.value,
    'hostName': hostName,
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
      cliType: CliTypeValue.fromString(
        json['cliType'] as String? ?? CliType.claude.value,
      ),
      hostName: json['hostName'] as String?,
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
