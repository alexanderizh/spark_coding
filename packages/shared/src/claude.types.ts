export enum ClaudePromptType {
  PERMISSION_REQUEST = 'permission_request',  // "Do you want to allow claude to...? [y/n]"
  YES_NO_CONFIRM     = 'yes_no_confirm',       // Generic [y/n] / [Y/n] prompt
  TOOL_USE_APPROVAL  = 'tool_use_approval',    // Tool execution confirmation
  MULTILINE_INPUT    = 'multiline_input',      // Claude awaiting multi-line / EOF
  SLASH_COMMAND_HINT = 'slash_command_hint',   // User started typing /command
  GENERAL_INPUT      = 'general_input',        // Claude's > prompt waiting for user input
}

/** Regex patterns for detecting Claude CLI interactive prompts */
export const CLAUDE_PROMPT_PATTERNS: Array<{
  regex: RegExp;
  type: ClaudePromptType;
}> = [
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
