import 'package:flutter/foundation.dart';

/// 应用日志工具，用于扫描二维码和连接流程的调试。
/// 使用 [print] 输出，确保在 `flutter run` 和 release 模式下都能在控制台看到。
/// 可通过 `adb logcat` 或 `flutter logs` 查看 Android 设备上的输出。
class AppLogger {
  AppLogger._();

  static const _tag = '[AppLog]';

  static void _log(
    String level,
    String tag,
    String message, [
    Object? error,
    StackTrace? stack,
  ]) {
    final buffer = StringBuffer('$_tag $level $tag $message');
    if (error != null) {
      buffer.write('\n  错误: $error');
    }
    if (stack != null) {
      buffer.write('\n  堆栈:\n$stack');
    }
    // 使用 print 确保在 release 模式下也能输出（debugPrint 会被移除）
    // ignore: avoid_print
    print(buffer.toString());
    if (kDebugMode && (error != null || stack != null)) {
      debugPrint(buffer.toString());
    }
  }

  static void info(String tag, String message) {
    _log('I', tag, message);
  }

  static void warn(String tag, String message, [Object? error]) {
    _log('W', tag, message, error);
  }

  static void error(
    String tag,
    String message, [
    Object? error,
    StackTrace? stack,
  ]) {
    _log('E', tag, message, error, stack);
  }
}
