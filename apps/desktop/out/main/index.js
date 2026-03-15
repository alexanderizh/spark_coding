"use strict";
const dotenv = require("dotenv");
const path = require("path");
const electron = require("electron");
const events = require("events");
const child_process = require("child_process");
const os = require("os");
const pty = require("node-pty");
const socket_ioClient = require("socket.io-client");
const axios = require("axios");
const shared = require("@spark_coder/shared");
const fs = require("fs");
const crypto = require("crypto");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const pty__namespace = /* @__PURE__ */ _interopNamespaceDefault(pty);
let mainWindow = null;
let isQuitting = false;
const iconPath = path.join(__dirname, "../../resources/icon.png");
function getWindowIcon() {
  const img = electron.nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) return img;
  return img.resize({ width: 32, height: 32 });
}
function setQuitting(v) {
  isQuitting = v;
}
function createMainWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1060,
    height: 720,
    minWidth: 720,
    minHeight: 500,
    title: "Spark Coder",
    icon: getWindowIcon(),
    backgroundColor: "#ffffff",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    electron.shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  return mainWindow;
}
function getMainWindow() {
  return mainWindow;
}
function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
let tray = null;
function createTray() {
  const iconPath2 = path.join(__dirname, "../../resources/tray-icon.png");
  let icon;
  try {
    const img = electron.nativeImage.createFromPath(iconPath2);
    if (img.isEmpty()) {
      icon = electron.nativeImage.createEmpty();
    } else {
      icon = img.resize({ width: 16, height: 16 });
    }
  } catch {
    icon = electron.nativeImage.createEmpty();
  }
  tray = new electron.Tray(icon);
  tray.setToolTip("Spark Coder");
  const menu = electron.Menu.buildFromTemplate([
    {
      label: "Open Spark Coder",
      click: () => showMainWindow()
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        setQuitting(true);
        electron.app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => showMainWindow());
}
function runHealthCheck(claudePath) {
  const claudeCheck = checkClaude(claudePath);
  const terminalCheck = checkTerminalLayer();
  let overall = "healthy";
  if (claudeCheck.status === "error" && terminalCheck.status === "error") {
    overall = "offline";
  } else if (claudeCheck.status !== "running" || terminalCheck.status !== "running") {
    overall = "degraded";
  }
  return {
    claudeStatus: claudeCheck.status,
    claudePath: claudeCheck.resolvedPath,
    terminalStatus: terminalCheck.status,
    overallStatus: overall
  };
}
function buildStatusReport(deviceId, result, startTime) {
  return {
    deviceId,
    hostname: os.hostname(),
    platform: process.platform,
    appVersion: electron.app.getVersion(),
    overallStatus: result.overallStatus,
    claudeStatus: result.claudeStatus,
    terminalStatus: result.terminalStatus,
    claudePath: result.claudePath,
    uptimeMs: Date.now() - startTime,
    reportedAt: Date.now()
  };
}
async function reportStatusToServer(serverUrl, report) {
  if (!serverUrl) return;
  try {
    await axios.post(
      `${serverUrl}/api/device/status`,
      report,
      { timeout: 8e3 }
    );
  } catch {
  }
}
function checkClaude(claudePath) {
  const resolved = resolveExecutable(claudePath);
  if (resolved.includes("/") || resolved.includes("\\")) {
    if (!fs.existsSync(resolved)) {
      return { status: "stopped", resolvedPath: resolved };
    }
  }
  try {
    child_process.execFileSync(resolved, ["--version"], { encoding: "utf8", timeout: 5e3 });
    return { status: "running", resolvedPath: resolved };
  } catch {
    try {
      child_process.execFileSync(resolved, ["--help"], { encoding: "utf8", timeout: 3e3 });
      return { status: "running", resolvedPath: resolved };
    } catch {
      return { status: "error", resolvedPath: resolved };
    }
  }
}
function checkTerminalLayer() {
  try {
    require("node-pty");
    return { status: "running" };
  } catch {
    return { status: "error" };
  }
}
function resolveExecutable(command) {
  if (command.includes("/") || process.platform === "win32" && command.includes("\\")) {
    return command;
  }
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = child_process.execFileSync(cmd, [command], { encoding: "utf8" }).trim();
    return result.split(/\r?\n/)[0]?.trim() || command;
  } catch {
    return command;
  }
}
const SETTINGS_DEFAULTS = {
  serverUrl: "",
  claudePath: "claude",
  cwd: os.homedir(),
  autoStart: true
};
function settingsPath() {
  return path.join(electron.app.getPath("userData"), "settings.json");
}
function getSettings() {
  const p = settingsPath();
  if (!fs.existsSync(p)) return { ...SETTINGS_DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return { ...SETTINGS_DEFAULTS, ...raw };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}
const RELAY_SERVER_URL_ENV = "RELAY_SERVER_URL";
function getEffectiveServerUrl() {
  const settings = getSettings();
  const fromSettings = settings.serverUrl?.trim();
  if (fromSettings) return fromSettings;
  return process.env[RELAY_SERVER_URL_ENV]?.trim() ?? "";
}
function saveSettings(patch) {
  const current = getSettings();
  fs.writeFileSync(settingsPath(), JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
}
function pairedSessionsPath() {
  return path.join(electron.app.getPath("userData"), "paired-sessions.json");
}
function getPairedSessions() {
  const p = pairedSessionsPath();
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return [];
  }
}
function savePairedSession(record) {
  const all = getPairedSessions();
  const idx = all.findIndex((s) => s.sessionId === record.sessionId);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...record };
  } else {
    all.push(record);
  }
  fs.writeFileSync(pairedSessionsPath(), JSON.stringify(all, null, 2), "utf8");
}
function updatePairedSessionLastUsed(sessionId) {
  const all = getPairedSessions();
  const idx = all.findIndex((s) => s.sessionId === sessionId);
  if (idx >= 0) {
    all[idx].lastUsedAt = Date.now();
    fs.writeFileSync(pairedSessionsPath(), JSON.stringify(all, null, 2), "utf8");
  }
}
const RELAY_LOG_PREFIX = "[relay][host]";
const BATCH_INTERVAL_MS = 16;
const RING_BUFFER_SIZE = 1024 * 1024;
const DISPLAY_BUFFER_MAX = 100 * 1024;
const DEBOUNCE_MS = 100;
const DAEMON_INTERVAL_MS = 6e4;
class TerminalBridge extends events.EventEmitter {
  socket;
  ptyProcess;
  sessionId;
  token;
  qrInfo;
  status = "idle";
  isPaired = false;
  outputSeq = 0;
  config;
  appStartTime = Date.now();
  // Batching
  batchBuffer = "";
  batchTimer;
  // Ring buffer (reconnect catch-up)
  ringBuffer = [];
  ringBufferBytes = 0;
  // Snapshot buffer (full-state streaming)
  snapshotBuffer = "";
  SNAPSHOT_MAX_BYTES = 48 * 1024;
  // Prompt detector state
  detectorBuffer = "";
  detectorTimer;
  // Keepalive + daemon
  pingInterval;
  daemonInterval;
  // Display buffer for Session page preview (PTY output only, no logs)
  displayBuffer = "";
  displayBufferBytes = 0;
  // System log buffer (for Session page info)
  logBuffer = "";
  logBufferBytes = 0;
  LOG_BUFFER_MAX = 8 * 1024;
  // 8 KB for logs
  // Pending runtime status to send after reconnect
  pendingRuntimeStatus;
  // Latest xterm viewport snapshot from renderer (replaces stripAnsi approach)
  xtermSnapshot = "";
  // ── Public API ────────────────────────────────────────────────────────────────
  log(msg, ...args) {
    const line = `${RELAY_LOG_PREFIX} ${msg} ${args.map(String).join(" ")}
`;
    console.log(RELAY_LOG_PREFIX, msg, ...args);
    this.appendToLogBuffer(line);
  }
  /** Emit output to renderer and append to display buffer for Session page. */
  emitOutput(data) {
    const bytes = Buffer.byteLength(data, "utf8");
    this.displayBuffer += data;
    this.displayBufferBytes += bytes;
    while (this.displayBufferBytes > DISPLAY_BUFFER_MAX && this.displayBuffer.length > 0) {
      const drop = Math.min(this.displayBuffer.length, 2048);
      this.displayBufferBytes -= Buffer.byteLength(this.displayBuffer.slice(0, drop), "utf8");
      this.displayBuffer = this.displayBuffer.slice(drop);
    }
    this.emit("output", data);
  }
  appendToLogBuffer(line) {
    const bytes = Buffer.byteLength(line, "utf8");
    this.logBuffer += line;
    this.logBufferBytes += bytes;
    while (this.logBufferBytes > this.LOG_BUFFER_MAX && this.logBuffer.length > 0) {
      const newlinePos = this.logBuffer.indexOf("\n");
      if (newlinePos === -1) {
        const drop = Math.min(this.logBuffer.length, 512);
        this.logBufferBytes -= Buffer.byteLength(this.logBuffer.slice(0, drop), "utf8");
        this.logBuffer = this.logBuffer.slice(drop);
      } else {
        const droppedLine = this.logBuffer.slice(0, newlinePos + 1);
        this.logBufferBytes -= Buffer.byteLength(droppedLine, "utf8");
        this.logBuffer = this.logBuffer.slice(newlinePos + 1);
      }
    }
  }
  getStatus() {
    return this.status;
  }
  getOutputBuffer() {
    return this.displayBuffer;
  }
  getLogBuffer() {
    return this.logBuffer;
  }
  getQrInfo() {
    return this.qrInfo;
  }
  /** Called by IPC handler when renderer reports a new xterm viewport snapshot. */
  setXtermSnapshot(snapshot) {
    this.xtermSnapshot = snapshot;
  }
  async start(config) {
    if (this.status !== "idle" && this.status !== "stopped" && this.status !== "error" && this.status !== "expired") return;
    this.config = config;
    this.reset();
    this.setStatus("connecting", `Connecting to ${config.serverUrl}…`);
    const health = runHealthCheck(config.claudePath);
    const report = buildStatusReport(config.deviceId, health, this.appStartTime);
    report.terminalStatus = "running";
    if (report.overallStatus === "offline") report.overallStatus = "degraded";
    await reportStatusToServer(config.serverUrl, report);
    let session;
    try {
      const res = await axios.post(
        `${config.serverUrl}/api/session`,
        { desktopDeviceId: config.deviceId, launchType: "claude" },
        { timeout: 1e4 }
      );
      if (!res.data.success) throw new Error("Server returned failure");
      session = res.data.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus("error", `Cannot reach relay server: ${msg}`);
      return;
    }
    this.sessionId = session.sessionId;
    this.token = session.token;
    this.qrInfo = {
      qrPayload: session.qrPayload,
      token: session.token,
      sessionId: session.sessionId
    };
    this.socket = socket_ioClient.io(config.serverUrl, {
      auth: {
        sessionId: session.sessionId,
        token: session.token,
        role: "agent",
        deviceId: config.deviceId
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1e3,
      reconnectionDelayMax: 3e4,
      randomizationFactor: 0.5,
      transports: ["websocket"]
    });
    this.registerSocketEvents();
    this.startDaemon();
  }
  stop() {
    this.clearTimers();
    try {
      this.ptyProcess?.kill();
    } catch {
    }
    this.socket?.disconnect();
    this.ptyProcess = void 0;
    this.socket = void 0;
    this.isPaired = false;
    this.outputSeq = 0;
    this.pendingRuntimeStatus = void 0;
    this.setStatus("stopped", "Session stopped");
  }
  restartClaude() {
    if (!this.isPaired || !this.config) {
      return { ok: false, error: "Not paired or config missing" };
    }
    try {
      this.ptyProcess?.kill();
    } catch {
    }
    this.ptyProcess = void 0;
    this.spawnClaude();
    return { ok: true };
  }
  // ── Socket events ──────────────────────────────────────────────────────────
  registerSocketEvents() {
    const socket = this.socket;
    socket.on("connect", () => {
      this.log("WebSocket 已连接，发送 agent:register");
      const payload = {
        sessionToken: this.token,
        agentVersion: "2.0.0",
        platform: process.platform,
        hostname: os.hostname(),
        deviceId: this.config?.deviceId
      };
      socket.emit(shared.Events.AGENT_REGISTER, payload);
      this.log("已发送 agent:register hostname=%s", os.hostname());
      this.setStatus("waiting", "Waiting for mobile to pair…");
      if (this.qrInfo) this.emit("qr", this.qrInfo);
      if (this.ptyProcess && this.sessionId) {
        this.emitRuntimeStatus({
          sessionId: this.sessionId,
          cliType: shared.CliTypes.CLAUDE,
          ready: true,
          started: false,
          timestamp: Date.now()
        });
      }
      this.sendStatusReport();
    });
    socket.on("reconnect", () => {
      this.log("WebSocket 重连成功，重新注册 agent");
      if (this.sessionId && this.token) {
        const payload = {
          sessionToken: this.token,
          agentVersion: "2.0.0",
          platform: process.platform,
          hostname: os.hostname(),
          deviceId: this.config?.deviceId
        };
        try {
          socket.emit(shared.Events.AGENT_REGISTER, payload);
          this.log("重连后重新发送 agent:register");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log("ERROR: Failed to re-register after reconnect: %s", msg);
        }
      }
      if (this.pendingRuntimeStatus && this.sessionId) {
        try {
          socket.emit(shared.Events.RUNTIME_STATUS, this.pendingRuntimeStatus);
          this.log("重连后发送 runtime:status");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log("ERROR: Failed to send runtime:status after reconnect: %s", msg);
        }
      }
    });
    socket.on("disconnect", (reason) => {
      this.log("WebSocket 断开 reason=%s isPaired=%s ptyProcess=%s", reason, this.isPaired, !!this.ptyProcess);
      if (reason === "transport close" || reason === "forced close") {
        this.log("WARNING: Unexpected disconnect with reason: %s", reason);
      }
    });
    socket.on(shared.Events.SESSION_PAIR, (payload) => {
      this.log("收到 session:pair mobileDeviceId=%s isPaired=%s ptyRunning=%s", payload.mobileDeviceId, this.isPaired, !!this.ptyProcess);
      this.isPaired = true;
      this.setStatus("paired", `Paired with ${payload.mobileDeviceId}`);
      const snap = this.xtermSnapshot || this.snapshotBuffer;
      if (this.ptyProcess) {
        if (snap && socket.connected && this.sessionId) {
          try {
            socket.emit(shared.Events.TERMINAL_SNAPSHOT, {
              sessionId: this.sessionId,
              snapshot: snap,
              timestamp: Date.now()
            });
            this.log("重连后发送 terminal:snapshot bytes=%s", Buffer.byteLength(snap, "utf8"));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log("ERROR sending terminal:snapshot: %s", msg);
          }
        }
        return;
      }
      try {
        this.spawnClaude();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log("ERROR in SESSION_PAIR handler: %s", msg);
        this.setStatus("error", `Failed to initialize session: ${msg}`);
      }
      if (this.config && this.sessionId) {
        const record = {
          sessionId: this.sessionId,
          serverUrl: this.config.serverUrl,
          desktopDeviceId: this.config.deviceId,
          mobileDeviceId: payload.mobileDeviceId,
          desktopPlatform: payload.agentPlatform ?? process.platform,
          mobilePlatform: payload.mobilePlatform ?? void 0,
          launchType: "claude",
          hostname: os.hostname(),
          pairedAt: payload.pairedAt,
          lastUsedAt: Date.now()
        };
        try {
          savePairedSession(record);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log("WARNING: Failed to save pairing record: %s", msg);
        }
      }
    });
    socket.on(shared.Events.SESSION_STATE, (payload) => {
      this.log("收到 session:state state=%s", payload.state);
      if (payload.state === shared.SessionState.MOBILE_DISCONNECTED) {
        this.isPaired = false;
        this.setStatus("waiting", "Mobile disconnected — waiting for reconnect");
      }
      if (payload.state === shared.SessionState.PAIRED && !this.isPaired) {
        this.isPaired = true;
        this.setStatus("paired", "Reconnected");
        if (this.sessionId) {
          updatePairedSessionLastUsed(this.sessionId);
        }
      }
    });
    socket.on(shared.Events.DESKTOP_STATUS_REQUEST, () => {
      this.log("收到 desktop:status:request，发送状态报告");
      this.sendStatusReport();
    });
    socket.on(shared.Events.TERMINAL_INPUT, (payload) => {
      this.log("收到 terminal:input bytes=%s", Buffer.byteLength(payload.data, "utf8"));
      this.ptyProcess?.write(payload.data);
    });
    socket.on(shared.Events.TERMINAL_RESIZE, (payload) => {
      this.log("收到 terminal:resize cols=%s rows=%s", payload.cols, payload.rows);
      try {
        this.ptyProcess?.resize(payload.cols, payload.rows);
      } catch {
      }
    });
    socket.on(shared.Events.RUNTIME_ENSURE, (payload) => {
      this.log("收到 runtime:ensure cliType=%s socketConnected=%s", payload.cliType, socket.connected);
      if (payload.cliType !== shared.CliTypes.CLAUDE) return;
      if (this.ptyProcess) {
        this.log("Claude process already running, sending ready status");
        this.emitRuntimeStatus({
          sessionId: this.sessionId,
          cliType: shared.CliTypes.CLAUDE,
          ready: true,
          started: false,
          timestamp: Date.now()
        });
        const snap = this.xtermSnapshot || this.snapshotBuffer;
        if (snap && socket.connected && this.sessionId) {
          try {
            socket.emit(shared.Events.TERMINAL_SNAPSHOT, {
              sessionId: this.sessionId,
              snapshot: snap,
              timestamp: Date.now()
            });
            this.log("runtime:ensure 发送 terminal:snapshot bytes=%s", Buffer.byteLength(snap, "utf8"));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log("ERROR sending terminal:snapshot in runtime:ensure: %s", msg);
          }
        }
        return;
      }
      if (!this.config) {
        this.log("ERROR: config not available in runtime:ensure");
        this.emitRuntimeStatus({
          sessionId: this.sessionId,
          cliType: shared.CliTypes.CLAUDE,
          ready: false,
          started: false,
          message: "Configuration not initialised",
          timestamp: Date.now()
        });
        return;
      }
      this.log("Claude process not running, spawning now");
      try {
        this.spawnClaude();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log("ERROR spawning Claude in runtime:ensure: %s", msg);
      }
      this.emitRuntimeStatus({
        sessionId: this.sessionId,
        cliType: shared.CliTypes.CLAUDE,
        ready: !!this.ptyProcess,
        started: !!this.ptyProcess,
        message: this.ptyProcess ? void 0 : "Claude CLI failed to start",
        timestamp: Date.now()
      });
    });
    socket.on(shared.Events.DESKTOP_STATUS_UPDATE, (payload) => {
      this.log("收到 desktop:status:update 转发至 renderer");
      this.emit("desktop-status", payload);
    });
    socket.on(shared.Events.SESSION_ERROR, (payload) => {
      this.log("收到 session:error code=%s message=%s", payload.code, payload.message);
      if (payload.code === shared.SessionErrorCode.SESSION_EXPIRED) {
        this.setStatus("expired", "Session expired — please start a new session");
        this.stop();
      } else {
        this.emit("error", payload.message);
      }
    });
    this.pingInterval = setInterval(() => {
      if (socket.connected && this.sessionId) {
        socket.emit(shared.Events.SESSION_PING, {
          sessionId: this.sessionId,
          timestamp: Date.now()
        });
      }
    }, 3e4);
  }
  // ── Daemon ────────────────────────────────────────────────────────────────────
  startDaemon() {
    this.daemonInterval = setInterval(() => {
      this.sendStatusReport();
    }, DAEMON_INTERVAL_MS);
  }
  /**
   * Run a health check and send the result via both:
   *  - WebSocket (if connected, for real-time mobile update)
   *  - HTTP REST (for persistence in server DB)
   */
  sendStatusReport() {
    if (!this.config) return;
    const health = runHealthCheck(this.config.claudePath);
    const report = buildStatusReport(this.config.deviceId, health, this.appStartTime);
    if (this.ptyProcess) {
      report.claudeStatus = "running";
    }
    report.terminalStatus = "running";
    if (this.socket?.connected) {
      const payload = report;
      this.socket.emit(shared.Events.DESKTOP_STATUS_REPORT, payload);
      this.log("发送 desktop:status:report overallStatus=%s", report.overallStatus);
    }
    reportStatusToServer(this.config.serverUrl, report).catch(() => {
    });
  }
  // ── PTY (Claude CLI) ──────────────────────────────────────────────────────────
  spawnClaude() {
    if (!this.config) {
      this.log("ERROR: config not available for spawning Claude");
      return;
    }
    const execPath = this.resolveExecutable(this.config.claudePath);
    this.log("Attempting to spawn Claude at: %s", execPath);
    try {
      this.ptyProcess = pty__namespace.spawn(execPath, [], {
        name: "xterm-256color",
        cols: 220,
        rows: 50,
        cwd: this.config.cwd,
        env: {
          ...process.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          LANG: "en_US.UTF-8"
        }
      });
      this.log("Claude process spawned successfully, pid=%s", this.ptyProcess.pid);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('ERROR: Failed to spawn Claude CLI at "%s": %s', execPath, msg);
      this.setStatus("error", `Cannot spawn Claude CLI at "${execPath}": ${msg}`);
      return;
    }
    this.ptyProcess.onData((data) => {
      this.feedDetector(data);
      this.appendToRing(data);
      this.batchOutput(data);
    });
    this.ptyProcess.onExit(({ exitCode }) => {
      this.log("Claude process exited with code: %s", exitCode);
      this.emit("claude-exit", exitCode);
      this.ptyProcess = void 0;
    });
  }
  emitRuntimeStatus(payload) {
    this.pendingRuntimeStatus = payload;
    if (this.socket?.connected) {
      this.socket.emit(shared.Events.RUNTIME_STATUS, payload);
      this.log("发送 runtime:status ready=%s", payload.ready);
    }
  }
  // ── Output batching (~60fps) ──────────────────────────────────────────────────
  batchOutput(data) {
    this.batchBuffer += data;
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        const chunk = this.batchBuffer;
        this.batchBuffer = "";
        this.batchTimer = void 0;
        const cleanChunk = this.stripAnsiForSnapshot(chunk);
        this.appendToSnapshot(cleanChunk);
        if (this.socket?.connected && this.sessionId) {
          const payload = {
            sessionId: this.sessionId,
            data: chunk,
            timestamp: Date.now(),
            seq: ++this.outputSeq,
            snapshot: this.xtermSnapshot || this.snapshotBuffer
          };
          this.socket.emit(shared.Events.TERMINAL_OUTPUT, payload);
          if (payload.seq % 50 === 0) this.log("发送 terminal:output seq=%s bytes=%s", payload.seq, Buffer.byteLength(chunk, "utf8"));
        }
        this.emitOutput(chunk);
      }, BATCH_INTERVAL_MS);
    }
  }
  // ── Prompt detector ───────────────────────────────────────────────────────────
  feedDetector(data) {
    this.detectorBuffer = (this.detectorBuffer + data).slice(-2048);
    if (this.detectorTimer) clearTimeout(this.detectorTimer);
    this.detectorTimer = setTimeout(() => {
      const stripped = this.detectorBuffer.replace(/\x1B\[[0-9;]*[mGKHFJABCDsuhl]|\x1B\([A-Z]|\x1B[=>]|\r/g, "");
      for (const { regex, type } of shared.CLAUDE_PROMPT_PATTERNS) {
        const match = stripped.match(regex);
        if (match) {
          if (this.socket?.connected && this.sessionId) {
            const payload = {
              sessionId: this.sessionId,
              promptType: type,
              rawText: match[0],
              timestamp: Date.now()
            };
            this.socket.emit(shared.Events.CLAUDE_PROMPT, payload);
            this.log("发送 claude:prompt type=%s", type);
          }
          this.emit("prompt", { type, rawText: match[0] });
          break;
        }
      }
    }, DEBOUNCE_MS);
  }
  // ── Snapshot ANSI stripping ──────────────────────────────────────────────
  stripAnsiForSnapshot(raw) {
    let clean = raw.replace(
      /\x1B(?:\[[?0-9;]*[a-zA-Z]|\][^\x07]*(?:\x07|\x1B\\)|[=()>\/][0-9A-Za-z]*)/g,
      ""
    );
    clean = clean.replace(/\x1B/g, "");
    clean = clean.replace(/\r\n/g, "\n");
    const lines = clean.split("\n");
    return lines.map((line) => {
      const lastCR = line.lastIndexOf("\r");
      return lastCR >= 0 ? line.substring(lastCR + 1) : line;
    }).join("\n");
  }
  // ── Snapshot accumulation ────────────────────────────────────────────────
  appendToSnapshot(cleanChunk) {
    this.snapshotBuffer += cleanChunk;
    const bytes = Buffer.byteLength(this.snapshotBuffer, "utf8");
    if (bytes > this.SNAPSHOT_MAX_BYTES) {
      let trimmed = this.snapshotBuffer;
      while (Buffer.byteLength(trimmed, "utf8") > this.SNAPSHOT_MAX_BYTES) {
        const newlinePos = trimmed.indexOf("\n");
        if (newlinePos === -1) {
          trimmed = trimmed.substring(Math.ceil(trimmed.length * 0.1));
        } else {
          trimmed = trimmed.substring(newlinePos + 1);
        }
      }
      this.snapshotBuffer = trimmed;
    }
  }
  // ── Ring buffer (reconnect catch-up) ──────────────────────────────────────────
  appendToRing(data) {
    const bytes = Buffer.byteLength(data, "utf8");
    this.ringBuffer.push(data);
    this.ringBufferBytes += bytes;
    while (this.ringBufferBytes > RING_BUFFER_SIZE && this.ringBuffer.length > 0) {
      const evicted = this.ringBuffer.shift();
      this.ringBufferBytes -= Buffer.byteLength(evicted, "utf8");
    }
  }
  flushRingBuffer() {
    const data = this.ringBuffer.join("");
    this.ringBuffer = [];
    this.ringBufferBytes = 0;
    return data;
  }
  // ── Helpers ───────────────────────────────────────────────────────────────────
  resolveExecutable(command) {
    if (command.includes("/") || process.platform === "win32" && command.includes("\\")) {
      return command;
    }
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const result = child_process.execFileSync(cmd, [command], { encoding: "utf8" }).trim();
      return result.split(/\r?\n/)[0]?.trim() || command;
    } catch {
      return command;
    }
  }
  setStatus(status, message) {
    this.status = status;
    this.emit("status", { status, message });
  }
  clearTimers() {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    if (this.detectorTimer) clearTimeout(this.detectorTimer);
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.daemonInterval) clearInterval(this.daemonInterval);
    this.batchTimer = void 0;
    this.detectorTimer = void 0;
    this.pingInterval = void 0;
    this.daemonInterval = void 0;
  }
  reset() {
    this.clearTimers();
    this.displayBuffer = "";
    this.displayBufferBytes = 0;
    this.logBuffer = "";
    this.logBufferBytes = 0;
    this.ringBuffer = [];
    this.ringBufferBytes = 0;
    this.snapshotBuffer = "";
    this.xtermSnapshot = "";
    this.detectorBuffer = "";
    this.batchBuffer = "";
    this.isPaired = false;
    this.outputSeq = 0;
    this.qrInfo = void 0;
    this.sessionId = void 0;
    this.token = void 0;
    this.pendingRuntimeStatus = void 0;
  }
}
const COMMON_PATHS_DARWIN = [
  "/usr/local/bin/claude",
  "/opt/homebrew/bin/claude",
  path.join(os.homedir(), ".npm-global", "bin", "claude"),
  path.join(os.homedir(), ".local", "bin", "claude")
];
const COMMON_PATHS_WIN32 = [
  "C:\\Program Files\\nodejs\\claude.cmd",
  path.join(os.homedir(), "AppData", "Roaming", "npm", "claude.cmd"),
  path.join(os.homedir(), "AppData", "Roaming", "npm", "claude")
];
function detectClaudePath() {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = child_process.execFileSync(cmd, ["claude"], { encoding: "utf8" }).trim();
    const first = result.split(/\r?\n/)[0]?.trim();
    if (first && fs.existsSync(first)) return first;
  } catch {
  }
  const candidates = process.platform === "win32" ? COMMON_PATHS_WIN32 : COMMON_PATHS_DARWIN;
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
const DEVICE_ID_FILENAME = "device-id";
function getOrCreateDeviceId() {
  const idPath = path.join(electron.app.getPath("userData"), DEVICE_ID_FILENAME);
  if (fs.existsSync(idPath)) {
    try {
      const stored = fs.readFileSync(idPath, "utf8").trim();
      if (stored && stored.length === 32) return stored;
    } catch {
    }
  }
  const id = generateDeviceFingerprint();
  try {
    fs.writeFileSync(idPath, id, { encoding: "utf8", flag: "w" });
  } catch {
  }
  return id;
}
function generateDeviceFingerprint() {
  const parts = [
    os.hostname(),
    process.platform,
    process.arch,
    os.cpus()[0]?.model ?? "",
    ...collectMacAddresses()
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").substring(0, 32);
}
function collectMacAddresses() {
  const macs = [];
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface ?? []) {
      if (!addr.internal && addr.mac && addr.mac !== "00:00:00:00:00:00") {
        macs.push(addr.mac.toLowerCase());
      }
    }
  }
  return macs.sort();
}
let bridge = null;
function setupIpc(getWindow) {
  electron.ipcMain.handle("device:getId", () => getOrCreateDeviceId());
  electron.ipcMain.handle("device:getStatus", () => {
    const settings = getSettings();
    const deviceId = getOrCreateDeviceId();
    const health = runHealthCheck(settings.claudePath);
    const report = buildStatusReport(deviceId, health, electron.app.getStartTime?.() ?? Date.now());
    if (bridge && bridge.getStatus() === "paired") {
      report.claudeStatus = "running";
      report.terminalStatus = "running";
      report.overallStatus = "healthy";
    }
    return report;
  });
  electron.ipcMain.handle("session:listPaired", async () => {
    const serverUrl = getEffectiveServerUrl();
    const desktopDeviceId = getOrCreateDeviceId();
    if (!serverUrl) return [];
    try {
      return await fetchDesktopSessionsFromServer(serverUrl, desktopDeviceId);
    } catch (_) {
      return [];
    }
  });
  electron.ipcMain.handle("session:delete", async (_e, sessionId, serverUrl) => {
    try {
      await fetch(`${serverUrl}/api/session/${sessionId}`, { method: "DELETE" });
    } catch (_) {
    }
    return { ok: true };
  });
  electron.ipcMain.handle("settings:get", () => getSettings());
  electron.ipcMain.handle("settings:save", (_e, patch) => {
    saveSettings(patch);
  });
  electron.ipcMain.handle("claude:detect", () => detectClaudePath());
  electron.ipcMain.handle("session:start", async () => {
    const settings = getSettings();
    const serverUrl = getEffectiveServerUrl();
    const deviceId = getOrCreateDeviceId();
    if (!serverUrl) {
      return {
        error: "Relay server URL is not configured. Please set it in Settings or set the RELAY_SERVER_URL env var."
      };
    }
    if (bridge) {
      bridge.stop();
      bridge.removeAllListeners();
    }
    bridge = new TerminalBridge();
    wireBridgeEvents(bridge, getWindow);
    const config = {
      serverUrl,
      claudePath: settings.claudePath,
      cwd: settings.cwd,
      deviceId
    };
    await bridge.start(config);
    return { ok: true };
  });
  electron.ipcMain.handle("session:stop", () => {
    bridge?.stop();
    return { ok: true };
  });
  electron.ipcMain.handle("session:getStatus", () => {
    if (!bridge) return { status: "idle" };
    return {
      status: bridge.getStatus(),
      qrInfo: bridge.getQrInfo()
    };
  });
  electron.ipcMain.handle("session:getOutputBuffer", () => {
    return bridge?.getOutputBuffer() ?? "";
  });
  electron.ipcMain.handle("session:getLogBuffer", () => {
    return bridge?.getLogBuffer() ?? "";
  });
  electron.ipcMain.handle("session:restartClaude", () => {
    if (!bridge) return { ok: false, error: "No active session" };
    return bridge.restartClaude();
  });
  electron.ipcMain.handle("app:relaunch", () => {
    electron.app.relaunch();
    electron.app.exit(0);
  });
  electron.ipcMain.on("xterm:snapshot", (_e, snapshot) => {
    bridge?.setXtermSnapshot(snapshot);
  });
}
async function fetchDesktopSessionsFromServer(serverUrl, desktopDeviceId) {
  const response = await fetch(
    `${serverUrl}/api/sessions/desktop?desktopDeviceId=${encodeURIComponent(desktopDeviceId)}`
  );
  if (!response.ok) return [];
  const result = await response.json();
  if (!result.success || !Array.isArray(result.data)) return [];
  return result.data.map((item) => ({
    sessionId: item.sessionId,
    serverUrl,
    desktopDeviceId: item.desktopDeviceId ?? desktopDeviceId,
    mobileDeviceId: item.mobileDeviceId ?? "unknown",
    desktopPlatform: item.agentPlatform ?? item.deviceStatus?.platform ?? void 0,
    mobilePlatform: item.mobilePlatform ?? void 0,
    desktopStatus: item.desktopStatus,
    mobileStatus: item.mobileStatus,
    launchType: item.launchType ?? "claude",
    hostname: item.agentHostname ?? void 0,
    pairedAt: item.pairedAt ?? item.lastActiveAt ?? Date.now(),
    lastUsedAt: item.lastActiveAt ?? Date.now()
  }));
}
function wireBridgeEvents(b, getWindow) {
  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };
  b.on("status", (info) => send("session:status", info));
  b.on("qr", (info) => send("session:qr", info));
  b.on("output", (data) => send("session:output", data));
  b.on("prompt", (p) => send("session:prompt", p));
  b.on("claude-exit", (code) => send("session:claude-exit", code));
  b.on("desktop-status", (stat) => send("session:desktop-status", stat));
}
async function maybeAutoStart(getWindow) {
  const settings = getSettings();
  const serverUrl = getEffectiveServerUrl();
  const deviceId = getOrCreateDeviceId();
  if (!settings.autoStart || !serverUrl) return;
  if (bridge) return;
  bridge = new TerminalBridge();
  wireBridgeEvents(bridge, getWindow);
  await bridge.start({
    serverUrl,
    claudePath: settings.claudePath,
    cwd: settings.cwd,
    deviceId
  });
}
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "apps/desktop/.env") });
const gotLock = electron.app.requestSingleInstanceLock();
if (!gotLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => {
    showMainWindow();
  });
}
electron.app.whenReady().then(async () => {
  const win = createMainWindow();
  createTray();
  setupIpc(() => getMainWindow());
  win.webContents.once("did-finish-load", async () => {
    await maybeAutoStart(() => getMainWindow());
  });
  electron.app.on("activate", () => {
    showMainWindow();
  });
});
electron.app.on("window-all-closed", () => {
});
electron.app.on("before-quit", () => {
  setQuitting(true);
});
