import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../models/connection_link_model.dart';

/// Keys used in [SharedPreferences] storage.
class _Keys {
  static const links = 'connection_links';
  static const activeLinkId = 'active_link_id';
  static const serverUrl = 'session_server_url';
  static const token = 'session_token';
  static const sessionId = 'session_id';
  static const deviceId = 'device_id';
  static const fontSize = 'terminal_font_size';
}

/// Persists and restores session credentials and app preferences using
/// [SharedPreferences]. Also generates and stores a stable device identifier.
class SessionService {
  SessionService();

  static const _uuid = Uuid();

  final List<ConnectionLink> _links = [];
  String? _activeLinkId;
  String? _deviceId;

  String? get serverUrl => activeLink?.serverUrl;
  String? get token => activeLink?.token;
  String? get sessionId => activeLink?.sessionId;
  String? get deviceId => _deviceId;
  List<ConnectionLink> get links => List.unmodifiable(_links);
  ConnectionLink? get activeLink {
    if (_activeLinkId == null) return null;
    for (final link in _links) {
      if (link.id == _activeLinkId) return link;
    }
    return null;
  }

  bool get hasSavedSession => activeLink != null && _deviceId != null;

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  /// Must be called once at app startup (or before [hasSavedSession] is used)
  /// to load persisted values into the in-memory cache.
  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();

    _links.clear();
    _activeLinkId = prefs.getString(_Keys.activeLinkId);

    final rawLinks = prefs.getString(_Keys.links);
    if (rawLinks != null && rawLinks.isNotEmpty) {
      final dynamic decoded = jsonDecode(rawLinks);
      if (decoded is List) {
        for (final item in decoded) {
          if (item is Map) {
            _links.add(
              ConnectionLink.fromJson(Map<String, dynamic>.from(item)),
            );
          }
        }
      }
    }

    if (_links.isEmpty) {
      final legacyServerUrl = prefs.getString(_Keys.serverUrl);
      final legacyToken = prefs.getString(_Keys.token);
      final legacySessionId = prefs.getString(_Keys.sessionId);
      if (legacyServerUrl != null &&
          legacyToken != null &&
          legacySessionId != null) {
        final now = DateTime.now().millisecondsSinceEpoch;
        final migrated = ConnectionLink(
          id: _uuid.v4(),
          serverUrl: legacyServerUrl,
          token: legacyToken,
          sessionId: legacySessionId,
          createdAt: now,
          updatedAt: now,
        );
        _links.add(migrated);
        _activeLinkId = migrated.id;
      }
    }

    _deviceId = prefs.getString(_Keys.deviceId);
    if (_deviceId == null) {
      _deviceId = _generateDeviceId();
      await prefs.setString(_Keys.deviceId, _deviceId!);
    }

