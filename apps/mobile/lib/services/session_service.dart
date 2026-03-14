import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

/// Keys used in [SharedPreferences] storage.
class _Keys {
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

  // In-memory cache of the last loaded values.
  String? _serverUrl;
  String? _token;
  String? _sessionId;
  String? _deviceId;

  String? get serverUrl => _serverUrl;
  String? get token => _token;
  String? get sessionId => _sessionId;
  String? get deviceId => _deviceId;

  /// Whether a complete, previously-saved session exists in persistent storage.
  bool get hasSavedSession =>
      _serverUrl != null &&
      _token != null &&
      _sessionId != null &&
      _deviceId != null;

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  /// Must be called once at app startup (or before [hasSavedSession] is used)
  /// to load persisted values into the in-memory cache.
  Future<void> restore() async {
    final prefs = await SharedPreferences.getInstance();

    _serverUrl = prefs.getString(_Keys.serverUrl);
    _token = prefs.getString(_Keys.token);
    _sessionId = prefs.getString(_Keys.sessionId);

    // Device ID is separate from session credentials: we generate it once and
    // keep it forever so the relay server can identify this physical device.
    _deviceId = prefs.getString(_Keys.deviceId);
    if (_deviceId == null) {
      _deviceId = _generateDeviceId();
      await prefs.setString(_Keys.deviceId, _deviceId!);
    }

    debugPrint(
      '[SessionService] Restored — serverUrl: $_serverUrl, '
      'sessionId: $_sessionId, deviceId: $_deviceId',
    );
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
    final prefs = await SharedPreferences.getInstance();

    _serverUrl = serverUrl;
    _token = token;
    _sessionId = sessionId;

    await Future.wait([
      prefs.setString(_Keys.serverUrl, serverUrl),
      prefs.setString(_Keys.token, token),
      prefs.setString(_Keys.sessionId, sessionId),
    ]);

    debugPrint('[SessionService] Session saved — sessionId: $sessionId');
  }

  /// Removes all session credentials from persistent storage, forcing the user
  /// to scan a new QR code. The device ID is preserved.
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();

    _serverUrl = null;
    _token = null;
    _sessionId = null;

    await Future.wait([
      prefs.remove(_Keys.serverUrl),
      prefs.remove(_Keys.token),
      prefs.remove(_Keys.sessionId),
    ]);

    debugPrint('[SessionService] Session cleared');
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
}
