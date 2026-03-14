import { WSController, OnWSConnection, OnWSDisConnection, OnWSMessage, Inject, App } from '@midwayjs/decorator';
import { Application, Context } from '@midwayjs/socketio';
import { SessionService } from '../service/session.service';
import {
  Events,
  SessionState,
  SessionErrorCode,
  AgentRegisterPayload,
  MobileJoinPayload,
  TerminalOutputPayload,
  TerminalInputPayload,
  TerminalResizePayload,
  ClaudePromptPayload,
  SessionPingPayload,
  SessionStatePayload,
  SessionPairPayload,
  SessionErrorPayload,
} from '@spark_coder/shared';

const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_EVENTS = 100;

interface SocketMeta {
  sessionId: string;
  token: string;
  role: 'agent' | 'mobile';
  eventCount: number;
  windowStart: number;
}

// In-memory map: socketId → SocketMeta
const socketMeta = new Map<string, SocketMeta>();

@WSController('/')
export class RelayController {
  @App('socketIO')
  app: Application;

  @Inject('socket')
  ctx: Context;

  @Inject()
  sessionService: SessionService;

  // ── Connection ──────────────────────────────────────────────────────────────

  @OnWSConnection()
  async onConnect() {
    const socket = this.ctx;
    const token = socket.handshake.auth?.token as string;
    const role = socket.handshake.auth?.role as 'agent' | 'mobile';

    if (!token || !['agent', 'mobile'].includes(role)) {
      this.sendError(SessionErrorCode.INVALID_TOKEN, 'Missing or invalid auth');
      socket.disconnect(true);
      return;
    }

    const session = await this.sessionService.findByToken(token);
    if (!session) {
      this.sendError(SessionErrorCode.SESSION_NOT_FOUND, 'Session not found');
      socket.disconnect(true);
      return;
    }
    if (this.sessionService.isExpired(session)) {
      this.sendError(SessionErrorCode.SESSION_EXPIRED, 'Session has expired');
      socket.disconnect(true);
      return;
    }

    // Store metadata for this socket
    socketMeta.set(socket.id, {
      sessionId: session.id,
      token,
      role,
      eventCount: 0,
      windowStart: Date.now(),
    });

    socket.join(session.id);
  }

  // ── Disconnect ──────────────────────────────────────────────────────────────

  @OnWSDisConnection()
  async onDisconnect(_reason: string) {
    const socket = this.ctx;
    const meta = socketMeta.get(socket.id);
    if (!meta) return;
    socketMeta.delete(socket.id);

    const session = await this.sessionService.findById(meta.sessionId);
    if (!session || this.sessionService.isExpired(session)) return;

    if (meta.role === 'agent') {
      await this.sessionService.updateState(meta.sessionId, {
        state: SessionState.MOBILE_DISCONNECTED,
        agentSocketId: null,
      });
    } else {
      await this.sessionService.updateState(meta.sessionId, {
        state: session.agentSocketId ? SessionState.AGENT_DISCONNECTED : SessionState.WAITING_FOR_AGENT,
        mobileSocketId: null,
      });
    }

    const updated = await this.sessionService.findById(meta.sessionId);
    if (updated) this.broadcastState(meta.sessionId, updated);
  }

  // ── Agent events ────────────────────────────────────────────────────────────

  @OnWSMessage(Events.AGENT_REGISTER)
  async onAgentRegister(payload: AgentRegisterPayload) {
    const meta = this.verifyRole('agent');
    if (!meta) return;

    const socket = this.ctx;
    const session = await this.sessionService.findById(meta.sessionId);
    if (!session) return;

    if (session.agentSocketId && session.agentSocketId !== socket.id) {
      this.sendError(SessionErrorCode.AGENT_ALREADY_CONNECTED, 'Another agent is already connected');
      return;
    }

    await this.sessionService.updateState(meta.sessionId, {
      state: SessionState.WAITING_FOR_MOBILE,
      agentSocketId: socket.id,
      agentPlatform: payload.platform,
    });

    const updated = await this.sessionService.findById(meta.sessionId);
    if (updated) this.broadcastState(meta.sessionId, updated);
  }

  @OnWSMessage(Events.TERMINAL_OUTPUT)
  async onTerminalOutput(payload: TerminalOutputPayload) {
    const meta = this.verifyRole('agent');
    if (!meta || !this.checkRateLimit(meta)) return;
    if (!this.checkPayloadSize(payload.data)) return;

    await this.sessionService.touchActivity(meta.sessionId);

    // Forward only to mobile sockets in the room
    this.ctx.to(meta.sessionId).emit(Events.TERMINAL_OUTPUT, payload);
  }

