import { EventEmitter } from 'events'
import { execFileSync } from 'child_process'
import os from 'os'
import * as pty from 'node-pty'
import { io, Socket } from 'socket.io-client'
import axios from 'axios'
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
  CLAUDE_PROMPT_PATTERNS,
  RuntimeEnsurePayload,
  RuntimeStatusPayload,
  CliTypes,
} from '@spark_coder/shared'

// ── Constants ──────────────────────────────────────────────────────────────────
const BATCH_INTERVAL_MS = 16      // ~60fps
const RING_BUFFER_SIZE  = 1024 * 1024  // 1 MB
const ROLLING_BUF_SIZE  = 2048
const DEBOUNCE_MS       = 100

// ── Types ──────────────────────────────────────────────────────────────────────
export type BridgeStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'paired'
  | 'error'
  | 'expired'
  | 'stopped'

export interface BridgeConfig {
  serverUrl: string
  claudePath: string
  cwd: string
}

export interface StatusInfo {
  status: BridgeStatus
  message?: string
}

export interface QrInfo {
  qrPayload: string
  token: string
  sessionId: string
}

// ── TerminalBridge ─────────────────────────────────────────────────────────────
/**
 * Encapsulates all terminal logic (previously apps/terminal) as an EventEmitter.
 * Runs inside the Electron main process — no process.exit(), no CLI args.
 *
 * Events emitted:
 *   'status'      → StatusInfo
 *   'qr'          → QrInfo
 *   'output'      → string  (terminal output chunk, for conversation view)
 *   'prompt'      → { type: string; rawText: string }
 *   'claude-exit' → exitCode: number
 */
export class TerminalBridge extends EventEmitter {
  private socket?: Socket
  private ptyProcess?: pty.IPty
  private sessionId?: string
  private token?: string
  private qrInfo?: QrInfo
  private status: BridgeStatus = 'idle'
  private isPaired = false
  private outputSeq = 0
  private config?: BridgeConfig

  // Batching
  private batchBuffer = ''
  private batchTimer?: NodeJS.Timeout

  // Ring buffer (reconnect catch-up)
  private ringBuffer: string[] = []
  private ringBufferBytes = 0

  // Prompt detector state
  private detectorBuffer = ''
  private detectorTimer?: NodeJS.Timeout

  // Keepalive
  private pingInterval?: NodeJS.Timeout

  // Pending runtime status to send after reconnect
  private pendingRuntimeStatus?: RuntimeStatusPayload

  // ── Public API ───────────────────────────────────────────────────────────────

  getStatus(): BridgeStatus {
    return this.status
  }

  getQrInfo(): QrInfo | undefined {
    return this.qrInfo
  }

  async start(config: BridgeConfig): Promise<void> {
    if (this.status !== 'idle' && this.status !== 'stopped' && this.status !== 'error' && this.status !== 'expired') {
      return
    }
    this.config = config
    this.reset()
    this.setStatus('connecting', `Connecting to ${config.serverUrl}…`)

    // Create session on relay server
    let session: { sessionId: string; token: string; qrPayload: string }
    try {
      const res = await axios.post<{ success: boolean; data: typeof session }>(
        `${config.serverUrl}/api/session`,
        {},
        { timeout: 10_000 },
      )
      if (!res.data.success) throw new Error('Server returned failure')
      session = res.data.data
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus('error', `Cannot reach relay server: ${msg}`)
      return
    }

    this.sessionId = session.sessionId
    this.token = session.token
    this.qrInfo = {
      qrPayload: session.qrPayload,
      token: session.token,
      sessionId: session.sessionId,
    }

    // Connect WebSocket
    this.socket = io(config.serverUrl, {
      auth: { token: session.token, role: 'agent' },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
      transports: ['websocket'],
    })

    this.registerSocketEvents()
  }

  stop(): void {
    this.clearTimers()
    try { this.ptyProcess?.kill() } catch { /* ignore */ }
    this.socket?.disconnect()
    this.ptyProcess = undefined
    this.socket = undefined
    this.isPaired = false
    this.outputSeq = 0
    this.pendingRuntimeStatus = undefined
    this.setStatus('stopped', 'Session stopped')
  }

  // ── Socket events ─────────────────────────────────────────────────────────────

