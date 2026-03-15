import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';

import '../app/router.dart';
import '../providers/connection_provider.dart';
import '../providers/link_provider.dart';
import '../providers/session_provider.dart';
import '../providers/terminal_provider.dart';
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
          '二维码无效。预期格式：\n'
          'sparkcoder://pair?token=…&server=…',
        );
        return;
      }

      final (token, serverUrl, sessionId, desktopDeviceId) = parsed;
      AppLogger.info(
        'Scanner',
        '解析成功 — sessionId: $sessionId, token长度: ${token.length}, desktopDeviceId: ${desktopDeviceId ?? "none"}',
      );

      final savedLink = await ref
          .read(linkNotifierProvider.notifier)
          .saveFromScan(
            serverUrl:       serverUrl,
            token:           token,
            sessionId:       sessionId,
            desktopDeviceId: desktopDeviceId,
          );
      AppLogger.info('Scanner', '会话已保存');

      // Initialise session model.
      ref
          .read(sessionNotifierProvider.notifier)
          .initSession(
            sessionId: savedLink.sessionId,
            token: savedLink.token,
            serverUrl: savedLink.serverUrl,
          );

      // Reset terminal for the fresh session.
      ref.read(terminalNotifierProvider.notifier).reset();

      // Connect to relay server.
      AppLogger.info('Scanner', '正在连接中继服务');
      await ref
          .read(connectionNotifierProvider.notifier)
          .connect(
            serverUrl: savedLink.serverUrl,
            token: savedLink.token,
            sessionId: savedLink.sessionId,
          );

      if (!mounted) return;
      AppLogger.info('Scanner', '连接成功，跳转到终端页');
      context.pushReplacement(AppRoutes.terminal);
    } catch (e, st) {
      AppLogger.error('Scanner', '处理二维码失败', e, st);
      _showError('处理二维码失败: $e');
    }
  }

  /// Parses a `sparkcoder://pair?token=TOKEN&server=SERVER_URL&did=DESKTOP_ID`
  /// URL. Returns a (token, serverUrl, sessionId, desktopDeviceId?) tuple.
  (String, String, String, String?)? _parseRemoteClaudeUrl(String raw) {
    try {
      final uri = Uri.parse(raw);

      if (uri.scheme != 'sparkcoder') {
        AppLogger.warn('Scanner', '解析失败: scheme 不是 sparkcoder', 'scheme=${uri.scheme}');
        return null;
      }
      if (uri.host != 'pair') {
        AppLogger.warn('Scanner', '解析失败: host 不是 pair', 'host=${uri.host}');
        return null;
      }

      final token  = uri.queryParameters['token'];
      final server = uri.queryParameters['server'];

      if (token == null || token.isEmpty) {
        AppLogger.warn('Scanner', '解析失败: token 为空');
        return null;
      }
      if (server == null || server.isEmpty) {
        AppLogger.warn('Scanner', '解析失败: server 为空');
        return null;
      }

      final sessionId        = uri.queryParameters['session'] ?? token;
      final desktopDeviceId  = uri.queryParameters['did'];

      // Validate the server URL.
      final serverUri = Uri.parse(server);
      if (!serverUri.hasScheme ||
          (!serverUri.scheme.startsWith('http') && !serverUri.scheme.startsWith('ws'))) {
        AppLogger.warn('Scanner', '解析失败: server URL 格式无效', 'scheme=${serverUri.scheme}');
        return null;
      }

      return (token, server, sessionId, desktopDeviceId);
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
          // Top bar — 返回按钮颜色随背景变化：无权限时白底用深色，有权限时黑底用白色
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(
              children: [
                IconButton(
                  icon: Icon(
                    Icons.arrow_back_ios,
                    color: _hasPermission ? Colors.white : Colors.black87,
                  ),
                  onPressed: () {
                    if (context.canPop()) {
                      context.pop();
                    } else {
                      context.go(AppRoutes.home);
                    }
                  },
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
                valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
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
    const cornerThickness = 4.0;
    const cornerColor = Colors.white; // Minimalist white corners

    return SizedBox(
      width: frameSize,
      height: frameSize,
      child: Stack(
        children: [
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
        const Icon(Icons.qr_code, color: Colors.white70, size: 32),
        const SizedBox(height: 12),
        const Text(
          '请将相机对准终端上显示的二维码',
          style: TextStyle(color: Colors.white70, fontSize: 14, height: 1.5),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        Text(
          'sparkcoder://pair?token=…',
          style: TextStyle(color: Colors.white.withAlpha(100), fontSize: 12),
        ),
      ],
    );
  }

  Widget _buildErrorCard() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFD32F2F),
        borderRadius: BorderRadius.circular(8),
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
                fontSize: 13,
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
      color: Colors.white, // White background for permission view
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(40),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.camera_alt_outlined,
                size: 64,
                color: Colors.grey,
              ),
              const SizedBox(height: 24),
              Text(
                _permissionDenied ? '相机权限被拒绝。\n请在设置中启用。' : '扫描二维码需要相机权限。',
                style: const TextStyle(
                  color: Colors.black87,
                  fontSize: 14,
                  height: 1.5,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              if (_permissionDenied)
                OutlinedButton(
                  onPressed: openAppSettings,
                  child: const Text('打开设置'),
                )
              else
                ElevatedButton(
                  onPressed: _requestCameraPermission,
                  child: const Text('授予权限'),
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
      ..strokeCap = StrokeCap
          .round // Rounded corners for minimalist look
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
