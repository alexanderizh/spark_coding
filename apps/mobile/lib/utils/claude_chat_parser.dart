import '../models/claude_prompt_model.dart';

class ClaudeChatParser {
  final List<String> _pendingUserEchoes = [];

  void registerUserInput(String text) {
    final normalized = _normalizeSpaces(text).trim();
    if (normalized.isEmpty) return;
    _pendingUserEchoes.add(normalized);
    if (_pendingUserEchoes.length > 20) {
      _pendingUserEchoes.removeAt(0);
    }
  }

  String? parseAssistantChunk(String raw) {
    final output = _sanitize(raw, consumeEcho: true, dropYesNoPrompt: true);
    if (output == null) return null;
    return output;
  }

  String? _sanitize(
    String raw, {
    required bool consumeEcho,
    required bool dropYesNoPrompt,
  }) {
    if (raw.isEmpty) return null;
    var text = _stripAnsi(raw);
    text = text.replaceAll('\r\n', '\n');
    text = _resolveCarriageReturns(text);
    text = _stripControlCharacters(text);
    text = _stripBackspaces(text);
    text = _stripDanglingPrivateModeTokens(text);
    final lines = text.split('\n');
    final filtered = <String>[];
    for (var line in lines) {
      line = _unwrapBoxLine(line);
      line = _stripResponseIndicatorPrefix(line);
      final trimmed = line.trim();
      if (trimmed.isEmpty) {
        filtered.add('');
        continue;
      }
      if (_isDecorationLine(trimmed)) continue;
      if (_isCliMetaLine(trimmed)) continue;
      if (dropYesNoPrompt && _isYesNoPromptLine(trimmed)) continue;
      if (consumeEcho && _isUserEchoLine(trimmed)) continue;
      filtered.add(line.trimRight());
    }
    var output = filtered.join('\n');
    output = output.replaceAll(RegExp(r'\n{3,}'), '\n\n').trim();
    if (output.isEmpty) return null;
    return output;
  }

  String formatPromptText({
    required ClaudePromptType type,
    required String rawText,
    required String fallbackTitle,
  }) {
    final cleaned = _sanitize(
      rawText,
      consumeEcho: false,
      dropYesNoPrompt: false,
    );
    if (cleaned == null) return fallbackTitle;
    final lines = cleaned
        .split('\n')
        .map((line) => line.trim())
        .where((line) => line.isNotEmpty)
        .toList();
    if (lines.isEmpty) return fallbackTitle;
    final meaningful = lines.firstWhere(
      (line) => !_isDecorationLine(line) && !_isCliMetaLine(line),
      orElse: () => '',
    );
    if (meaningful.isEmpty) return fallbackTitle;
    if (type.requiresYesNo) {
      final normalized = meaningful.replaceAll(
        RegExp(r'\s*\[[yYnN]\/[yYnN]\]\s*'),
        '',
      );
      return normalized.isEmpty ? fallbackTitle : normalized;
    }
    return meaningful;
  }

  bool _isUserEchoLine(String line) {
    if (_pendingUserEchoes.isEmpty) return false;
    final normalizedLine = _normalizeSpaces(
      line.replaceFirst(RegExp(r'^[>›]\s*'), ''),
    ).trim();
    for (var i = _pendingUserEchoes.length - 1; i >= 0; i--) {
      final echo = _pendingUserEchoes[i];
      if (normalizedLine == echo || normalizedLine.startsWith(echo)) {
        _pendingUserEchoes.removeAt(i);
        return true;
      }
    }
    return false;
  }

  bool _isYesNoPromptLine(String line) {
    return RegExp(r'\[[yYnN]\/[yYnN]\]').hasMatch(line);
  }

