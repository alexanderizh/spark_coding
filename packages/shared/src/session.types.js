"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionErrorCode = exports.SessionState = void 0;
var SessionState;
(function (SessionState) {
    SessionState["WAITING_FOR_AGENT"] = "waiting_for_agent";
    SessionState["WAITING_FOR_MOBILE"] = "waiting_for_mobile";
    SessionState["PAIRED"] = "paired";
    SessionState["AGENT_DISCONNECTED"] = "agent_disconnected";
    SessionState["MOBILE_DISCONNECTED"] = "mobile_disconnected";
    SessionState["EXPIRED"] = "expired";
    SessionState["ERROR"] = "error";
})(SessionState || (exports.SessionState = SessionState = {}));
var SessionErrorCode;
(function (SessionErrorCode) {
    SessionErrorCode["INVALID_TOKEN"] = "invalid_token";
    SessionErrorCode["SESSION_EXPIRED"] = "session_expired";
    SessionErrorCode["SESSION_NOT_FOUND"] = "session_not_found";
    SessionErrorCode["AGENT_ALREADY_CONNECTED"] = "agent_already_connected";
    SessionErrorCode["UNAUTHORIZED_EVENT"] = "unauthorized_event";
})(SessionErrorCode || (exports.SessionErrorCode = SessionErrorCode = {}));
//# sourceMappingURL=session.types.js.map