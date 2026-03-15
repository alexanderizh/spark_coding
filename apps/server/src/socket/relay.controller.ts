import { WSController, OnWSConnection, OnWSDisConnection, OnWSMessage, Inject, App } from '@midwayjs/decorator';
import { Application, Context } from '@midwayjs/socketio';
import { SessionService } from '../service/session.service';
import { DeviceService } from '../service/device.service';
import {
  Events,
  SessionState,
  SessionErrorCode,
  AgentRegisterPayload,
  MobileJoinPayload,
  TerminalOutputPayload,
  TerminalSnapshotPayload,
  TerminalInputPayload,
  TerminalResizePayload,
  ClaudePromptPayload,
  SessionPingPayload,
  SessionStatePayload,
  SessionPairPayload,
  SessionErrorPayload,
  SessionDeletedPayload,
  RuntimeEnsurePayload,
  RuntimeStatusPayload,
  DeviceRegisterPayload,
  DesktopStatusReportPayload,
  SessionResumePayload,
  SessionResumedPayload,
  DesktopStatusUpdatePayload,
} from '@spark_coder/shared';

const MAX_PAYLOAD_BYTES    = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_EVENTS = 100;
const SNAPSHOT_MAX_BYTES   = 48 * 1024;

interface SocketMeta {
  sessionId:     string;
  token:         string;
  role:          'agent' | 'mobile';
  deviceId:      string | null;   // physical device fingerprint
  agentHostname: string | null;
  eventCount:    number;
  windowStart:   number;
}

// In-memory map: socketId → SocketMeta (rebuilt on reconnect)
const socketMeta = new Map<string, SocketMeta>();

// In-memory map: sessionId → latest snapshot (full-state)
const snapshotCache = new Map<string, string>();

@WSController('/')
export class RelayController {
  @App('socketIO')
  app: Application;

  @Inject('socket')
  ctx: Context;

  @Inject()
  sessionService: SessionService;

  @Inject()
  deviceService: DeviceService;

  private log(level: 'info' | 'warn', msg: string, ...args: unknown[]): void {
    const fn = level === 'info' ? console.info : console.warn;
    fn.call(console, '[relay]', msg, ...args);
  }

  // ── Connection ──────────────────────────────────────────────────────────

  @OnWSConnection()
  async onConnect() {
    const socket = this.ctx;
    const token    = socket.handshake.auth?.token  as string;
    const role     = socket.handshake.auth?.role   as 'agent' | 'mobile';
    const deviceId = socket.handshake.auth?.deviceId as string | undefined;

    this.log('info', '连接请求 socketId=%s role=%s', socket.id, role ?? '?');

    if (!token || !['agent', 'mobile'].includes(role)) {
      this.log('warn', '连接拒绝 鉴权失败 socketId=%s', socket.id);
      this.sendError(SessionErrorCode.INVALID_TOKEN, 'Missing or invalid auth');
      socket.disconnect(true);
      return;
    }

    // Try primary token first, then scan tokens array
    const session = await this.sessionService.findByAnyToken(token);
    if (!session) {
      this.log('warn', '连接拒绝 会话不存在 socketId=%s role=%s', socket.id, role);
      this.sendError(SessionErrorCode.SESSION_NOT_FOUND, 'Session not found');
      socket.disconnect(true);
      return;
    }
    if (this.sessionService.isExpired(session)) {
      this.log('warn', '连接拒绝 会话已过期 socketId=%s role=%s', socket.id, role);
      this.sendError(SessionErrorCode.SESSION_EXPIRED, 'Session has expired');
      socket.disconnect(true);
      return;
    }

    socketMeta.set(socket.id, {
      sessionId:     session.id,
      token,
      role,
      deviceId:      deviceId ?? null,
      agentHostname: null,
      eventCount:    0,
      windowStart:   Date.now(),
    });

    socket.join(session.id);
    this.log('info', '连接成功 socketId=%s role=%s sessionId=%s', socket.id, role, session.id);

    // Touch device last-seen
    if (deviceId) {
      await this.deviceService.touchDevice(deviceId).catch(() => {/* ignore */});
    }
  }

  // ── Disconnect ──────────────────────────────────────────────────────────

