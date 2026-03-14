import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';

import '../app/router.dart';
import '../providers/connection_provider.dart';
import '../providers/session_provider.dart';
import '../providers/terminal_provider.dart';
import '../services/session_service.dart';
import '../utils/app_logger.dart';

class ScannerScreen extends ConsumerStatefulWidget {
  const ScannerScreen({super.key});

  @override
  ConsumerState<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends ConsumerState<ScannerScreen> {
  final MobileScannerController _scannerController = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal,
    facing: CameraFacing.back,
    torchEnabled: false,
  );

  bool _hasPermission = false;
  bool _permissionDenied = false;
  bool _isProcessing = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _requestCameraPermission();
  }

  @override
  void dispose() {
    _scannerController.dispose();
    super.dispose();
  }

  Future<void> _requestCameraPermission() async {
    final status = await Permission.camera.request();

    if (!mounted) return;

    setState(() {
      _hasPermission = status.isGranted;
      _permissionDenied = status.isPermanentlyDenied || status.isDenied;
    });
  }

  void _onDetect(BarcodeCapture capture) {
    if (_isProcessing) return;

    final barcodes = capture.barcodes;
    if (barcodes.isEmpty) return;

    final rawValue = barcodes.first.rawValue;
    if (rawValue == null || rawValue.isEmpty) return;

    AppLogger.info('Scanner', '检测到二维码，原始长度: ${rawValue.length}');
    _processQrCode(rawValue);
  }

  Future<void> _processQrCode(String rawValue) async {
    if (_isProcessing) return;

    AppLogger.info('Scanner', '开始处理二维码: ${rawValue.length} 字符');
    setState(() {
      _isProcessing = true;
      _errorMessage = null;
    });

    // Pause scanner to prevent repeated processing.
    await _scannerController.stop();

    try {
      final parsed = _parseRemoteClaudeUrl(rawValue);
      if (parsed == null) {
        AppLogger.warn('Scanner', '二维码格式无效', rawValue);
        _showError(
          'Invalid QR code. Expected format:\n'
          'remoteclaude://pair?token=…&server=…',
        );
        return;
      }

      final (token, serverUrl, sessionId) = parsed;
      AppLogger.info(
        'Scanner',
        '解析成功 — server: $serverUrl, sessionId: $sessionId, token长度: ${token.length}',
      );

      // Persist session credentials.
      final sessionService = ref.read(sessionServiceProvider);
      await sessionService.save(
        serverUrl: serverUrl,
        token: token,
        sessionId: sessionId,
      );
      AppLogger.info('Scanner', '会话已保存');

      // Initialise session model.
      ref
          .read(sessionNotifierProvider.notifier)
          .initSession(
            sessionId: sessionId,
            token: token,
            serverUrl: serverUrl,
          );

      // Reset terminal for the fresh session.
      ref.read(terminalNotifierProvider.notifier).reset();

      // Connect to relay server.
      AppLogger.info('Scanner', '正在连接中继服务器: $serverUrl');
      await ref
          .read(connectionNotifierProvider.notifier)
          .connect(serverUrl: serverUrl, token: token, sessionId: sessionId);

      if (!mounted) return;
      AppLogger.info('Scanner', '连接成功，跳转到终端页');
      context.go(AppRoutes.terminal);
    } catch (e, st) {
      AppLogger.error('Scanner', '处理二维码失败', e, st);
      _showError('Failed to process QR code: $e');
    }
  }

  /// Parses a `remoteclaude://pair?token=TOKEN&server=SERVER_URL&session=ID`
  /// URL and returns a (token, serverUrl, sessionId) tuple, or null if the URL
  /// is not in the expected format.
  ///
  /// The `session` query parameter is optional; if absent, the token is used
  /// as the session identifier (the relay server maps tokens to session IDs).
  (String, String, String)? _parseRemoteClaudeUrl(String raw) {
    try {
      final uri = Uri.parse(raw);

      if (uri.scheme != 'remoteclaude') {
        AppLogger.warn(
          'Scanner',
          '解析失败: scheme 不是 remoteclaude',
          'scheme=${uri.scheme}',
        );
        return null;
      }
      if (uri.host != 'pair') {
        AppLogger.warn('Scanner', '解析失败: host 不是 pair', 'host=${uri.host}');
        return null;
      }

      final token = uri.queryParameters['token'];
      final server = uri.queryParameters['server'];

      if (token == null || token.isEmpty) {
        AppLogger.warn('Scanner', '解析失败: token 为空');
        return null;
      }
      if (server == null || server.isEmpty) {
        AppLogger.warn('Scanner', '解析失败: server 为空');
        return null;
      }

      // session parameter is optional — some server implementations embed the
      // session ID directly in the QR code.
      final sessionId = uri.queryParameters['session'] ?? token;

      // Validate the server URL.
      final serverUri = Uri.parse(server);
      if (!serverUri.hasScheme ||
          (!serverUri.scheme.startsWith('http') &&
              !serverUri.scheme.startsWith('ws'))) {
        AppLogger.warn(
          'Scanner',
          '解析失败: server URL 格式无效',
          'scheme=${serverUri.scheme}',
        );
        return null;
      }

      return (token, server, sessionId);
    } catch (e, st) {
      AppLogger.error('Scanner', '解析 URL 异常', e, st);
      return null;
    }
  }

  void _showError(String message) {
    AppLogger.warn('Scanner', '显示错误给用户', message);
    if (!mounted) return;
    setState(() {
      _errorMessage = message;
      _isProcessing = false;
    });
    // Resume scanning after showing the error.
    _scannerController.start();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          // Camera / scanner layer
          if (_hasPermission)
            MobileScanner(controller: _scannerController, onDetect: _onDetect)
          else
            _buildPermissionView(),

          // Overlay with scan frame and controls
          _buildOverlay(context),
        ],
      ),
    );
  }

  Widget _buildOverlay(BuildContext context) {
    return SafeArea(
      child: Column(
        children: [
          // Top bar
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.arrow_back_ios, color: Colors.white),
                  onPressed: () => context.go(AppRoutes.home),
                ),
                const Spacer(),
                if (_hasPermission)
                  IconButton(
                    icon: const Icon(Icons.flash_on, color: Colors.white),
                    onPressed: () => _scannerController.toggleTorch(),
                  ),
              ],
            ),
          ),

          const Spacer(),

          // Scan frame
          _buildScanFrame(),

          const SizedBox(height: 24),

          // Instructions / error
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40),
            child: _errorMessage != null
                ? _buildErrorCard()
                : _buildInstructions(),
          ),

          const Spacer(),

          // Processing indicator
          if (_isProcessing)
            const Padding(
              padding: EdgeInsets.only(bottom: 40),
              child: CircularProgressIndicator(
                valueColor: AlwaysStoppedAnimation<Color>(Color(0xFF00FF41)),
              ),
            )
          else
            const SizedBox(height: 40),
        ],
      ),
    );
  }

  Widget _buildScanFrame() {
    const frameSize = 260.0;
    const cornerLength = 32.0;
    const cornerThickness = 3.0;
    const cornerColor = Color(0xFF00FF41);

    return SizedBox(
      width: frameSize,
      height: frameSize,
      child: Stack(
        children: [
          // Semi-transparent background outside the frame is handled by the
          // MobileScanner overlay. Here we just draw the corner accents.
          _corner(
            cornerColor,
            cornerLength,
            cornerThickness,
            top: 0,
            left: 0,
            topLeft: true,
          ),
          _corner(
            cornerColor,
            cornerLength,
            cornerThickness,
            top: 0,
            right: 0,
            topRight: true,
          ),
          _corner(
            cornerColor,
            cornerLength,
            cornerThickness,
            bottom: 0,
            left: 0,
            bottomLeft: true,
          ),
          _corner(
            cornerColor,
            cornerLength,
            cornerThickness,
            bottom: 0,
            right: 0,
            bottomRight: true,
          ),
        ],
      ),
    );
  }

  Widget _corner(
    Color color,
    double length,
    double thickness, {
    double? top,
    double? bottom,
    double? left,
    double? right,
    bool topLeft = false,
    bool topRight = false,
    bool bottomLeft = false,
    bool bottomRight = false,
  }) {
    return Positioned(
      top: top,
      bottom: bottom,
      left: left,
      right: right,
      child: SizedBox(
        width: length,
        height: length,
        child: CustomPaint(
          painter: _CornerPainter(
            color: color,
            thickness: thickness,
            topLeft: topLeft,
            topRight: topRight,
            bottomLeft: bottomLeft,
            bottomRight: bottomRight,
          ),
        ),
      ),
    );
  }

  Widget _buildInstructions() {
    return Column(
      children: [
        const Icon(Icons.qr_code, color: Colors.white54, size: 32),
        const SizedBox(height: 12),
        const Text(
          'Point your camera at the QR code\ndisplayed in your terminal',
          style: TextStyle(
            color: Colors.white70,
            fontFamily: 'monospace',
            fontSize: 13,
            height: 1.5,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        Text(
          'remoteclaude://pair?token=…',
          style: TextStyle(
            color: Colors.white.withAlpha(77),
            fontFamily: 'monospace',
            fontSize: 11,
          ),
        ),
      ],
    );
  }

  Widget _buildErrorCard() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0x88FF5252),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFFFF5252)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: Colors.white, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              _errorMessage!,
              style: const TextStyle(
                color: Colors.white,
                fontFamily: 'monospace',
                fontSize: 12,
                height: 1.4,
              ),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, color: Colors.white, size: 18),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
            onPressed: () => setState(() => _errorMessage = null),
          ),
        ],
      ),
    );
  }

  Widget _buildPermissionView() {
    return Container(
      color: const Color(0xFF0D0D0D),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(40),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.camera_alt_outlined,
                size: 64,
                color: Color(0xFF9E9E9E),
              ),
              const SizedBox(height: 24),
              Text(
                _permissionDenied
                    ? 'Camera permission denied.\nPlease enable it in Settings.'
                    : 'Camera permission required\nto scan QR codes.',
                style: const TextStyle(
                  color: Color(0xFF9E9E9E),
                  fontFamily: 'monospace',
                  fontSize: 13,
                  height: 1.5,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              if (_permissionDenied)
                OutlinedButton(
                  onPressed: openAppSettings,
                  child: const Text('Open Settings'),
                )
              else
                ElevatedButton(
                  onPressed: _requestCameraPermission,
                  child: const Text('Grant Permission'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Draws a single corner accent for the scan frame.
class _CornerPainter extends CustomPainter {
  const _CornerPainter({
    required this.color,
    required this.thickness,
    this.topLeft = false,
    this.topRight = false,
    this.bottomLeft = false,
    this.bottomRight = false,
  });

  final Color color;
  final double thickness;
  final bool topLeft;
  final bool topRight;
  final bool bottomLeft;
  final bool bottomRight;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = thickness
      ..strokeCap = StrokeCap.square
      ..style = PaintingStyle.stroke;

    final w = size.width;
    final h = size.height;
    final t = thickness / 2;

    if (topLeft) {
      canvas.drawLine(Offset(t, 0), Offset(w, 0), paint);
      canvas.drawLine(Offset(0, t), Offset(0, h), paint);
    }
    if (topRight) {
      canvas.drawLine(Offset(0, 0), Offset(w - t, 0), paint);
      canvas.drawLine(Offset(w, t), Offset(w, h), paint);
    }
    if (bottomLeft) {
      canvas.drawLine(Offset(t, h), Offset(w, h), paint);
      canvas.drawLine(Offset(0, 0), Offset(0, h - t), paint);
    }
    if (bottomRight) {
      canvas.drawLine(Offset(0, h), Offset(w - t, h), paint);
      canvas.drawLine(Offset(w, 0), Offset(w, h - t), paint);
    }
  }

  @override
  bool shouldRepaint(_CornerPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.thickness != thickness;
}
