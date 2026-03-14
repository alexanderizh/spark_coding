import { SessionState, SessionErrorCode } from './session.types';
import { ClaudePromptType } from './claude.types';

// ── Event names ─────────────────────────────────────────────────────────────

export const Events = {
  // Client → Server (agent side)
  AGENT_REGISTER:   'agent:register',
  TERMINAL_OUTPUT:  'terminal:output',
  CLAUDE_PROMPT:    'claude:prompt',

  // Client → Server (mobile side)
  MOBILE_JOIN:      'mobile:join',
  TERMINAL_INPUT:   'terminal:input',
  TERMINAL_RESIZE:  'terminal:resize',

  // Either → Server
  SESSION_PING:     'session:ping',

  // Server → Client (both sides)
  SESSION_STATE:    'session:state',
  SESSION_PAIR:     'session:pair',
  SESSION_ERROR:    'session:error',
} as const;

export type EventName = typeof Events[keyof typeof Events];

// ── Payload types ────────────────────────────────────────────────────────────

export interface AgentRegisterPayload {
  sessionToken: string;
  agentVersion: string;
  platform: string;  // 'linux' | 'darwin' | 'win32'
}

export interface MobileJoinPayload {
  sessionToken: string;
  deviceId: string;  // Stable UUID stored on device
}

export interface TerminalOutputPayload {
  sessionId: string;
  data: string;       // Raw PTY output (may contain ANSI codes), UTF-8
  timestamp: number;  // Unix ms
  seq: number;        // Monotonic sequence number for ordering
}

export interface TerminalInputPayload {
  sessionId: string;
  data: string;  // Raw input string (may be '\r', '\x03', '\x1b[A', etc.)
}

export interface TerminalResizePayload {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface SessionStatePayload {
  sessionId: string;
  state: SessionState;
  agentConnected: boolean;
  mobileConnected: boolean;
  timestamp: number;
}

export interface SessionPairPayload {
  sessionId: string;
  mobileDeviceId: string;
  pairedAt: number;
}

export interface ClaudePromptPayload {
  sessionId: string;
  promptType: ClaudePromptType;
  rawText: string;   // Matched terminal text that triggered detection
  timestamp: number;
}

export interface SessionErrorPayload {
  code: SessionErrorCode;
  message: string;
}

export interface SessionPingPayload {
  sessionId: string;
  timestamp: number;
}

// ── QR pairing URL ───────────────────────────────────────────────────────────

export const QR_SCHEME = 'remoteclaude';

export function buildPairUrl(serverUrl: string, token: string): string {
  return `${QR_SCHEME}://pair?token=${token}&server=${encodeURIComponent(serverUrl)}`;
}

export function parsePairUrl(url: string): { token: string; server: string } | null {
  try {
    if (!url.startsWith(`${QR_SCHEME}://pair`)) return null;
    const parsed = new URL(url.replace(`${QR_SCHEME}://`, 'http://pair/'));
    const token = parsed.searchParams.get('token');
    const server = parsed.searchParams.get('server');
    if (!token || !server) return null;
    return { token, server: decodeURIComponent(server) };
  } catch {
    return null;
  }
}
