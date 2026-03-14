export declare enum SessionState {
    WAITING_FOR_AGENT = "waiting_for_agent",
    WAITING_FOR_MOBILE = "waiting_for_mobile",
    PAIRED = "paired",
    AGENT_DISCONNECTED = "agent_disconnected",
    MOBILE_DISCONNECTED = "mobile_disconnected",
    EXPIRED = "expired",
    ERROR = "error"
}
export declare enum SessionErrorCode {
    INVALID_TOKEN = "invalid_token",
    SESSION_EXPIRED = "session_expired",
    SESSION_NOT_FOUND = "session_not_found",
    AGENT_ALREADY_CONNECTED = "agent_already_connected",
    UNAUTHORIZED_EVENT = "unauthorized_event"
}
export interface SessionInfo {
    sessionId: string;
    token: string;
    state: SessionState;
    agentConnected: boolean;
    mobileConnected: boolean;
    pairedAt: number | null;
    expiresAt: number;
}
//# sourceMappingURL=session.types.d.ts.map