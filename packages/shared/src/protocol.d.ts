import { SessionState, SessionErrorCode } from './session.types';
import { ClaudePromptType } from './claude.types';
import { DesktopStatusReport, DesktopStatusSnapshot, DeviceInfo } from './device.types';
export declare const Events: {
    readonly AGENT_REGISTER: "agent:register";
    readonly TERMINAL_OUTPUT: "terminal:output";
    readonly CLAUDE_PROMPT: "claude:prompt";
    readonly MOBILE_JOIN: "mobile:join";
    readonly TERMINAL_INPUT: "terminal:input";
    readonly TERMINAL_RESIZE: "terminal:resize";
    readonly SESSION_PING: "session:ping";
    readonly RUNTIME_ENSURE: "runtime:ensure";
    readonly RUNTIME_STATUS: "runtime:status";
    readonly DEVICE_REGISTER: "device:register";
    readonly DESKTOP_STATUS_REPORT: "desktop:status:report";
    readonly DESKTOP_STATUS_REQUEST: "desktop:status:request";
    readonly DESKTOP_STATUS_UPDATE: "desktop:status:update";
    readonly SESSION_RESUME: "session:resume";
    readonly SESSION_DELETE: "session:delete";
    readonly SESSION_STATE: "session:state";
    readonly SESSION_PAIR: "session:pair";
    readonly SESSION_ERROR: "session:error";
    readonly SESSION_RESUMED: "session:resumed";
    readonly SESSION_DELETED: "session:deleted";
    readonly TERMINAL_SNAPSHOT: "terminal:snapshot";
};
export type EventName = typeof Events[keyof typeof Events];
export declare const CliTypes: {
    readonly CLAUDE: "claude";
};
export type CliType = typeof CliTypes[keyof typeof CliTypes];
export interface AgentRegisterPayload {
    sessionToken: string;
    agentVersion: string;
    platform: string;
    hostname: string;
    deviceId?: string;
}
export interface MobileJoinPayload {
    sessionToken: string;
    deviceId: string;
    mobileDeviceId?: string;
}
/** Reconnect with a previously-issued token — no QR scan needed */
export interface SessionResumePayload {
    token: string;
    role: 'agent' | 'mobile';
    deviceId: string;
}
export interface SessionResumedPayload {
    sessionId: string;
    connectionKey: string;
    state: SessionState;
    agentConnected: boolean;
    mobileConnected: boolean;
    pairedAt: number | null;
}
/** Desktop device registration (announce fingerprint + metadata) */
export interface DeviceRegisterPayload extends DeviceInfo {
}
/** Desktop → Server: periodic health report */
export interface DesktopStatusReportPayload extends DesktopStatusReport {
}
/** Server → Mobile: forwarded desktop status */
export interface DesktopStatusUpdatePayload extends DesktopStatusSnapshot {
    sessionId: string;
}
export interface TerminalOutputPayload {
    sessionId: string;
    data: string;
    timestamp: number;
    seq: number;
    snapshot?: string;
}
export interface TerminalSnapshotPayload {
    sessionId: string;
    snapshot: string;
    timestamp: number;
}
export interface TerminalInputPayload {
    sessionId: string;
    data: string;
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
    pairedAt: number;
}
export interface ClaudePromptPayload {
    sessionId: string;
    promptType: ClaudePromptType;
    rawText: string;
    timestamp: number;
}
export interface SessionErrorPayload {
    code: SessionErrorCode;
    message: string;
}
export interface SessionDeletedPayload {
    sessionId: string;
    connectionKey: string | null;
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
export declare const QR_SCHEME = "sparkcoder";
export declare function buildPairUrl(serverUrl: string, token: string, desktopDeviceId?: string): string;
export declare function parsePairUrl(url: string): {
    token: string;
    server: string;
    desktopDeviceId?: string;
} | null;
//# sourceMappingURL=protocol.d.ts.map