  @OnWSDisConnection()
  async onDisconnect(reason: string) {
    const socket = this.ctx;
    const meta   = socketMeta.get(socket.id);
    if (!meta) return;
    socketMeta.delete(socket.id);
    this.log('info', '断开连接 socketId=%s role=%s sessionId=%s reason=%s', socket.id, meta.role, meta.sessionId, reason);

    try {
      const session = await this.sessionService.findById(meta.sessionId);
      if (!session || this.sessionService.isExpired(session)) return;

      if (meta.role === 'agent') {
        await this.sessionService.updateState(meta.sessionId, {
          state:         SessionState.AGENT_DISCONNECTED,
          agentSocketId: null,
        });
        // 主机断开时立即将 desktop_status 标记为 offline，避免 mobile 误判在线
        if (session.desktopDeviceId) {
          await this.deviceService.markDesktopOffline(session.desktopDeviceId).catch(() => {/* ignore */});
        }
        // Clear snapshot cache when agent disconnects
        snapshotCache.delete(meta.sessionId);
      } else {
        await this.sessionService.updateState(meta.sessionId, {
          state:          session.agentSocketId
            ? SessionState.MOBILE_DISCONNECTED
            : SessionState.WAITING_FOR_AGENT,
          mobileSocketId: null,
        });
      }

      const updated = await this.sessionService.findById(meta.sessionId);
      if (updated) this.broadcastState(meta.sessionId, updated);
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e?.code !== 'MIDWAY_10001') throw err;
    }
  }

  // ── Agent events ────────────────────────────────────────────────────────

  @OnWSMessage(Events.AGENT_REGISTER)
  async onAgentRegister(payload: AgentRegisterPayload) {
    this.log('info', '收到 agent:register socketId=%s hostname=%s', this.ctx.id, payload.hostname ?? '?');
    const meta = this.verifyRole('agent');
    if (!meta) return;

    const socket  = this.ctx;
    const session = await this.sessionService.findById(meta.sessionId);
    if (!session) return;

    // Only reject if the old socket is actually alive in socketMeta.
    // If onDisconnect hasn't cleared the DB yet (race on reconnect), the old
    // socketId may still be stored but the socket is already gone — allow takeover.
    if (
      session.agentSocketId &&
      session.agentSocketId !== socket.id &&
      socketMeta.has(session.agentSocketId)
    ) {
      this.sendError(SessionErrorCode.AGENT_ALREADY_CONNECTED, 'Another agent is already connected');
      return;
    }

    const hostname = typeof payload.hostname === 'string' ? payload.hostname.trim() : '';
    meta.agentHostname = hostname || null;

    // Store desktop device ID if provided
    const deviceId = payload.deviceId ?? meta.deviceId ?? null;
    if (deviceId) {
      meta.deviceId = deviceId;
      await this.deviceService.upsertDevice({
        id:       deviceId,
        platform: 'desktop',
        hostname: meta.agentHostname,
      }).catch(() => {/* ignore */});
    }

    const hasMobile  = !!session.mobileSocketId;
    const nextState  = hasMobile ? SessionState.PAIRED : SessionState.WAITING_FOR_MOBILE;
    const now        = new Date();
    await this.sessionService.updateState(meta.sessionId, {
      state:           nextState,
      agentSocketId:   socket.id,
      agentPlatform:   payload.platform,
      agentHostname:   meta.agentHostname,
      desktopDeviceId: deviceId,
      pairedAt:        hasMobile ? session.pairedAt ?? now : session.pairedAt,
    });

    if (hasMobile) {
      // If mobile is already present, complete pairing linkage
      if (deviceId && session.mobileDeviceId) {
        await this.sessionService.completePairing(meta.sessionId, {
          desktopDeviceId: deviceId,
          mobileDeviceId:  session.mobileDeviceId,
          launchType:      session.launchType,
          pairedToken:     meta.token,
        }).catch((err: unknown) => {
          this.log('warn', 'completePairing 失败 sessionId=%s err=%s', meta.sessionId, (err as Error)?.message ?? err);
        });
      }
      const pairPayload: SessionPairPayload = {
        sessionId:      meta.sessionId,
        mobileDeviceId: session.mobileDeviceId ?? 'unknown_device',
        agentPlatform:  payload.platform ?? null,
        mobilePlatform: session.mobilePlatform ?? null,
        pairedAt:       (session.pairedAt ?? now).getTime(),
      };
      this.app.to(meta.sessionId).emit(Events.SESSION_PAIR, pairPayload);
      this.log('info', '转发 session:pair sessionId=%s ->mobile', meta.sessionId);
    }

    const updated = await this.sessionService.findById(meta.sessionId);
    if (updated) this.broadcastState(meta.sessionId, updated);
  }

  @OnWSMessage(Events.TERMINAL_OUTPUT)
  async onTerminalOutput(payload: TerminalOutputPayload) {
    const meta = this.verifyRole('agent');
    if (!meta || !this.checkRateLimit(meta)) return;
    if (!this.checkPayloadSize(payload.data)) return;

    // Cache snapshot if present and within size limits
    if (payload.snapshot && Buffer.byteLength(payload.snapshot, 'utf8') <= SNAPSHOT_MAX_BYTES) {
      snapshotCache.set(meta.sessionId, payload.snapshot);
    }

    const dataLen = Buffer.byteLength(payload.data, 'utf8');
    this.log('info', '收到 terminal:output sessionId=%s seq=%s bytes=%s ->mobile', meta.sessionId, payload.seq, dataLen);
    // Use app.to() (io-level broadcast) — more reliable than ctx.to() inside async handlers
    this.app.to(meta.sessionId).emit(Events.TERMINAL_OUTPUT, payload);
    await this.sessionService.touchActivity(meta.sessionId);
  }

  @OnWSMessage(Events.TERMINAL_SNAPSHOT)
  async onTerminalSnapshot(payload: any) {
    const meta = this.verifyRole('agent');
    if (!meta) return;
    const snapshot = payload.snapshot as string | undefined;
    if (!snapshot || Buffer.byteLength(snapshot, 'utf8') > SNAPSHOT_MAX_BYTES) {
      this.log('warn', '收到 terminal:snapshot 大小超限 sessionId=%s bytes=%s', meta.sessionId, Buffer.byteLength(snapshot || '', 'utf8'));
      return;
    }
    snapshotCache.set(meta.sessionId, snapshot);
    this.log('info', '收到 terminal:snapshot sessionId=%s bytes=%s ->mobile', meta.sessionId, Buffer.byteLength(snapshot, 'utf8'));
    this.app.to(meta.sessionId).emit(Events.TERMINAL_SNAPSHOT, payload);
  }

  @OnWSMessage(Events.CLAUDE_PROMPT)
  async onClaudePrompt(payload: ClaudePromptPayload) {
    const meta = this.verifyRole('agent');
    if (!meta) return;
    this.log('info', '收到 claude:prompt sessionId=%s type=%s ->mobile', meta.sessionId, payload.promptType);
    this.ctx.to(meta.sessionId).emit(Events.CLAUDE_PROMPT, payload);
  }

  @OnWSMessage(Events.RUNTIME_STATUS)
  async onRuntimeStatus(payload: RuntimeStatusPayload) {
    const meta = this.verifyRole('agent');
    if (!meta) return;
    this.log('info', '收到 runtime:status sessionId=%s ready=%s ->mobile', meta.sessionId, payload.ready);
    this.ctx.to(meta.sessionId).emit(Events.RUNTIME_STATUS, payload);
  }

  /** Desktop daemon reports health → save to DB → forward to mobile */
  @OnWSMessage(Events.DESKTOP_STATUS_REPORT)
  async onDesktopStatusReport(payload: DesktopStatusReportPayload) {
    const meta = this.verifyRole('agent');
    if (!meta) return;
    this.log('info', '收到 desktop:status:report sessionId=%s deviceId=%s ->mobile', meta.sessionId, payload.deviceId);

    // Persist to DB
    await this.deviceService.upsertDesktopStatus(payload).catch(() => {/* ignore */});

    // Forward updated status to all mobiles in this session
    const fwdPayload: DesktopStatusUpdatePayload = {
      ...payload,
      sessionId:  meta.sessionId,
      updatedAt:  Date.now(),
    };
    this.ctx.to(meta.sessionId).emit(Events.DESKTOP_STATUS_UPDATE, fwdPayload);
  }

  // ── Mobile events ────────────────────────────────────────────────────────

  @OnWSMessage(Events.MOBILE_JOIN)
  async onMobileJoin(payload: MobileJoinPayload) {
    this.log('info', '收到 mobile:join socketId=%s deviceId=%s', this.ctx.id, payload.deviceId ?? payload.mobileDeviceId ?? '?');
    const meta = this.verifyRole('mobile');
    if (!meta) return;

    const socket  = this.ctx;
    const session = await this.sessionService.findById(meta.sessionId);
    if (!session) return;

    const mobileDeviceId = payload.mobileDeviceId ?? payload.deviceId;
    const mobilePlatform = typeof payload.mobilePlatform === 'string'
      ? payload.mobilePlatform.trim()
      : '';

    // Register/touch mobile device
    if (mobileDeviceId) {
      meta.deviceId = mobileDeviceId;
      await this.deviceService.upsertDevice({
        id:       mobileDeviceId,
        platform: 'mobile',
      }).catch(() => {/* ignore */});
    }

    const now      = new Date();
    const hasAgent = !!session.agentSocketId;
    const nextState = hasAgent ? SessionState.PAIRED : SessionState.WAITING_FOR_AGENT;

    await this.sessionService.updateState(meta.sessionId, {
      state:          nextState,
      mobileSocketId: socket.id,
      mobileDeviceId: mobileDeviceId,
      mobilePlatform: mobilePlatform || session.mobilePlatform,
      pairedAt:       hasAgent ? session.pairedAt ?? now : session.pairedAt,
    });

    if (hasAgent) {
      // Complete pairing with connectionKey
      const desktopDeviceId = session.desktopDeviceId ?? this.findAgentDeviceId(meta.sessionId);
      if (desktopDeviceId && mobileDeviceId) {
        await this.sessionService.completePairing(meta.sessionId, {
          desktopDeviceId,
          mobileDeviceId,
          launchType:  session.launchType,
          pairedToken: meta.token,
        }).catch((err: unknown) => {
          this.log('warn', 'completePairing 失败 sessionId=%s err=%s', meta.sessionId, (err as Error)?.message ?? err);
        });
      }

      const pairPayload: SessionPairPayload = {
        sessionId:      meta.sessionId,
        mobileDeviceId: mobileDeviceId,
        agentPlatform:  session.agentPlatform ?? null,
        mobilePlatform: mobilePlatform || session.mobilePlatform,
        pairedAt:       (session.pairedAt ?? now).getTime(),
      };
      this.app.to(meta.sessionId).emit(Events.SESSION_PAIR, pairPayload);
      this.log('info', '转发 session:pair sessionId=%s ->agent', meta.sessionId);

      // Also send current desktop status if available
      if (desktopDeviceId) {
        const status = await this.deviceService.getDesktopStatus(desktopDeviceId).catch(() => null);
        if (status) {
          const statusPayload: DesktopStatusUpdatePayload = {
            ...status,
            sessionId: meta.sessionId,
          };
          socket.emit(Events.DESKTOP_STATUS_UPDATE, statusPayload);
        }
      }

      // Send cached snapshot if available
      const snap = snapshotCache.get(meta.sessionId);
      if (snap) {
        socket.emit(Events.TERMINAL_SNAPSHOT, {
          sessionId: meta.sessionId,
          snapshot: snap,
          timestamp: Date.now(),
        });
        this.log('info', '发送缓存 terminal:snapshot 到新加入的 mobile sessionId=%s bytes=%s', meta.sessionId, Buffer.byteLength(snap, 'utf8'));
      }
    }

    const updated = await this.sessionService.findById(meta.sessionId);
    if (updated) this.broadcastState(meta.sessionId, updated);
  }

  @OnWSMessage(Events.TERMINAL_INPUT)
  async onTerminalInput(payload: TerminalInputPayload) {
    const meta = this.verifyRole('mobile');
    if (!meta || !this.checkRateLimit(meta)) return;
    if (!this.checkPayloadSize(payload.data)) return;
    const dataLen = Buffer.byteLength(payload.data, 'utf8');
    this.log('info', '收到 terminal:input sessionId=%s bytes=%s ->agent', meta.sessionId, dataLen);
    this.ctx.to(meta.sessionId).emit(Events.TERMINAL_INPUT, payload);
  }

  @OnWSMessage(Events.TERMINAL_RESIZE)
  async onTerminalResize(payload: TerminalResizePayload) {
    const meta = this.verifyRole('mobile');
    if (!meta) return;
    this.log('info', '收到 terminal:resize sessionId=%s cols=%s rows=%s ->agent', meta.sessionId, payload.cols, payload.rows);
    this.ctx.to(meta.sessionId).emit(Events.TERMINAL_RESIZE, payload);
  }

  @OnWSMessage(Events.RUNTIME_ENSURE)
  async onRuntimeEnsure(payload: RuntimeEnsurePayload) {
    const meta = this.verifyRole('mobile');
    if (!meta) return;
    this.log('info', '收到 runtime:ensure sessionId=%s cliType=%s ->agent', meta.sessionId, payload.cliType);
    const session = await this.sessionService.findById(meta.sessionId);
    if (!session || !session.agentSocketId) {
      this.sendError(SessionErrorCode.SESSION_NOT_FOUND, 'Agent is not connected');
      return;
    }
    this.ctx.to(meta.sessionId).emit(Events.RUNTIME_ENSURE, payload);
  }

  // ── Shared events ────────────────────────────────────────────────────────

  @OnWSMessage(Events.SESSION_PING)
  async onPing(payload: SessionPingPayload) {
    const meta = socketMeta.get(this.ctx.id);
    if (!meta) return;
    await this.sessionService.touchActivity(meta.sessionId);
    this.ctx.emit(Events.SESSION_PING, { ...payload, timestamp: Date.now() });
  }

  @OnWSMessage(Events.DEVICE_REGISTER)
  async onDeviceRegister(payload: DeviceRegisterPayload) {
    const meta = socketMeta.get(this.ctx.id);
    if (!meta) return;
    this.log('info', '收到 device:register socketId=%s deviceId=%s platform=%s', this.ctx.id, payload.deviceId ?? '?', payload.platform ?? '?');

    if (payload.deviceId) {
      meta.deviceId = payload.deviceId;
      await this.deviceService.upsertDevice({
        id:       payload.deviceId,
        platform: payload.platform,
        hostname: payload.hostname ?? null,
        name:     payload.name ?? null,
      }).catch(() => {/* ignore */});
    }
  }

  // ── Session delete ───────────────────────────────────────────────────────

  @OnWSMessage(Events.SESSION_DELETE)
  async onSessionDelete() {
    const meta = socketMeta.get(this.ctx.id);
    if (!meta) return;

    const session = await this.sessionService.findById(meta.sessionId);
    if (!session) return;

    const payload: SessionDeletedPayload = {
      sessionId:     session.id,
      connectionKey: session.connectionKey,
    };

    // Notify all clients in the room before deleting
    this.app.to(meta.sessionId).emit(Events.SESSION_DELETED, payload);
    await this.sessionService.deleteSession(meta.sessionId);
  }

  // ── Keepalive ────────────────────────────────────────────────────────────

  // ── Helpers ──────────────────────────────────────────────────────────────

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
    state:           SessionState;
    agentSocketId:   string | null;
    mobileSocketId:  string | null;
    agentHostname?:  string | null;
  }) {
    const payload: SessionStatePayload = {
      sessionId,
      state:           session.state,
      agentConnected:  !!session.agentSocketId,
      mobileConnected: !!session.mobileSocketId,
      agentHostname:   session.agentHostname ?? this.findAgentHostname(sessionId),
      timestamp:       Date.now(),
    };
    this.log('info', '广播 session:state sessionId=%s state=%s', sessionId, session.state);
    this.app.to(sessionId).emit(Events.SESSION_STATE, payload);
  }

  private findAgentHostname(sessionId: string): string | null {
    for (const meta of socketMeta.values()) {
      if (meta.role === 'agent' && meta.sessionId === sessionId) {
        return meta.agentHostname;
      }
    }
    return null;
  }

  private findAgentDeviceId(sessionId: string): string | null {
    for (const meta of socketMeta.values()) {
      if (meta.role === 'agent' && meta.sessionId === sessionId) {
        return meta.deviceId;
      }
    }
    return null;
  }
}