  private registerSocketEvents(): void {
    const socket = this.socket!

    socket.on('connect', () => {
      const payload: AgentRegisterPayload = {
        sessionToken: this.token!,
        agentVersion: '1.0.0',
        platform: process.platform,
        hostname: os.hostname(),
      }
      socket.emit(Events.AGENT_REGISTER, payload)
      this.setStatus('waiting', 'Waiting for mobile to pair…')
      // Re-emit QR info after reconnect so renderer can re-render it
      if (this.qrInfo) this.emit('qr', this.qrInfo)
      // Re-emit runtime status if Claude is already running
      if (this.ptyProcess && this.sessionId) {
        this.emitRuntimeStatus({
          sessionId: this.sessionId,
          cliType: CliTypes.CLAUDE,
          ready: true,
          started: false,
          timestamp: Date.now(),
        })
      }
    })

    socket.on('reconnect', () => {
      // Re-emit pending runtime status after reconnect
      if (this.pendingRuntimeStatus && this.sessionId) {
        this.socket?.emit(Events.RUNTIME_STATUS, this.pendingRuntimeStatus)
      }
    })

    socket.on('disconnect', (_reason: string) => {
      // Socket auto-reconnects; don't change UI status
    })

    // Mobile paired → spawn Claude
    socket.on(Events.SESSION_PAIR, (payload: SessionPairPayload) => {
      if (this.isPaired) {
        // Mobile reconnected → flush ring buffer
        const buffered = this.flushRingBuffer()
        if (buffered && socket.connected) {
          const out: TerminalOutputPayload = {
            sessionId: this.sessionId!,
            data: buffered,
            timestamp: Date.now(),
            seq: ++this.outputSeq,
          }
          socket.emit(Events.TERMINAL_OUTPUT, out)
        }
        return
      }
      this.isPaired = true
      this.setStatus('paired', `Paired with ${payload.mobileDeviceId}`)
      this.spawnClaude()
    })

    // Session state updates
    socket.on(Events.SESSION_STATE, (payload: SessionStatePayload) => {
      if (payload.state === SessionState.MOBILE_DISCONNECTED) {
        this.setStatus('waiting', 'Mobile disconnected — Claude still running…')
      }
    })

    // Input from mobile → write to PTY
    socket.on(Events.TERMINAL_INPUT, (payload: TerminalInputPayload) => {
      this.ptyProcess?.write(payload.data)
    })

    // Resize from mobile
    socket.on(Events.TERMINAL_RESIZE, (payload: TerminalResizePayload) => {
      try { this.ptyProcess?.resize(payload.cols, payload.rows) } catch { /* ignore */ }
    })

    socket.on(Events.RUNTIME_ENSURE, (payload: RuntimeEnsurePayload) => {
      if (payload.cliType !== CliTypes.CLAUDE) {
        return
      }
      // If Claude is already running, respond immediately
      if (this.ptyProcess) {
        this.emitRuntimeStatus({
          sessionId: this.sessionId!,
          cliType: CliTypes.CLAUDE,
          ready: true,
          started: false,
          timestamp: Date.now(),
        })
        return
      }
      // Try to spawn Claude if not already running
      if (!this.config) {
        this.emitRuntimeStatus({
          sessionId: this.sessionId!,
          cliType: CliTypes.CLAUDE,
          ready: false,
          started: false,
          message: 'Configuration not initialized',
          timestamp: Date.now(),
        })
        return
      }
      this.spawnClaude()
      // Emit status after spawning (pty.spawn is synchronous)
      this.emitRuntimeStatus({
        sessionId: this.sessionId!,
        cliType: CliTypes.CLAUDE,
        ready: !!this.ptyProcess,
        started: !!this.ptyProcess,
        message: this.ptyProcess ? undefined : 'Claude CLI failed to start',
        timestamp: Date.now(),
      })
    })

    // Errors
    socket.on(Events.SESSION_ERROR, (payload: SessionErrorPayload) => {
      if (payload.code === SessionErrorCode.SESSION_EXPIRED) {
        this.setStatus('expired', 'Session expired — please start a new session')
        this.stop()
      } else {
        this.emit('error', payload.message)
      }
    })

    // Keepalive ping
    this.pingInterval = setInterval(() => {
      if (socket.connected && this.sessionId) {
        socket.emit(Events.SESSION_PING, { sessionId: this.sessionId, timestamp: Date.now() })
      }
    }, 30_000)
  }

  // ── PTY (Claude CLI) ──────────────────────────────────────────────────────────

