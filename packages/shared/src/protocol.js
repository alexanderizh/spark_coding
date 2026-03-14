"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QR_SCHEME = exports.Events = void 0;
exports.buildPairUrl = buildPairUrl;
exports.parsePairUrl = parsePairUrl;
// ── Event names ─────────────────────────────────────────────────────────────
exports.Events = {
    // Client → Server (agent side)
    AGENT_REGISTER: 'agent:register',
    TERMINAL_OUTPUT: 'terminal:output',
    CLAUDE_PROMPT: 'claude:prompt',
    // Client → Server (mobile side)
    MOBILE_JOIN: 'mobile:join',
    TERMINAL_INPUT: 'terminal:input',
    TERMINAL_RESIZE: 'terminal:resize',
    // Either → Server
    SESSION_PING: 'session:ping',
    // Server → Client (both sides)
    SESSION_STATE: 'session:state',
    SESSION_PAIR: 'session:pair',
    SESSION_ERROR: 'session:error',
};
// ── QR pairing URL ───────────────────────────────────────────────────────────
exports.QR_SCHEME = 'remoteclaude';
function buildPairUrl(serverUrl, token) {
    return `${exports.QR_SCHEME}://pair?token=${token}&server=${encodeURIComponent(serverUrl)}`;
}
function parsePairUrl(url) {
    try {
        if (!url.startsWith(`${exports.QR_SCHEME}://pair`))
            return null;
        const parsed = new URL(url.replace(`${exports.QR_SCHEME}://`, 'http://pair/'));
        const token = parsed.searchParams.get('token');
        const server = parsed.searchParams.get('server');
        if (!token || !server)
            return null;
        return { token, server: decodeURIComponent(server) };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=protocol.js.map