  @OnWSMessage(Events.CLAUDE_PROMPT)
  async onClaudePrompt(payload: ClaudePromptPayload) {
    const meta = this.verifyRole('agent');
    if (!meta) return;
    this.ctx.to(meta.sessionId).emit(Events.CLAUDE_PROMPT, payload);
  }

  // ── Mobile events ───────────────────────────────────────────────────────────

  @OnWSMessage(Events.MOBILE_JOIN)
  async onMobileJoin(payload: MobileJoinPayload) {
    const meta = this.verifyRole('mobile');
    if (!meta) return;

    const socket = this.ctx;
    const session = await this.sessionService.findById(meta.sessionId);
    if (!session) return;

    if (!session.agentSocketId) {
      this.sendError(SessionErrorCode.SESSION_NOT_FOUND, 'Agent is not yet connected');
      return;
    }

    const now = new Date();
    await this.sessionService.updateState(meta.sessionId, {
      state: SessionState.PAIRED,
      mobileSocketId: socket.id,
      mobileDeviceId: payload.deviceId,
      pairedAt: session.pairedAt ?? now,
    });

    const pairPayload: SessionPairPayload = {
      sessionId: meta.sessionId,
      mobileDeviceId: payload.deviceId,
      pairedAt: (session.pairedAt ?? now).getTime(),
    };
    // Notify both agent and mobile
    this.app.to(meta.sessionId).emit(Events.SESSION_PAIR, pairPayload);

    const updated = await this.sessionService.findById(meta.sessionId);
    if (updated) this.broadcastState(meta.sessionId, updated);
  }

  @OnWSMessage(Events.TERMINAL_INPUT)
  async onTerminalInput(payload: TerminalInputPayload) {
    const meta = this.verifyRole('mobile');
    if (!meta || !this.checkRateLimit(meta)) return;
    if (!this.checkPayloadSize(payload.data)) return;

    this.ctx.to(meta.sessionId).emit(Events.TERMINAL_INPUT, payload);
  }

  @OnWSMessage(Events.TERMINAL_RESIZE)
  async onTerminalResize(payload: TerminalResizePayload) {
    const meta = this.verifyRole('mobile');
    if (!meta) return;
    this.ctx.to(meta.sessionId).emit(Events.TERMINAL_RESIZE, payload);
  }

  // ── Keepalive ───────────────────────────────────────────────────────────────

  @OnWSMessage(Events.SESSION_PING)
  async onPing(payload: SessionPingPayload) {
    const meta = socketMeta.get(this.ctx.id);
    if (!meta) return;
    await this.sessionService.touchActivity(meta.sessionId);
    this.ctx.emit(Events.SESSION_PING, { ...payload, timestamp: Date.now() });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private verifyRole(expectedRole: 'agent' | 'mobile'): SocketMeta | null {
    const meta = socketMeta.get(this.ctx.id);
    if (!meta || meta.role !== expectedRole) {
      this.sendError(SessionErrorCode.UNAUTHORIZED_EVENT, `Only ${expectedRole} can emit this event`);
      return null;
    }
    return meta;
  }

  private checkRateLimit(meta: SocketMeta): boolean {
    const now = Date.now();
    if (now - meta.windowStart > RATE_LIMIT_WINDOW_MS) {
      meta.eventCount = 0;
      meta.windowStart = now;
    }
    meta.eventCount++;
    return meta.eventCount <= RATE_LIMIT_MAX_EVENTS;
  }

  private checkPayloadSize(data: string): boolean {
    return Buffer.byteLength(data, 'utf8') <= MAX_PAYLOAD_BYTES;
  }

  private sendError(code: SessionErrorCode, message: string) {
    const payload: SessionErrorPayload = { code, message };
    this.ctx.emit(Events.SESSION_ERROR, payload);
  }

  private broadcastState(sessionId: string, session: {
    state: SessionState;
    agentSocketId: string | null;
    mobileSocketId: string | null;
  }) {
    const payload: SessionStatePayload = {
      sessionId,
      state: session.state,
      agentConnected: !!session.agentSocketId,
      mobileConnected: !!session.mobileSocketId,
      timestamp: Date.now(),
    };
    this.app.to(sessionId).emit(Events.SESSION_STATE, payload);
  }
}