  private spawnClaude(): void {
    if (!this.config) return
    const execPath = this.resolveExecutable(this.config.claudePath)

    try {
      this.ptyProcess = pty.spawn(execPath, [], {
        name: 'xterm-256color',
        cols: 220,
        rows: 50,
        cwd: this.config.cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          LANG: 'en_US.UTF-8',
        } as Record<string, string>,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setStatus('error', `Cannot spawn Claude CLI at "${execPath}": ${msg}`)
      return
    }

    this.ptyProcess.onData((data: string) => {
      this.feedDetector(data)
      this.appendToRing(data)
      this.batchOutput(data)
    })

    this.ptyProcess.onExit(({ exitCode }) => {
      this.emit('claude-exit', exitCode)
      this.ptyProcess = undefined
    })
  }

  private emitRuntimeStatus(payload: RuntimeStatusPayload): void {
    // Store as pending in case socket is not connected
    this.pendingRuntimeStatus = payload

    // Emit if socket is connected
    if (this.socket?.connected) {
      this.socket.emit(Events.RUNTIME_STATUS, payload)
    }
  }

  // ── Output batching (~60fps) ──────────────────────────────────────────────────

  private batchOutput(data: string): void {
    this.batchBuffer += data
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        const chunk = this.batchBuffer
        this.batchBuffer = ''
        this.batchTimer = undefined

        if (this.socket?.connected && this.sessionId) {
          const payload: TerminalOutputPayload = {
            sessionId: this.sessionId,
            data: chunk,
            timestamp: Date.now(),
            seq: ++this.outputSeq,
          }
          this.socket.emit(Events.TERMINAL_OUTPUT, payload)
        }
        // Also emit locally for conversation view
        this.emit('output', chunk)
      }, BATCH_INTERVAL_MS)
    }
  }

  // ── Prompt detector ───────────────────────────────────────────────────────────

  private feedDetector(data: string): void {
    this.detectorBuffer = (this.detectorBuffer + data).slice(-ROLLING_BUF_SIZE)
    if (this.detectorTimer) clearTimeout(this.detectorTimer)
    this.detectorTimer = setTimeout(() => {
      // eslint-disable-next-line no-control-regex
      const stripped = this.detectorBuffer.replace(/\x1B\[[0-9;]*[mGKHFJABCDsuhl]|\x1B\([A-Z]|\x1B[=>]|\r/g, '')
      for (const { regex, type } of CLAUDE_PROMPT_PATTERNS) {
        const match = stripped.match(regex)
        if (match) {
          if (this.socket?.connected && this.sessionId) {
            const payload: ClaudePromptPayload = {
              sessionId: this.sessionId,
              promptType: type,
              rawText: match[0],
              timestamp: Date.now(),
            }
            this.socket.emit(Events.CLAUDE_PROMPT, payload)
          }
          this.emit('prompt', { type, rawText: match[0] })
          break
        }
      }
    }, DEBOUNCE_MS)
  }

  // ── Ring buffer (reconnect catch-up) ──────────────────────────────────────────

  private appendToRing(data: string): void {
    const bytes = Buffer.byteLength(data, 'utf8')
    this.ringBuffer.push(data)
    this.ringBufferBytes += bytes
    while (this.ringBufferBytes > RING_BUFFER_SIZE && this.ringBuffer.length > 0) {
      const evicted = this.ringBuffer.shift()!
      this.ringBufferBytes -= Buffer.byteLength(evicted, 'utf8')
    }
  }

  private flushRingBuffer(): string {
    const data = this.ringBuffer.join('')
    this.ringBuffer = []
    this.ringBufferBytes = 0
    return data
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private resolveExecutable(command: string): string {
    if (command.includes('/') || (process.platform === 'win32' && command.includes('\\'))) {
      return command
    }
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      const result = execFileSync(cmd, [command], { encoding: 'utf8' }).trim()
      return result.split(/\r?\n/)[0]?.trim() || command
    } catch {
      return command
    }
  }

  private setStatus(status: BridgeStatus, message?: string): void {
    this.status = status
    const info: StatusInfo = { status, message }
    this.emit('status', info)
  }

  private clearTimers(): void {
    if (this.batchTimer) clearTimeout(this.batchTimer)
    if (this.detectorTimer) clearTimeout(this.detectorTimer)
    if (this.pingInterval) clearInterval(this.pingInterval)
    this.batchTimer = undefined
    this.detectorTimer = undefined
    this.pingInterval = undefined
  }

  private reset(): void {
    this.clearTimers()
    this.ringBuffer = []
    this.ringBufferBytes = 0
    this.detectorBuffer = ''
    this.batchBuffer = ''
    this.isPaired = false
    this.outputSeq = 0
    this.qrInfo = undefined
    this.sessionId = undefined
    this.token = undefined
    this.pendingRuntimeStatus = undefined
  }
}
