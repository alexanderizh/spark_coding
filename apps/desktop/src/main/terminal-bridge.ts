import { EventEmitter }   from 'events'
import { execFileSync }   from 'child_process'
import os                 from 'os'
import fs                 from 'fs/promises'
import path               from 'path'
import * as pty           from 'node-pty'
import { io, Socket }     from 'socket.io-client'
import axios              from 'axios'
import {
  Events,
  SessionState,
  SessionErrorCode,
  AgentRegisterPayload,
  TerminalOutputPayload,
  TerminalSnapshotPayload,
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
  DesktopStatusReportPayload,
  DesktopStatusUpdatePayload,
  buildPairUrl,
  FsListPayload,
  FsListResultPayload,
  TerminalChdirPayload,
  FsEntry,
} from '@spark_coder/shared'
import {
  runHealthCheck,
  buildStatusReport,
  reportStatusToServer,
} from './health-checker'
import {
  savePairedSession,
  updatePairedSessionLastUsed,
  PairedSessionRecord,
} from './store'

// ── Constants ──────────────────────────────────────────────────────────────────
const RELAY_LOG_PREFIX = '[relay][host]'
const BATCH_INTERVAL_MS  = 16        // ~60fps
const RING_BUFFER_SIZE   = 1024 * 1024  // 1 MB
const ROLLING_BUF_SIZE   = 2048
const DISPLAY_BUFFER_MAX = 100 * 1024   // 100 KB for renderer preview
const DEBOUNCE_MS        = 100
const DAEMON_INTERVAL_MS = 60_000    // report health every 60 s

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
  serverUrl:  string
  claudePath: string
  cwd:        string
  deviceId:   string   // desktop physical fingerprint
}

export interface StatusInfo {
  status:   BridgeStatus
  message?: string
}

export interface QrInfo {
  qrPayload: string
  token:     string
  sessionId: string
}

