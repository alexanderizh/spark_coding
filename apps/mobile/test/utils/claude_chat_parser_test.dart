import 'package:flutter_test/flutter_test.dart';
import 'package:remote_claude_mobile/models/claude_prompt_model.dart';
import 'package:remote_claude_mobile/utils/claude_chat_parser.dart';

void main() {
  group('ClaudeChatParser', () {
    test('过滤分隔符与控制符并保留正文', () {
      final parser = ClaudeChatParser();
      const raw = '\x1B[32m╭──────────╮\x1B[0m\n│ 你好 │\n╰──────────╯\n';
      final output = parser.parseAssistantChunk(raw);
      expect(output, '你好');
    });

    test('过滤用户输入回显', () {
      final parser = ClaudeChatParser();
      parser.registerUserInput('请总结一下');
      final output = parser.parseAssistantChunk('> 请总结一下\n好的，我来总结。');
      expect(output, '好的，我来总结。');
    });

    test('格式化 prompt 时使用清洗后正文', () {
      final parser = ClaudeChatParser();
      final text = parser.formatPromptText(
        type: ClaudePromptType.yesNoConfirm,
        rawText: 'Do you want to continue? [y/n]',
        fallbackTitle: '确认请求',
      );
      expect(text, 'Do you want to continue?');
    });

    test('过滤私有模式残留标记', () {
      final parser = ClaudeChatParser();
      const raw = '[?2004h[?1004h\n欢迎使用 Claude\n[?2004l';
      final output = parser.parseAssistantChunk(raw);
      expect(output, '欢迎使用 Claude');
    });

    test('处理回车覆盖进度输出', () {
      final parser = ClaudeChatParser();
      const raw = '下载中 10%\r下载中 70%\r下载完成\n下一步';
      final output = parser.parseAssistantChunk(raw);
      expect(output, '下载完成\n下一步');
    });
  });
}
