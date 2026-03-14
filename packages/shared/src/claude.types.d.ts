export declare enum ClaudePromptType {
    PERMISSION_REQUEST = "permission_request",// "Do you want to allow claude to...? [y/n]"
    YES_NO_CONFIRM = "yes_no_confirm",// Generic [y/n] / [Y/n] prompt
    TOOL_USE_APPROVAL = "tool_use_approval",// Tool execution confirmation
    MULTILINE_INPUT = "multiline_input",// Claude awaiting multi-line / EOF
    SLASH_COMMAND_HINT = "slash_command_hint",// User started typing /command
    GENERAL_INPUT = "general_input"
}
/** Regex patterns for detecting Claude CLI interactive prompts */
export declare const CLAUDE_PROMPT_PATTERNS: Array<{
    regex: RegExp;
    type: ClaudePromptType;
}>;
//# sourceMappingURL=claude.types.d.ts.map