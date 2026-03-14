import { io, Socket } from 'socket.io-client';
import os from 'os';
import {
  Events,
  SessionState,
  SessionErrorCode,
  AgentRegisterPayload,
  TerminalOutputPayload,
  TerminalInputPayload,
  TerminalResizePayload,
  ClaudePromptPayload,
  SessionPairPayload,
  SessionStatePayload,
  SessionErrorPayload,
  ClaudePromptType,
  RuntimeEnsurePayload,
  RuntimeStatusPayload,
  CliTypes,
} from '@spark_coder/shared';
import { AgentConfig } from '../utils/config';
import { PtyManager } from '../pty/pty-manager';
import { PromptDetector } from '../pty/prompt-detector';

export interface AgentSocketOptions {
  serverUrl: string;
  token: string;
  sessionId: string;
  config: AgentConfig;
}

export class AgentSocketClient {
  private socket: Socket;
  private pty: PtyManager;
  private detector: PromptDetector;
  private sessionId: string;
  private outputSeq = 0;
  private isPaired = false;

  constructor(opts: AgentSocketOptions) {
    this.sessionId = opts.sessionId;

    // ── Prompt detector ───────────────────────────────────────────────────────
    this.detector = new PromptDetector((type: ClaudePromptType, rawText: string) => {
      if (!this.socket.connected) return;
      const payload: ClaudePromptPayload = {
        sessionId: this.sessionId,
        promptType: type,
        rawText,
        timestamp: Date.now(),
      };
      this.socket.emit(Events.CLAUDE_PROMPT, payload);
    });

    // ── PTY manager ───────────────────────────────────────────────────────────
    this.pty = new PtyManager(
      (data: string, seq: number) => {
        if (!this.socket.connected) return;
        const payload: TerminalOutputPayload = {
          sessionId: this.sessionId,
          data,
          timestamp: Date.now(),
          seq,
        };
        this.socket.emit(Events.TERMINAL_OUTPUT, payload);
      },
      (data: string) => this.detector.feed(data)
    );

    // ── Socket.IO client ──────────────────────────────────────────────────────
    this.socket = io(opts.serverUrl, {
      auth: { token: opts.token, role: 'agent' },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
      transports: ['websocket'],
    });

    this.registerEvents(opts);
  }

  private registerEvents(opts: AgentSocketOptions): void {
    const { config } = opts;

    this.socket.on('connect', () => {
      const payload: AgentRegisterPayload = {
        sessionToken: opts.token,
        agentVersion: config.agentVersion,
        platform: process.platform,
        hostname: os.hostname(),
      };
      this.socket.emit(Events.AGENT_REGISTER, payload);
      console.log('[socket] Connected to server, waiting for mobile…');
    });

    this.socket.on('reconnect', () => {
      console.log('[socket] Reconnected — re-registering agent');
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log(`[socket] Disconnected: ${reason}. PTY keeps running.`);
    });

    // ── Paired: spawn Claude CLI ───────────────────────────────────────────
    this.socket.on(Events.SESSION_PAIR, (payload: SessionPairPayload) => {
      if (this.isPaired) {
        // Reconnected mobile — flush buffered output
        const buffered = this.pty.flushRingBuffer();
        if (buffered) {
          const outPayload: TerminalOutputPayload = {
            sessionId: this.sessionId,
            data: buffered,
            timestamp: Date.now(),
            seq: ++this.outputSeq,
          };
          this.socket.emit(Events.TERMINAL_OUTPUT, outPayload);
        }
        return;
      }
      this.isPaired = true;
      console.log(`[session] Paired with mobile device: ${payload.mobileDeviceId}`);
      console.log('[pty] Spawning Claude CLI…\n');
      this.pty.spawn(config);
    });

    // ── Session state updates ─────────────────────────────────────────────
    this.socket.on(Events.SESSION_STATE, (payload: SessionStatePayload) => {
      if (payload.state === SessionState.MOBILE_DISCONNECTED) {
        console.log('\n[session] Mobile disconnected — Claude keeps running, waiting for reconnect…');
      }
    });

    // ── Input from mobile ─────────────────────────────────────────────────
    this.socket.on(Events.TERMINAL_INPUT, (payload: TerminalInputPayload) => {
      this.pty.write(payload.data);
    });

    // ── Resize from mobile ─────────────────────────────────────────────────
    this.socket.on(Events.TERMINAL_RESIZE, (payload: TerminalResizePayload) => {
      this.pty.resize(payload.cols, payload.rows);
    });

    this.socket.on(Events.RUNTIME_ENSURE, (payload: RuntimeEnsurePayload) => {
      if (payload.cliType !== CliTypes.CLAUDE) return;
      if (this.pty.isAlive()) {
        this.emitRuntimeStatus({
          sessionId: this.sessionId,
          cliType: CliTypes.CLAUDE,
          ready: true,
          started: false,
          timestamp: Date.now(),
        });
        return;
      }
      try {
        this.pty.spawn(config);
        this.emitRuntimeStatus({
          sessionId: this.sessionId,
          cliType: CliTypes.CLAUDE,
          ready: true,
          started: true,
          timestamp: Date.now(),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.emitRuntimeStatus({
          sessionId: this.sessionId,
          cliType: CliTypes.CLAUDE,
          ready: false,
          started: false,
          message,
          timestamp: Date.now(),
        });
      }
    });

    // ── Errors ─────────────────────────────────────────────────────────────
    this.socket.on(Events.SESSION_ERROR, (payload: SessionErrorPayload) => {
      console.error(`[error] ${payload.code}: ${payload.message}`);
      if (payload.code === SessionErrorCode.SESSION_EXPIRED) {
        console.error('[session] Session expired — please restart spark');
        this.destroy();
        process.exit(1);
      }
    });

    // ── Keepalive ──────────────────────────────────────────────────────────
    setInterval(() => {
      if (this.socket.connected) {
        this.socket.emit(Events.SESSION_PING, {
          sessionId: this.sessionId,
          timestamp: Date.now(),
        });
      }
    }, 30_000);
  }

  destroy(): void {
    this.detector.destroy();
    this.pty.destroy();
    this.socket.disconnect();
  }

  private emitRuntimeStatus(payload: RuntimeStatusPayload): void {
    if (!this.socket.connected) return;
    this.socket.emit(Events.RUNTIME_STATUS, payload);
  }
}
