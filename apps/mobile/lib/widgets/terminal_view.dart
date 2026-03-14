import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:xterm/xterm.dart';

import '../providers/terminal_provider.dart';

/// Callback fired when the terminal dimensions change due to a layout resize.
typedef TerminalResizeCallback = void Function(int cols, int rows);

/// Widget that renders the xterm [Terminal] and handles:
///   - LayoutBuilder-driven resize events that notify the relay server.
///   - Pinch-to-zoom to change font size.
///   - Dark terminal colour palette matching the app theme.
class TerminalViewWidget extends ConsumerStatefulWidget {
  const TerminalViewWidget({
    super.key,
    required this.onResize,
  });

  final TerminalResizeCallback onResize;

  @override
  ConsumerState<TerminalViewWidget> createState() => _TerminalViewWidgetState();
}

class _TerminalViewWidgetState extends ConsumerState<TerminalViewWidget> {
  // Character dimensions used for cols/rows calculation.
  // These are approximations for a monospace font at a given size.
  // They are recalculated whenever the font size changes.
  double _charWidth = 8.0;
  double _charHeight = 16.0;

  // Track last reported size to avoid emitting duplicate resize events.
  int _lastCols = 0;
  int _lastRows = 0;

  // Pinch-to-zoom state: font size captured at the beginning of a scale gesture.
  double _fontSizeAtScaleStart = 14.0;

  @override
  Widget build(BuildContext context) {
    final terminalState = ref.watch(terminalNotifierProvider);
    final terminal = terminalState.terminal;
    final fontSize = terminalState.fontSize;

    // Update character dimensions whenever font size changes.
    _charWidth = fontSize * 0.6;
    _charHeight = fontSize * 1.2;

    return GestureDetector(
      onScaleStart: (details) {
        _fontSizeAtScaleStart = fontSize;
      },
      onScaleUpdate: (details) {
        if (details.pointerCount < 2) return;
        final newSize = (_fontSizeAtScaleStart * details.scale).clamp(8.0, 24.0);
        ref.read(terminalNotifierProvider.notifier).setFontSize(newSize);
      },
      child: LayoutBuilder(
        builder: (context, constraints) {
          final availableWidth = constraints.maxWidth;
          final availableHeight = constraints.maxHeight;

          final cols =
              (availableWidth / _charWidth).floor().clamp(10, 500);
          final rows =
              (availableHeight / _charHeight).floor().clamp(5, 200);

          // Notify relay server only when the dimensions actually change.
          if (cols != _lastCols || rows != _lastRows) {
            _lastCols = cols;
            _lastRows = rows;
            // Schedule after the current frame to avoid setState during build.
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) {
                widget.onResize(cols, rows);
              }
            });
          }

          return TerminalView(
            terminal,
            textStyle: TerminalStyle(
              fontSize: fontSize,
              fontFamily: 'monospace',
            ),
            theme: _buildTerminalTheme(),
            autofocus: true,
            backgroundOpacity: 1.0,
            padding: const EdgeInsets.all(4),
          );
        },
      ),
    );
  }

  TerminalTheme _buildTerminalTheme() {
    return const TerminalTheme(
      cursor: Color(0xFF00FF41),
      selection: Color(0x4400FF41),
      foreground: Color(0xFFE0E0E0),
      background: Color(0xFF000000),
      black: Color(0xFF000000),
      red: Color(0xFFFF5252),
      green: Color(0xFF00FF41),
      yellow: Color(0xFFFFB300),
      blue: Color(0xFF448AFF),
      magenta: Color(0xFFEA80FC),
      cyan: Color(0xFF18FFFF),
      white: Color(0xFFE0E0E0),
      brightBlack: Color(0xFF616161),
      brightRed: Color(0xFFFF8A80),
      brightGreen: Color(0xFFCCFF90),
      brightYellow: Color(0xFFFFE57F),
      brightBlue: Color(0xFF82B1FF),
      brightMagenta: Color(0xFFEA80FC),
      brightCyan: Color(0xFF84FFFF),
      brightWhite: Color(0xFFFFFFFF),
      searchHitBackground: Color(0x6600FF41),
      searchHitBackgroundCurrent: Color(0x9900FF41),
      searchHitForeground: Color(0xFF000000),
    );
  }
}
