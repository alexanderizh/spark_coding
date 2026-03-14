import { SessionState, SessionErrorCode } from './session.types';
import { ClaudePromptType } from './claude.types';
export declare const Events: {
    readonly AGENT_REGISTER: "agent:register";
    readonly TERMINAL_OUTPUT: "terminal:output";
    readonly CLAUDE_PROMPT: "claude:prompt";
    readonly MOBILE_JOIN: "mobile:join";
    readonly TERMINAL_INPUT: "terminal:input";
    readonly TERMINAL_RESIZE: "terminal:resize";
    readonly SESSION_PING: "session:ping";
    readonly SESSION_STATE: "session:state";
    readonly SESSION_PAIR: "session:pair";
    readonly SESSION_ERROR: "session:error";
};
export type EventName = typeof Events[keyof typeof Events];
export interface AgentRegisterPayload {
    sessionToken: string;
    agentVersion: string;
    platform: string;
}
export interface MobileJoinPayload {
    sessionToken: string;
    deviceId: string;
}
export interface TerminalOutputPayload {
    sessionId: string;
    data: string;
    timestamp: number;
    seq: number;
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
export interface SessionPingPayload {
    sessionId: string;
    timestamp: number;
}
export declare const QR_SCHEME = "sparkcoder";
export declare function buildPairUrl(serverUrl: string, token: string): string;
export declare function parsePairUrl(url: string): {
    token: string;
    server: string;
} | null;
//# sourceMappingURL=protocol.d.ts.map