// ── TerminalBridge ─────────────────────────────────────────────────────────────
/**
 * Encapsulates all terminal / session logic.  Runs inside the Electron main
 * process.
 *
 * New in v2:
 *  - Device fingerprint embedded in every register/create call
 *  - On SESSION_PAIR: saves PairedSessionRecord to local store + server
 *  - DESKTOP_STATUS_REPORT: emitted via socket whenever daemon fires
 *  - DESKTOP_STATUS_REQUEST: handled — triggers an immediate status report
 *  - DESKTOP_STATUS_UPDATE: forwarded to renderer
 *
 * Events emitted:
 *   'status'          → StatusInfo
 *   'qr'              → QrInfo
 *   'output'          → string  (terminal output chunk)
 *   'prompt'          → { type: string; rawText: string }
 *   'claude-exit'     → exitCode: number
 *   'desktop-status'  → DesktopStatusUpdatePayload
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
  private appStartTime = Date.now()

  // Batching
  private batchBuffer = ''
  private batchTimer?: NodeJS.Timeout

  // Ring buffer (reconnect catch-up)
  private ringBuffer: string[] = []
  private ringBufferBytes = 0

  // Snapshot buffer (full-state streaming)
  private snapshotBuffer = ''
  private readonly SNAPSHOT_MAX_BYTES = 48 * 1024

  // Prompt detector state
  private detectorBuffer = ''
  private detectorTimer?: NodeJS.Timeout

  // Keepalive + daemon
  private pingInterval?: NodeJS.Timeout
  private daemonInterval?: NodeJS.Timeout

  // Display buffer for Session page preview (PTY output only, no logs)
  private displayBuffer      = ''
  private displayBufferBytes = 0

  // System log buffer (for Session page info)
  private logBuffer      = ''
  private logBufferBytes = 0
  private readonly LOG_BUFFER_MAX = 8 * 1024  // 8 KB for logs

  // Pending runtime status to send after reconnect
  private pendingRuntimeStatus?: RuntimeStatusPayload

  // Latest xterm viewport snapshot from renderer (replaces stripAnsi approach)
  private xtermSnapshot = ''

  // ── Public API ────────────────────────────────────────────────────────────────

  private log(msg: string, ...args: unknown[]): void {
    const line = `${RELAY_LOG_PREFIX} ${msg} ${args.map(String).join(' ')}\n`
    console.log(RELAY_LOG_PREFIX, msg, ...args)
    // Store in log buffer instead of mixing with PTY output
    this.appendToLogBuffer(line)
  }

  /** Emit output to renderer and append to display buffer for Session page. */
  private emitOutput(data: string): void {
    const bytes = Buffer.byteLength(data, 'utf8')
    this.displayBuffer += data
    this.displayBufferBytes += bytes
    while (this.displayBufferBytes > DISPLAY_BUFFER_MAX && this.displayBuffer.length > 0) {
      const drop = Math.min(this.displayBuffer.length, 2048)
      this.displayBufferBytes -= Buffer.byteLength(this.displayBuffer.slice(0, drop), 'utf8')
      this.displayBuffer = this.displayBuffer.slice(drop)
    }
    this.emit('output', data)
  }

  private appendToLogBuffer(line: string): void {
    const bytes = Buffer.byteLength(line, 'utf8')
    this.logBuffer += line
    this.logBufferBytes += bytes
    // Keep log buffer as a ring buffer - maintain only last 8KB
    while (this.logBufferBytes > this.LOG_BUFFER_MAX && this.logBuffer.length > 0) {
      const newlinePos = this.logBuffer.indexOf('\n')
      if (newlinePos === -1) {
        // No newline; trim aggressively
        const drop = Math.min(this.logBuffer.length, 512)
        this.logBufferBytes -= Buffer.byteLength(this.logBuffer.slice(0, drop), 'utf8')
        this.logBuffer = this.logBuffer.slice(drop)
      } else {
        // Remove first line
        const droppedLine = this.logBuffer.slice(0, newlinePos + 1)
        this.logBufferBytes -= Buffer.byteLength(droppedLine, 'utf8')
        this.logBuffer = this.logBuffer.slice(newlinePos + 1)
      }
    }
  }

  getStatus(): BridgeStatus { return this.status }
  getOutputBuffer(): string { return this.displayBuffer }
  getLogBuffer(): string { return this.logBuffer }
  getQrInfo(): QrInfo | undefined { return this.qrInfo }

  /** Called by IPC handler when renderer reports a new xterm viewport snapshot. */
  setXtermSnapshot(snapshot: string): void {
    this.xtermSnapshot = snapshot
  }

  async start(config: BridgeConfig): Promise<void> {
    if (
      this.status !== 'idle' &&
      this.status !== 'stopped' &&
      this.status !== 'error' &&
      this.status !== 'expired'
    ) return

    this.config = config
    this.reset()
    this.setStatus('connecting', `Connecting to ${config.serverUrl}…`)

    // ── Startup health check ─────────────────────────────────────────────
    const health = runHealthCheck(config.claudePath)
    const report = buildStatusReport(config.deviceId, health, this.appStartTime)
    // Daemon 正在启动中，终端服务视为运行中（PTY 将在 pair 后创建）
    report.terminalStatus = 'running'
    if (report.overallStatus === 'offline') report.overallStatus = 'degraded'
    // Report via HTTP first (before WebSocket is up)
    await reportStatusToServer(config.serverUrl, report)

    // ── Create session on relay server ───────────────────────────────────
    let session: { sessionId: string; token: string; qrPayload: string }
    try {
      const res = await axios.post<{ success: boolean; data: typeof session }>(
        `${config.serverUrl}/api/session`,
        { desktopDeviceId: config.deviceId, launchType: 'claude' },
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
    this.token     = session.token
    this.qrInfo    = {
      qrPayload: session.qrPayload,
      token:     session.token,
      sessionId: session.sessionId,
    }

    // ── Connect WebSocket ────────────────────────────────────────────────
    this.socket = io(config.serverUrl, {
      auth: {
        sessionId: session.sessionId,
        token:     session.token,
        role:      'agent',
        deviceId:  config.deviceId,
      },
      reconnection:          true,
      reconnectionAttempts:  Infinity,
      reconnectionDelay:     1000,
      reconnectionDelayMax:  30_000,
      randomizationFactor:   0.5,
      transports:            ['websocket'],
    })

    this.registerSocketEvents()
    this.startDaemon()
  }

  stop(): void {
    this.clearTimers()
    try { this.ptyProcess?.kill() } catch { /* ignore */ }
    this.socket?.disconnect()
    this.ptyProcess       = undefined
    this.socket           = undefined
    this.isPaired         = false
    this.outputSeq        = 0
    this.pendingRuntimeStatus = undefined
    this.setStatus('stopped', 'Session stopped')
  }

  restartClaude(): { ok: boolean; error?: string } {
    if (!this.isPaired || !this.config) {
      return { ok: false, error: 'Not paired or config missing' }
    }
    try { this.ptyProcess?.kill() } catch { /* ignore */ }
    this.ptyProcess = undefined
    this.spawnClaude()
    return { ok: true }
  }

  // ── Socket events ──────────────────────────────────────────────────────────

  private registerSocketEvents(): void {
    const socket = this.socket!

    socket.on('connect', () => {
      this.log('WebSocket 已连接，发送 agent:register')
      const payload: AgentRegisterPayload = {
        sessionToken: this.token!,
        agentVersion: '2.0.0',
        platform:     process.platform,
        hostname:     os.hostname(),
        deviceId:     this.config?.deviceId,
      }
      socket.emit(Events.AGENT_REGISTER, payload)
      this.log('已发送 agent:register hostname=%s', os.hostname())
      this.setStatus('waiting', 'Waiting for mobile to pair…')
      if (this.qrInfo) this.emit('qr', this.qrInfo)

      // Re-emit runtime status if Claude is already running
      if (this.ptyProcess && this.sessionId) {
        this.emitRuntimeStatus({
          sessionId: this.sessionId,
          cliType:   CliTypes.CLAUDE,
          ready:     true,
          started:   false,
          timestamp: Date.now(),
        })
      }

      // Send current health status
      this.sendStatusReport()
    })

    socket.on('reconnect', () => {
      this.log('WebSocket 重连成功，重新注册 agent')
      // Re-emit agent:register to ensure server knows we're back
      if (this.sessionId && this.token) {
        const payload: AgentRegisterPayload = {
          sessionToken: this.token,
          agentVersion: '2.0.0',
          platform:     process.platform,
          hostname:     os.hostname(),
          deviceId:     this.config?.deviceId,
        }
        try {
          socket.emit(Events.AGENT_REGISTER, payload)
          this.log('重连后重新发送 agent:register')
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.log('ERROR: Failed to re-register after reconnect: %s', msg)
        }
      }
      if (this.pendingRuntimeStatus && this.sessionId) {
        try {
          socket.emit(Events.RUNTIME_STATUS, this.pendingRuntimeStatus)
          this.log('重连后发送 runtime:status')
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.log('ERROR: Failed to send runtime:status after reconnect: %s', msg)
        }
      }
    })

    socket.on('disconnect', (reason: string) => {
      this.log('WebSocket 断开 reason=%s isPaired=%s ptyProcess=%s', reason, this.isPaired, !!this.ptyProcess)
      if (reason === 'transport close' || reason === 'forced close') {
        this.log('WARNING: Unexpected disconnect with reason: %s', reason)
      }
    })

    // Mobile paired → spawn Claude + save PairedSessionRecord
    socket.on(Events.SESSION_PAIR, (payload: SessionPairPayload) => {
      this.log('收到 session:pair mobileDeviceId=%s isPaired=%s ptyRunning=%s', payload.mobileDeviceId, this.isPaired, !!this.ptyProcess)
      this.isPaired = true
      this.setStatus('paired', `Paired with ${payload.mobileDeviceId}`)

      const snap = this.xtermSnapshot || this.snapshotBuffer
      if (this.ptyProcess) {
        // Claude 进程仍在运行（移动端重连）→ 直接发送快照，无需重新启动
        if (snap && socket.connected && this.sessionId) {
          try {
            socket.emit(Events.TERMINAL_SNAPSHOT, {
              sessionId: this.sessionId,
              snapshot:  snap,
              timestamp: Date.now(),
            })
            this.log('重连后发送 terminal:snapshot bytes=%s', Buffer.byteLength(snap, 'utf8'))
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            this.log('ERROR sending terminal:snapshot: %s', msg)
          }
        }
        return
      }

      // Claude 未运行 → 首次配对或进程已退出，启动 Claude
      try {
        this.spawnClaude()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.log('ERROR in SESSION_PAIR handler: %s', msg)
        this.setStatus('error', `Failed to initialize session: ${msg}`)
      }

      // Persist pairing record to local store
      if (this.config && this.sessionId) {
        const record: PairedSessionRecord = {
          sessionId:       this.sessionId,
          serverUrl:       this.config.serverUrl,
          desktopDeviceId: this.config.deviceId,
          mobileDeviceId:  payload.mobileDeviceId,
          desktopPlatform: payload.agentPlatform ?? process.platform,
          mobilePlatform:  payload.mobilePlatform ?? undefined,
          launchType:      'claude',
          hostname:        os.hostname(),
          pairedAt:        payload.pairedAt,
          lastUsedAt:      Date.now(),
        }
        try { savePairedSession(record) } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          this.log('WARNING: Failed to save pairing record: %s', msg)
        }
      }
    })

    // Session state updates
    socket.on(Events.SESSION_STATE, (payload: SessionStatePayload) => {
      this.log('收到 session:state state=%s', payload.state)
      if (payload.state === SessionState.MOBILE_DISCONNECTED) {
        // Mobile 断开连接：保持 Claude 进程继续运行，等待移动端重连
        // 不杀死 Claude，避免重连后需要重新启动带来的延迟
        this.isPaired = false
        this.setStatus('waiting', 'Mobile disconnected — waiting for reconnect')
      }
      if (payload.state === SessionState.PAIRED && !this.isPaired) {
        this.isPaired = true
        this.setStatus('paired', 'Reconnected')
        if (this.sessionId) {
          updatePairedSessionLastUsed(this.sessionId)
        }
      }
    })

    // Server requests a fresh status report (triggered by mobile)
    socket.on(Events.DESKTOP_STATUS_REQUEST, () => {
      this.log('收到 desktop:status:request，发送状态报告')
      this.sendStatusReport()
    })

    // Input from mobile → write to PTY
    socket.on(Events.TERMINAL_INPUT, (payload: TerminalInputPayload) => {
      this.log('收到 terminal:input bytes=%s', Buffer.byteLength(payload.data, 'utf8'))
      this.ptyProcess?.write(payload.data)
    })

    // Resize from mobile
    socket.on(Events.TERMINAL_RESIZE, (payload: TerminalResizePayload) => {
      this.log('收到 terminal:resize cols=%s rows=%s', payload.cols, payload.rows)
      try { this.ptyProcess?.resize(payload.cols, payload.rows) } catch { /* ignore */ }
    })

    // FS List request
    socket.on(Events.FS_LIST, (payload: FsListPayload) => {
      this.handleFsList(payload)
    })

    // Change Directory request
    socket.on(Events.TERMINAL_CHDIR, (payload: TerminalChdirPayload) => {
      this.handleChdir(payload)
    })

    socket.on(Events.RUNTIME_ENSURE, (payload: RuntimeEnsurePayload) => {
      this.log('收到 runtime:ensure cliType=%s socketConnected=%s', payload.cliType, socket.connected)
      if (payload.cliType !== CliTypes.CLAUDE) return
      if (this.ptyProcess) {
        this.log('Claude process already running, sending ready status')
        this.emitRuntimeStatus({
          sessionId: this.sessionId!,
          cliType:   CliTypes.CLAUDE,
          ready:     true,
          started:   false,
          timestamp: Date.now(),
        })
        // Send snapshot so mobile sees current state on reconnect / first enter
        const snap = this.xtermSnapshot || this.snapshotBuffer
        if (snap && socket.connected && this.sessionId) {
          try {
            socket.emit(Events.TERMINAL_SNAPSHOT, {
              sessionId: this.sessionId,
              snapshot:  snap,
              timestamp: Date.now(),
            })
            this.log('runtime:ensure 发送 terminal:snapshot bytes=%s', Buffer.byteLength(snap, 'utf8'))
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            this.log('ERROR sending terminal:snapshot in runtime:ensure: %s', msg)
          }
        }
        return
      }
      if (!this.config) {
        this.log('ERROR: config not available in runtime:ensure')
        this.emitRuntimeStatus({
          sessionId: this.sessionId!,
          cliType:   CliTypes.CLAUDE,
          ready:     false,
          started:   false,
          message:   'Configuration not initialised',
          timestamp: Date.now(),
        })
        return
      }
      this.log('Claude process not running, spawning now')
      try {
        this.spawnClaude()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.log('ERROR spawning Claude in runtime:ensure: %s', msg)
      }
      this.emitRuntimeStatus({
        sessionId: this.sessionId!,
        cliType:   CliTypes.CLAUDE,
        ready:     !!this.ptyProcess,
        started:   !!this.ptyProcess,
        message:   this.ptyProcess ? undefined : 'Claude CLI failed to start',
        timestamp: Date.now(),
      })
    })

    // Forward desktop status update to renderer
    socket.on(Events.DESKTOP_STATUS_UPDATE, (payload: DesktopStatusUpdatePayload) => {
      this.log('收到 desktop:status:update 转发至 renderer')
      this.emit('desktop-status', payload)
    })

    socket.on(Events.SESSION_ERROR, (payload: SessionErrorPayload) => {
      this.log('收到 session:error code=%s message=%s', payload.code, payload.message)
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
        socket.emit(Events.SESSION_PING, {
          sessionId: this.sessionId,
          timestamp: Date.now(),
        })
      }
    }, 30_000)
  }

  // ── Daemon ────────────────────────────────────────────────────────────────────

  private startDaemon(): void {
    this.daemonInterval = setInterval(() => {
      this.sendStatusReport()
    }, DAEMON_INTERVAL_MS)
  }

  /**
   * Run a health check and send the result via both:
   *  - WebSocket (if connected, for real-time mobile update)
   *  - HTTP REST (for persistence in server DB)
   */
  private sendStatusReport(): void {
    if (!this.config) return
    const health  = runHealthCheck(this.config.claudePath)
    const report  = buildStatusReport(this.config.deviceId, health, this.appStartTime)

    // Inject Claude process status if PTY is running
    if (this.ptyProcess) {
      report.claudeStatus = 'running'
    }

    // Inject terminal status based on PTY availability
    report.terminalStatus = 'running'

    // Socket emit (real-time)
    if (this.socket?.connected) {
      const payload: DesktopStatusReportPayload = report
      this.socket.emit(Events.DESKTOP_STATUS_REPORT, payload)
      this.log('发送 desktop:status:report overallStatus=%s', report.overallStatus)
    }

    // REST persist (non-blocking)
    reportStatusToServer(this.config.serverUrl, report).catch(() => {/* ignore */})
  }

  // ── PTY (Claude CLI) ──────────────────────────────────────────────────────────

  private spawnClaude(): void {
    if (!this.config) {
      this.log('ERROR: config not available for spawning Claude')
      return
    }
    const execPath = this.resolveExecutable(this.config.claudePath)
    this.log('Attempting to spawn Claude at: %s', execPath)

    try {
      this.ptyProcess = pty.spawn(execPath, [], {
        name: 'xterm-256color',
        cols: 220,
        rows: 50,
        cwd:  this.config.cwd,
        env:  {
          ...process.env,
          TERM:       'xterm-256color',
          COLORTERM:  'truecolor',
          LANG:       'en_US.UTF-8',
        } as Record<string, string>,
      })
      this.log('Claude process spawned successfully, pid=%s', this.ptyProcess.pid)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.log('ERROR: Failed to spawn Claude CLI at "%s": %s', execPath, msg)
      this.setStatus('error', `Cannot spawn Claude CLI at "${execPath}": ${msg}`)
      return
    }

    this.ptyProcess.onData((data: string) => {
      this.feedDetector(data)
      this.appendToRing(data)
      this.batchOutput(data)
    })

    this.ptyProcess.onExit(({ exitCode }) => {
      this.log('Claude process exited with code: %s', exitCode)
      this.emit('claude-exit', exitCode)
      this.ptyProcess = undefined
    })
  }

  private emitRuntimeStatus(payload: RuntimeStatusPayload): void {
    this.pendingRuntimeStatus = payload
    if (this.socket?.connected) {
      this.socket.emit(Events.RUNTIME_STATUS, payload)
      this.log('发送 runtime:status ready=%s', payload.ready)
    }
  }

  // ── File System ──────────────────────────────────────────────────────────────

  private async handleFsList(payload: FsListPayload): Promise<void> {
    if (!this.config) return

    let requestedPath = payload.path
    if (!requestedPath) {
      requestedPath = this.config.cwd
    }

    // Ensure path is absolute if possible, or relative to CWD?
    // Usually requestedPath will be absolute from previous listing.
    // If it's empty, use CWD.

    this.log('收到 fs:list path=%s', requestedPath)

    try {
      const entries = await fs.readdir(requestedPath, { withFileTypes: true })
      
      const resultEntries: FsEntry[] = entries
        .map(ent => ({
          name: ent.name,
          isDirectory: ent.isDirectory(),
        }))
        .sort((a, b) => {
          // Directories first
          if (a.isDirectory && !b.isDirectory) return -1
          if (!a.isDirectory && b.isDirectory) return 1
          return a.name.localeCompare(b.name)
        })

      const response: FsListResultPayload = {
        sessionId: payload.sessionId,
        path: requestedPath,
        entries: resultEntries,
      }
      this.socket?.emit(Events.FS_LIST_RESULT, response)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.log('ERROR fs:list: %s', msg)
      const response: FsListResultPayload = {
        sessionId: payload.sessionId,
        path: requestedPath,
        entries: [],
        error: msg,
      }
      this.socket?.emit(Events.FS_LIST_RESULT, response)
    }
  }

  private async handleChdir(payload: TerminalChdirPayload): Promise<void> {
    if (!this.config) return
    const newPath = payload.path
    this.log('收到 terminal:chdir path=%s', newPath)

    try {
      const stat = await fs.stat(newPath)
      if (!stat.isDirectory()) {
        throw new Error(`Not a directory: ${newPath}`)
      }

      this.config.cwd = newPath
      
      // Update config file? No, config is usually from arguments or environment. 
      // But we should persist it if possible? 
      // For now, just change runtime CWD.

      const result = this.restartClaude()
      if (result.ok) {
        this.log('Claude restarted in new CWD: %s', newPath)
        // Send a message to the terminal to inform the user
        // We can inject it into the PTY output stream or just emit it directly
        // Injecting into PTY ensures it shows up in history
        // But wait, if we restarted, the PTY is fresh.
        // We can just emit output.
        // Also, we might want to let the user know.
        
        // Let's manually emit an output event to show success message
        const msg = `\r\n\x1b[32m✔ Working directory changed to: ${newPath}\x1b[0m\r\n`
        this.emitOutput(msg)
        if (this.socket?.connected && this.sessionId) {
            // Also send to socket for consistency? 
            // emitOutput handles local display buffer and emits 'output' event which might be used by renderer?
            // But we also need to send to mobile.
            // batchOutput handles sending to mobile.
            // So we should feed this into batchOutput or just call batchOutput directly?
            // batchOutput expects data from PTY.
            // Let's just use a direct emitOutput which updates local buffer and emits event.
            // And also manually emit to socket if we want mobile to see it immediately.
            // Actually, simply writing to the new PTY might be better if it supports echo.
            // But we just restarted it.
            
            // Let's simulate output from the "system"
            const outputPayload: TerminalOutputPayload = {
                sessionId: this.sessionId,
                data: msg,
                timestamp: Date.now(),
                seq: ++this.outputSeq,
                snapshot: this.xtermSnapshot || this.snapshotBuffer
            }
            this.socket.emit(Events.TERMINAL_OUTPUT, outputPayload)
        }
      } else {
        throw new Error(result.error || 'Failed to restart Claude')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.log('ERROR changing directory: %s', msg)
      
      const errorMsg = `\r\n\x1b[31m✖ Failed to change directory: ${msg}\x1b[0m\r\n`
      this.emitOutput(errorMsg)
       if (this.socket?.connected && this.sessionId) {
            const outputPayload: TerminalOutputPayload = {
                sessionId: this.sessionId,
                data: errorMsg,
                timestamp: Date.now(),
                seq: ++this.outputSeq,
                snapshot: this.xtermSnapshot || this.snapshotBuffer
            }
            this.socket.emit(Events.TERMINAL_OUTPUT, outputPayload)
        }
    }
  }

  // ── Output batching (~60fps) ──────────────────────────────────────────────────

  private batchOutput(data: string): void {
    this.batchBuffer += data
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        const chunk       = this.batchBuffer
        this.batchBuffer  = ''
        this.batchTimer   = undefined

        // Strip ANSI and append to snapshot
        const cleanChunk = this.stripAnsiForSnapshot(chunk)
        this.appendToSnapshot(cleanChunk)

        if (this.socket?.connected && this.sessionId) {
          const payload: TerminalOutputPayload = {
            sessionId: this.sessionId,
            data:      chunk,
            timestamp: Date.now(),
            seq:       ++this.outputSeq,
            snapshot:  this.xtermSnapshot || this.snapshotBuffer,
          }
          this.socket.emit(Events.TERMINAL_OUTPUT, payload)
          if (payload.seq % 50 === 0) this.log('发送 terminal:output seq=%s bytes=%s', payload.seq, Buffer.byteLength(chunk, 'utf8'))
        }
        this.emitOutput(chunk)
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
              sessionId:  this.sessionId,
              promptType: type,
              rawText:    match[0],
              timestamp:  Date.now(),
            }
            this.socket.emit(Events.CLAUDE_PROMPT, payload)
            this.log('发送 claude:prompt type=%s', type)
          }
          this.emit('prompt', { type, rawText: match[0] })
          break
        }
      }
    }, DEBOUNCE_MS)
  }

  // ── Snapshot ANSI stripping ──────────────────────────────────────────────

  private stripAnsiForSnapshot(raw: string): string {
    // eslint-disable-next-line no-control-regex
    // Comprehensive ANSI sequence removal:
    // - CSI sequences: \x1B[...letter (including ? prefix for private modes)
    // - OSC sequences: \x1B]...(\x07|\x1B\\)
    // - Other escapes: \x1B followed by various characters
    let clean = raw.replace(
      /\x1B(?:\[[?0-9;]*[a-zA-Z]|\][^\x07]*(?:\x07|\x1B\\)|[=()>\/][0-9A-Za-z]*)/g,
      ''
    )
    // Remove any remaining bare ESC characters
    clean = clean.replace(/\x1B/g, '')
    // Normalize line endings: \r\n → \n
    clean = clean.replace(/\r\n/g, '\n')
    // Handle carriage return on same line (terminal overwrite - keep only after last \r)
    const lines = clean.split('\n')
    return lines.map(line => {
      const lastCR = line.lastIndexOf('\r')
      return lastCR >= 0 ? line.substring(lastCR + 1) : line
    }).join('\n')
  }

  // ── Snapshot accumulation ────────────────────────────────────────────────

  private appendToSnapshot(cleanChunk: string): void {
    this.snapshotBuffer += cleanChunk
    const bytes = Buffer.byteLength(this.snapshotBuffer, 'utf8')
    if (bytes > this.SNAPSHOT_MAX_BYTES) {
      // Trim from the start, keeping line boundaries
      let trimmed = this.snapshotBuffer
      while (Buffer.byteLength(trimmed, 'utf8') > this.SNAPSHOT_MAX_BYTES) {
        // Find the first newline and remove everything before it
        const newlinePos = trimmed.indexOf('\n')
        if (newlinePos === -1) {
          // No newline found; aggressively trim 10% of content
          trimmed = trimmed.substring(Math.ceil(trimmed.length * 0.1))
        } else {
          // Remove everything up to and including the first newline
          trimmed = trimmed.substring(newlinePos + 1)
        }
      }
      this.snapshotBuffer = trimmed
    }
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
    const data        = this.ringBuffer.join('')
    this.ringBuffer   = []
    this.ringBufferBytes = 0
    return data
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private resolveExecutable(command: string): string {
    if (command.includes('/') || (process.platform === 'win32' && command.includes('\\'))) {
      return command
    }
    try {
      const cmd    = process.platform === 'win32' ? 'where' : 'which'
      const result = execFileSync(cmd, [command], { encoding: 'utf8' }).trim()
      return result.split(/\r?\n/)[0]?.trim() || command
    } catch {
      return command
    }
  }

  private setStatus(status: BridgeStatus, message?: string): void {
    this.status = status
    this.emit('status', { status, message } satisfies StatusInfo)
  }

  private clearTimers(): void {
    if (this.batchTimer)    clearTimeout(this.batchTimer)
    if (this.detectorTimer) clearTimeout(this.detectorTimer)
    if (this.pingInterval)  clearInterval(this.pingInterval)
    if (this.daemonInterval) clearInterval(this.daemonInterval)
    this.batchTimer     = undefined
    this.detectorTimer  = undefined
    this.pingInterval   = undefined
    this.daemonInterval = undefined
  }

  private reset(): void {
    this.clearTimers()
    this.displayBuffer    = ''
    this.displayBufferBytes = 0
    this.logBuffer        = ''
    this.logBufferBytes   = 0
    this.ringBuffer       = []
    this.ringBufferBytes  = 0
    this.snapshotBuffer   = ''
    this.xtermSnapshot    = ''
    this.detectorBuffer   = ''
    this.batchBuffer      = ''
    this.isPaired         = false
    this.outputSeq        = 0
    this.qrInfo           = undefined
    this.sessionId        = undefined
    this.token            = undefined
    this.pendingRuntimeStatus = undefined
  }
}
