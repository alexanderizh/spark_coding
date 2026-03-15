"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QR_SCHEME = exports.CliTypes = exports.Events = void 0;
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
    RUNTIME_ENSURE: 'runtime:ensure',
    RUNTIME_STATUS: 'runtime:status',
    DEVICE_REGISTER: 'device:register', // Either → Server: announce device fingerprint
    // Desktop → Server
    DESKTOP_STATUS_REPORT: 'desktop:status:report', // Desktop daemon health report
    DESKTOP_STATUS_REQUEST: 'desktop:status:request', // Server → Desktop: re-report now
    DESKTOP_STATUS_UPDATE: 'desktop:status:update', // Server → Mobile: status changed
    // Mobile → Server
    SESSION_RESUME: 'session:resume', // Reconnect with existing token (no QR)
    // Either → Server
    SESSION_DELETE: 'session:delete', // Client requests session deletion
    // Server → Client (both sides)
    SESSION_STATE: 'session:state',
    SESSION_PAIR: 'session:pair',
    SESSION_ERROR: 'session:error',
    SESSION_RESUMED: 'session:resumed', // Server → client: resume confirmed
    SESSION_DELETED: 'session:deleted', // Server → client: session was deleted
    TERMINAL_SNAPSHOT: 'terminal:snapshot', // Server → Mobile: full-state snapshot
};
exports.CliTypes = {
    CLAUDE: 'claude',
};
// ── QR pairing URL ───────────────────────────────────────────────────────────
exports.QR_SCHEME = 'sparkcoder';
function buildPairUrl(serverUrl, token, desktopDeviceId) {
    let url = `${exports.QR_SCHEME}://pair?token=${token}&server=${encodeURIComponent(serverUrl)}`;
    if (desktopDeviceId)
        url += `&did=${desktopDeviceId}`;
    return url;
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
        const desktopDeviceId = parsed.searchParams.get('did') ?? undefined;
        return { token, server: decodeURIComponent(server), desktopDeviceId };
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=protocol.js.map