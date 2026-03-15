import { SessionState, SessionErrorCode } from './session.types';
import { ClaudePromptType } from './claude.types';
import { DesktopStatusReport, DesktopStatusSnapshot, DeviceInfo } from './device.types';

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
  SESSION_PING:       'session:ping',
  RUNTIME_ENSURE:     'runtime:ensure',
  RUNTIME_STATUS:     'runtime:status',
  DEVICE_REGISTER:    'device:register',     // Either → Server: announce device fingerprint

  // Desktop → Server
  DESKTOP_STATUS_REPORT:   'desktop:status:report',  // Desktop daemon health report
  DESKTOP_STATUS_REQUEST:  'desktop:status:request', // Server → Desktop: re-report now
  DESKTOP_STATUS_UPDATE:   'desktop:status:update',  // Server → Mobile: status changed

  // Mobile → Server
  SESSION_RESUME:          'session:resume',          // Reconnect with existing token (no QR)

  // Either → Server
  SESSION_DELETE:   'session:delete',                // Client requests session deletion

  // Server → Client (both sides)
  SESSION_STATE:    'session:state',
  SESSION_PAIR:     'session:pair',
  SESSION_ERROR:    'session:error',
  SESSION_RESUMED:  'session:resumed',               // Server → client: resume confirmed
  SESSION_DELETED:  'session:deleted',               // Server → client: session was deleted
  TERMINAL_SNAPSHOT: 'terminal:snapshot',            // Server → Mobile: full-state snapshot
} as const;

export type EventName = typeof Events[keyof typeof Events];

export const CliTypes = {
  CLAUDE: 'claude',
} as const;

export type CliType = typeof CliTypes[keyof typeof CliTypes];

// ── Payload types ────────────────────────────────────────────────────────────

export interface AgentRegisterPayload {
  sessionToken:  string;
  agentVersion:  string;
  platform:      string;   // 'linux' | 'darwin' | 'win32'
  hostname:      string;
  deviceId?:     string;   // desktop physical fingerprint
}

export interface MobileJoinPayload {
  sessionToken:    string;
  deviceId:        string;  // Mobile stable device ID
  mobileDeviceId?: string;  // alias for deviceId (preferred name)
  mobilePlatform?: string;
}

/** Reconnect with a previously-issued token — no QR scan needed */
export interface SessionResumePayload {
  token:         string;  // an existing valid token from PairedSessionRecord
  role:          'agent' | 'mobile';
  deviceId:      string;  // physical device fingerprint
}

export interface SessionResumedPayload {
  sessionId:       string;
  state:           SessionState;
  agentConnected:  boolean;
  mobileConnected: boolean;
  desktopStatus?:  'online' | 'offline';
  mobileStatus?:   'online' | 'offline';
  pairedAt:        number | null;
}

/** Desktop device registration (announce fingerprint + metadata) */
export interface DeviceRegisterPayload extends DeviceInfo {}

/** Desktop → Server: periodic health report */
export interface DesktopStatusReportPayload extends DesktopStatusReport {}

/** Server → Mobile: forwarded desktop status */
export interface DesktopStatusUpdatePayload extends DesktopStatusSnapshot {
  sessionId: string;
}

export interface TerminalOutputPayload {
  sessionId: string;
  data: string;       // Raw PTY output (may contain ANSI codes), UTF-8
  timestamp: number;  // Unix ms
  seq: number;        // Monotonic sequence number for ordering
  snapshot?: string;  // Complete accumulated clean text (ANSI stripped)
}

export interface TerminalSnapshotPayload {
  sessionId: string;
  snapshot: string;   // Complete accumulated clean text (ANSI stripped)
  timestamp: number;
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
  agentHostname?: string | null;
  timestamp: number;
}

export interface SessionPairPayload {
  sessionId: string;
  mobileDeviceId: string;
  agentPlatform?: string | null;
  mobilePlatform?: string | null;
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

export interface SessionDeletedPayload {
  sessionId: string;
}

export interface SessionPingPayload {
  sessionId: string;
  timestamp: number;
}

export interface RuntimeEnsurePayload {
  sessionId: string;
  cliType: CliType;
}

export interface RuntimeStatusPayload {
  sessionId: string;
  cliType: CliType;
  ready: boolean;
  started: boolean;
  message?: string;
  timestamp: number;
}

// ── QR pairing URL ───────────────────────────────────────────────────────────

export const QR_SCHEME = 'sparkcoder';

export function buildPairUrl(serverUrl: string, token: string, desktopDeviceId?: string): string {
  let url = `${QR_SCHEME}://pair?token=${token}&server=${encodeURIComponent(serverUrl)}`;
  if (desktopDeviceId) url += `&did=${desktopDeviceId}`;
  return url;
}

export function parsePairUrl(url: string): { token: string; server: string; desktopDeviceId?: string } | null {
  try {
    if (!url.startsWith(`${QR_SCHEME}://pair`)) return null;
    const parsed = new URL(url.replace(`${QR_SCHEME}://`, 'http://pair/'));
    const token = parsed.searchParams.get('token');
    const server = parsed.searchParams.get('server');
    if (!token || !server) return null;
    const desktopDeviceId = parsed.searchParams.get('did') ?? undefined;
    return { token, server: decodeURIComponent(server), desktopDeviceId };
  } catch {
    return null;
  }
}
