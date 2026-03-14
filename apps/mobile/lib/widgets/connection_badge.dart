import 'package:flutter/material.dart';

import '../providers/connection_provider.dart';

/// A small status badge showing the current WebSocket connection state.
/// Used in the AppBar of [TerminalScreen] and [HomeScreen].
class ConnectionBadge extends StatelessWidget {
  const ConnectionBadge({super.key, required this.status});

  final ConnectionStatus status;

  @override
  Widget build(BuildContext context) {
    final (color, label) = _resolveAppearance(status);

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _PulseDot(color: color, pulsing: status == ConnectionStatus.connecting),
        const SizedBox(width: 6),
        Text(
          label,
          style: const TextStyle(
            fontSize: 12,
            letterSpacing: 0.5,
            color: Colors.grey,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }

  (Color, String) _resolveAppearance(ConnectionStatus status) {
    switch (status) {
      case ConnectionStatus.connected:
        return (Colors.green, '已连接');
      case ConnectionStatus.connecting:
        return (Colors.orange, '连接中...');
      case ConnectionStatus.error:
        return (Colors.red, '错误');
      case ConnectionStatus.disconnected:
        return (Colors.grey, '已断开');
    }
  }
}

/// A small dot that optionally pulses (for the "connecting" state).
class _PulseDot extends StatefulWidget {
  const _PulseDot({required this.color, required this.pulsing});

  final Color color;
  final bool pulsing;

  @override
  State<_PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<_PulseDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _opacity;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
    _opacity = Tween<double>(
      begin: 0.3,
      end: 1.0,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
    if (widget.pulsing) _controller.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(_PulseDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.pulsing && !_controller.isAnimating) {
      _controller.repeat(reverse: true);
    } else if (!widget.pulsing && _controller.isAnimating) {
      _controller.stop();
      _controller.value = 1.0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.pulsing) {
      return _dot(widget.color, 1.0);
    }
    return AnimatedBuilder(
      animation: _opacity,
      builder: (_, __) => _dot(widget.color, _opacity.value),
    );
  }

  Widget _dot(Color color, double opacity) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color.withAlpha((opacity * 255).round()),
      ),
    );
  }
}