    await _persistLinks(prefs);
  }

  // ---------------------------------------------------------------------------
  // Session persistence
  // ---------------------------------------------------------------------------

  /// Persists a complete set of session credentials.
  Future<void> save({
    required String serverUrl,
    required String token,
    required String sessionId,
  }) async {
    await saveOrUpdateLink(
      serverUrl: serverUrl,
      token: token,
      sessionId: sessionId,
      cliType: CliType.claude,
      setActive: true,
    );
  }

  Future<ConnectionLink> saveOrUpdateLink({
    required String serverUrl,
    required String token,
    required String sessionId,
    CliType cliType = CliType.claude,
    String? hostName,
    bool setActive = true,
  }) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    final normalizedHost = hostName?.trim();
    var targetIndex = -1;

    if (normalizedHost != null && normalizedHost.isNotEmpty) {
      targetIndex = _links.indexWhere(
        (item) =>
            (item.hostName ?? '').trim() == normalizedHost &&
            item.cliType == cliType,
      );
    }

    if (targetIndex < 0) {
      targetIndex = _links.indexWhere(
        (item) =>
            item.serverUrl == serverUrl &&
            item.sessionId == sessionId &&
            item.cliType == cliType,
      );
    }

    if (targetIndex < 0) {
      targetIndex = _links.indexWhere(
        (item) =>
            item.serverUrl == serverUrl &&
            item.token == token &&
            item.cliType == cliType,
      );
    }

    final link = ConnectionLink(
      id: targetIndex >= 0 ? _links[targetIndex].id : _uuid.v4(),
      serverUrl: serverUrl,
      token: token,
      sessionId: sessionId,
      cliType: cliType,
      hostName: normalizedHost,
      status: targetIndex >= 0
          ? _links[targetIndex].status
          : LinkStatus.unknown,
      lastCheckedAt: targetIndex >= 0
          ? _links[targetIndex].lastCheckedAt
          : null,
      createdAt: targetIndex >= 0 ? _links[targetIndex].createdAt : now,
      updatedAt: now,
    );

    if (targetIndex >= 0) {
      _links[targetIndex] = link;
    } else {
      _links.add(link);
    }

    if (setActive) {
      _activeLinkId = link.id;
    }

    await _dedupeByHostAndType();
    await _persistLinks();
    return activeLink ?? link;
  }

  Future<void> replaceLinks(List<ConnectionLink> links) async {
    _links
      ..clear()
      ..addAll(links);
    await _dedupeByHostAndType();
    if (_activeLinkId != null &&
        !_links.any((link) => link.id == _activeLinkId)) {
      _activeLinkId = _links.isNotEmpty ? _links.first.id : null;
    }
    await _persistLinks();
  }

  Future<void> setActiveLink(String linkId) async {
    final exists = _links.any((item) => item.id == linkId);
    if (!exists) return;
    _activeLinkId = linkId;
    await _persistLinks();
  }

  Future<void> setActiveLinkBySession({
    required String sessionId,
    required CliType cliType,
  }) async {
    for (final link in _links) {
      if (link.sessionId == sessionId && link.cliType == cliType) {
        _activeLinkId = link.id;
        break;
      }
    }
    await _persistLinks();
  }

  Future<void> removeLink(String linkId) async {
    _links.removeWhere((item) => item.id == linkId);
    if (_activeLinkId == linkId) {
      _activeLinkId = _links.isNotEmpty ? _links.first.id : null;
    }
    await _persistLinks();
  }

  /// Removes all session credentials from persistent storage, forcing the user
  /// to scan a new QR code. The device ID is preserved.
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();

    _links.clear();
    _activeLinkId = null;

    await Future.wait([
      prefs.remove(_Keys.links),
      prefs.remove(_Keys.activeLinkId),
      prefs.remove(_Keys.serverUrl),
      prefs.remove(_Keys.token),
      prefs.remove(_Keys.sessionId),
    ]);
  }

  // ---------------------------------------------------------------------------
  // Preferences
  // ---------------------------------------------------------------------------

  /// Persists the terminal font size preference.
  Future<void> saveFontSize(double size) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_Keys.fontSize, size);
  }

  /// Returns the persisted font size, or [defaultSize] if not set.
  Future<double> getFontSize({double defaultSize = 14.0}) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getDouble(_Keys.fontSize) ?? defaultSize;
  }

  // ---------------------------------------------------------------------------
  // Device ID
  // ---------------------------------------------------------------------------

  /// Returns the stable device identifier, generating one if it does not exist.
  ///
  /// In normal usage [restore] is always called first, so [_deviceId] will
  /// already be populated. This method exists as a safety fallback.
  Future<String> generateDeviceId() async {
    if (_deviceId != null) return _deviceId!;

    final prefs = await SharedPreferences.getInstance();
    _deviceId = _generateDeviceId();
    await prefs.setString(_Keys.deviceId, _deviceId!);
    return _deviceId!;
  }

  String _generateDeviceId() => _uuid.v4();

  Future<void> _dedupeByHostAndType() async {
    final merged = <ConnectionLink>[];
    final hostKeyToIndex = <String, int>{};

    for (final link in _links) {
      final normalizedHost = (link.hostName ?? '').trim();
      if (normalizedHost.isEmpty) {
        merged.add(link);
        continue;
      }
      final key = '${normalizedHost}_${link.cliType.value}';
      final existsIndex = hostKeyToIndex[key];
      if (existsIndex == null) {
        hostKeyToIndex[key] = merged.length;
        merged.add(link);
        continue;
      }
      final existing = merged[existsIndex];
      final keepNew = link.updatedAt >= existing.updatedAt;
      final kept = keepNew ? link : existing;
      merged[existsIndex] = kept;
      if (_activeLinkId == (keepNew ? existing.id : link.id)) {
        _activeLinkId = kept.id;
      }
    }

    _links
      ..clear()
      ..addAll(merged);
  }

  Future<void> _persistLinks([SharedPreferences? prefs]) async {
    final storage = prefs ?? await SharedPreferences.getInstance();
    final payload = jsonEncode(_links.map((item) => item.toJson()).toList());
    await storage.setString(_Keys.links, payload);
    if (_activeLinkId == null) {
      await storage.remove(_Keys.activeLinkId);
    } else {
      await storage.setString(_Keys.activeLinkId, _activeLinkId!);
    }
    if (_links.isNotEmpty) {
      final legacy = activeLink ?? _links.first;
      await Future.wait([
        storage.setString(_Keys.serverUrl, legacy.serverUrl),
        storage.setString(_Keys.token, legacy.token),
        storage.setString(_Keys.sessionId, legacy.sessionId),
      ]);
      _activeLinkId ??= legacy.id;
    } else {
      await Future.wait([
        storage.remove(_Keys.serverUrl),
        storage.remove(_Keys.token),
        storage.remove(_Keys.sessionId),
      ]);
    }
  }
}
