import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:xterm/xterm.dart';

import '../models/session_model.dart';
import '../services/socket_service.dart';
import 'connection_provider.dart';

// ---------------------------------------------------------------------------
// Terminal state
// ---------------------------------------------------------------------------

class TerminalState {
  TerminalState({
    required this.terminal,
    this.lastSeq = -1,
    this.fontSize = 14.0,
  });

  /// The xterm [Terminal] instance. Widgets read from this directly.
  final Terminal terminal;

  /// Sequence number of the last successfully processed output chunk.
  /// Used to detect and handle out-of-order delivery.
  final int lastSeq;

  /// Current font size (adjusted via pinch-to-zoom on the terminal view).
  final double fontSize;

  TerminalState copyWith({
    Terminal? terminal,
    int? lastSeq,
    double? fontSize,
  }) {
    return TerminalState(
      terminal: terminal ?? this.terminal,
      lastSeq: lastSeq ?? this.lastSeq,
      fontSize: fontSize ?? this.fontSize,
    );
  }
}

// ---------------------------------------------------------------------------
// Terminal notifier
// ---------------------------------------------------------------------------

class TerminalNotifier extends StateNotifier<TerminalState> {
  TerminalNotifier({required SocketService socketService})
      : _socketService = socketService,
        super(
          TerminalState(
            terminal: Terminal(
              maxLines: 10000,
              onOutput: (data) => socketService.sendInput(data),
            ),
          ),
        ) {
    _listenToOutput();
  }

  final SocketService _socketService;
  StreamSubscription<TerminalOutput>? _outputSub;

  // Buffer for chunks that arrive before the expected next sequence number.
  final Map<int, TerminalOutput> _pendingChunks = {};

  void _listenToOutput() {
    _outputSub = _socketService.terminalOutput.listen((output) {
      _handleOutput(output);
    }, onError: (Object e) {
      debugPrint('[TerminalNotifier] Stream error: $e');
    });
  }

  void _handleOutput(TerminalOutput output) {
    final expectedSeq = state.lastSeq + 1;

    if (output.seq == expectedSeq || state.lastSeq == -1) {
      // In-order delivery: write immediately.
      _writeToTerminal(output.data);
      var currentSeq = output.seq;

      // Drain any buffered chunks that are now in order.
      while (_pendingChunks.containsKey(currentSeq + 1)) {
        currentSeq++;
        final buffered = _pendingChunks.remove(currentSeq)!;
        _writeToTerminal(buffered.data);
      }

      state = state.copyWith(lastSeq: currentSeq);
    } else if (output.seq > expectedSeq) {
      // Out-of-order: buffer until the gap is filled.
      _pendingChunks[output.seq] = output;
      debugPrint(
        '[TerminalNotifier] Buffered out-of-order chunk seq=${output.seq}, '
        'expected=$expectedSeq',
      );
    }
    // seq < expectedSeq: duplicate, ignore.
  }

  void _writeToTerminal(String data) {
    try {
      state.terminal.write(data);
    } catch (e) {
      debugPrint('[TerminalNotifier] Error writing to terminal: $e');
    }
  }

  /// Writes a local message directly to the terminal (e.g. status messages).
  void writeLocal(String message) {
    _writeToTerminal('\r\n\x1b[33m$message\x1b[0m\r\n');
  }

  /// Updates the font size (triggered by pinch-to-zoom on the terminal view).
  void setFontSize(double size) {
    final clamped = size.clamp(8.0, 24.0);
    if ((clamped - state.fontSize).abs() < 0.1) return;
    state = state.copyWith(fontSize: clamped);
  }

  /// Clears the terminal screen.
  void clear() {
    state.terminal.write('\x1b[2J\x1b[H');
  }

  /// Resets terminal state (called when starting a new session).
  void reset() {
    _pendingChunks.clear();
    state = TerminalState(
      terminal: Terminal(
        maxLines: 10000,
        onOutput: (data) => _socketService.sendInput(data),
      ),
      lastSeq: -1,
      fontSize: state.fontSize,
    );
  }

  @override
  void dispose() {
    _outputSub?.cancel();
    super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

final terminalNotifierProvider =
    StateNotifierProvider<TerminalNotifier, TerminalState>((ref) {
  final socketService = ref.watch(socketServiceProvider);
  return TerminalNotifier(socketService: socketService);
});

/// Convenience provider for the xterm [Terminal] instance.
final terminalProvider = Provider<Terminal>((ref) {
  return ref.watch(terminalNotifierProvider).terminal;
});

/// Convenience provider for the current terminal font size.
final terminalFontSizeProvider = Provider<double>((ref) {
  return ref.watch(terminalNotifierProvider).fontSize;
});
