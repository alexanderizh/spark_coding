"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLAUDE_PROMPT_PATTERNS = exports.ClaudePromptType = void 0;
var ClaudePromptType;
(function (ClaudePromptType) {
    ClaudePromptType["PERMISSION_REQUEST"] = "permission_request";
    ClaudePromptType["YES_NO_CONFIRM"] = "yes_no_confirm";
    ClaudePromptType["TOOL_USE_APPROVAL"] = "tool_use_approval";
    ClaudePromptType["MULTILINE_INPUT"] = "multiline_input";
    ClaudePromptType["SLASH_COMMAND_HINT"] = "slash_command_hint";
    ClaudePromptType["GENERAL_INPUT"] = "general_input";
})(ClaudePromptType || (exports.ClaudePromptType = ClaudePromptType = {}));
/** Regex patterns for detecting Claude CLI interactive prompts */
exports.CLAUDE_PROMPT_PATTERNS = [
    {
        regex: /Do you want to allow.{0,200}?\[y\/n\]/is,
        type: ClaudePromptType.PERMISSION_REQUEST,
    },
    {
        regex: /\b(run|execute|apply|create|delete|modify|write|read)\b.{0,80}\[y\/n\]/i,
        type: ClaudePromptType.TOOL_USE_APPROVAL,
    },
    {
        regex: /\[Y\/n\]|\[y\/N\]|\[y\/n\]/,
        type: ClaudePromptType.YES_NO_CONFIRM,
    },
    {
        regex: /^\.\.\.\s*$/m,
        type: ClaudePromptType.MULTILINE_INPUT,
    },
    {
        regex: /^>\s*\/\w*/m,
        type: ClaudePromptType.SLASH_COMMAND_HINT,
    },
];
//# sourceMappingURL=claude.types.js.map