  bool _isCliMetaLine(String line) {
    return RegExp(
      r'^(?:'
      r'❯\s*$|❯\s*\/\w*'           // Claude CLI ❯ prompt
      r'|>\s*$|>\s*\/\w*'           // ASCII > prompt
      r'|\?\s*for\s+shortcuts'      // "? for shortcuts" hint
      r'|Esc to interrupt'
      r'|Press (?:Ctrl|⌃)\+C'
      r'|Running\s+tool.*'
      r'|Tool:\s.*'
      r'|⎿\s.*'
      r'|╰─.*'
      r'|╭─.*'
      r')$',
      caseSensitive: false,
    ).hasMatch(line);
  }

  /// Strips Claude CLI's response-indicator prefix characters (e.g. ⏺, ✽) that
  /// appear at the start of response lines but are not part of the content.
  String _stripResponseIndicatorPrefix(String line) {
    return line.replaceFirst(RegExp(r'^[⏺✽]\s*'), '');
  }

  bool _isDecorationLine(String line) {
    if (line.length < 3) return false;
    if (RegExp(r'^[\-\_=~`•·]{3,}$').hasMatch(line)) return true;
    if (RegExp(r'^[\s│┃┆┊╎║╭╮╰╯┌┐└┘├┤┬┴┼═━─]+$').hasMatch(line)) return true;
    return false;
  }

  String _unwrapBoxLine(String line) {
    final trimmed = line.trim();
    if (trimmed.length >= 2 &&
        ((trimmed.startsWith('│') && trimmed.endsWith('│')) ||
            (trimmed.startsWith('┃') && trimmed.endsWith('┃')) ||
            (trimmed.startsWith('║') && trimmed.endsWith('║')))) {
      return trimmed.substring(1, trimmed.length - 1).trim();
    }
    return line;
  }

  String _normalizeSpaces(String value) {
    return value.replaceAll(RegExp(r'\s+'), ' ');
  }

  String _stripBackspaces(String value) {
    var output = value;
    while (RegExp(r'.\x08').hasMatch(output)) {
      output = output.replaceAll(RegExp(r'.\x08'), '');
    }
    return output;
  }

  String _stripControlCharacters(String value) {
    return value.replaceAll(RegExp(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]'), '');
  }

  String _stripAnsi(String value) {
    var output = value;
    // Claude CLI uses \u001b[1C (cursor-forward-1) as a word separator.
    // Convert it to a real space before stripping other sequences.
    output = output.replaceAll('\x1B[1C', ' ');
    output = output.replaceAll(RegExp(r'\x1B\[[0-?]*[ -/]*[@-~]'), '');
    output = output.replaceAll(
      RegExp(r'\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)'),
      '',
    );
    output = output.replaceAll(RegExp(r'\x1B[P^_][\s\S]*?\x1B\\'), '');
    output = output.replaceAll(RegExp(r'\x1B[@-_]'), '');
    return output;
  }

  String _resolveCarriageReturns(String value) {
    final resolved = value.split('\n').map((line) {
      if (!line.contains('\r')) return line;

      // Work backwards through \r positions, finding the first one with
      // non-empty content after it.
      var idx = line.length;
      while (idx > 0) {
        final rIdx = line.lastIndexOf('\r', idx - 1);
        if (rIdx == -1) break;
        final after = line.substring(rIdx + 1);
        if (after.trim().isNotEmpty) return after;
        idx = rIdx;
      }
      // Fallback: take content after the first \r if it exists
      return line.substring(line.indexOf('\r') + 1);
    }).join('\n');

    // Then strip prompt lines like "❯ ..." that are now at line start
    return resolved.replaceAll(RegExp(r'^[❯>][^\n]*$', multiLine: true), '');
  }

  String _stripDanglingPrivateModeTokens(String value) {
    return value
        .replaceAll(RegExp(r'(?:\[\?[0-9;]{1,24}[A-Za-z])+'), '')
        .replaceAll(
          RegExp(r'^\s*\[[0-9;]{1,24}[A-Za-z]\s*$', multiLine: true),
          '',
        );
  }
}
