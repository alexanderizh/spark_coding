import { CLAUDE_PROMPT_PATTERNS, ClaudePromptType } from '@remote-claude/shared';

const ROLLING_BUFFER_SIZE = 2048;
const DEBOUNCE_MS = 100;

export type PromptDetectedCallback = (type: ClaudePromptType, rawText: string) => void;

export class PromptDetector {
  private buffer = '';
  private debounceTimer: NodeJS.Timeout | null = null;
  private onDetected: PromptDetectedCallback;

  constructor(onDetected: PromptDetectedCallback) {
    this.onDetected = onDetected;
  }

  feed(data: string): void {
    // Maintain rolling buffer
    this.buffer = (this.buffer + data).slice(-ROLLING_BUFFER_SIZE);

    // Debounce detection to handle split ANSI sequences
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.detect(), DEBOUNCE_MS);
  }

  private detect(): void {
    // Strip ANSI escape sequences for cleaner regex matching
    const stripped = stripAnsi(this.buffer);
    for (const { regex, type } of CLAUDE_PROMPT_PATTERNS) {
      const match = stripped.match(regex);
      if (match) {
        this.onDetected(type, match[0]);
        break; // Emit only the highest-priority match
      }
    }
  }

  destroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }
}

// Minimal ANSI escape code stripper
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[mGKHFJABCDsuhl]|\x1B\([A-Z]|\x1B[=>]|\r/g, '');
}
