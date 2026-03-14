"use strict";
const electron = require("electron");
const path = require("path");
const events = require("events");
const child_process = require("child_process");
const os = require("os");
const pty = require("node-pty");
const socket_ioClient = require("socket.io-client");
const axios = require("axios");
const shared = require("@spark_coder/shared");
const fs = require("fs");
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
function setQuitting(v) {
  isQuitting = v;
}
function createMainWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 720,
    minHeight: 500,
    title: "Spark Coder",
    backgroundColor: "#0f0f14",
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
  const iconPath = path.join(__dirname, "../../resources/tray-icon.png");
  let icon;
  try {
    icon = electron.nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = electron.nativeImage.createEmpty();
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
const BATCH_INTERVAL_MS = 16;
const RING_BUFFER_SIZE = 1024 * 1024;
const DEBOUNCE_MS = 100;
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
  // Batching
  batchBuffer = "";
  batchTimer;
  // Ring buffer (reconnect catch-up)
  ringBuffer = [];
  ringBufferBytes = 0;
  // Prompt detector state
  detectorBuffer = "";
  detectorTimer;
  // Keepalive
  pingInterval;
  // ── Public API ───────────────────────────────────────────────────────────────
  getStatus() {
    return this.status;
  }
  getQrInfo() {
    return this.qrInfo;
  }
  async start(config) {
    if (this.status !== "idle" && this.status !== "stopped" && this.status !== "error" && this.status !== "expired") {
      return;
    }
    this.config = config;
    this.reset();
    this.setStatus("connecting", `Connecting to ${config.serverUrl}…`);
    let session;
    try {
      const res = await axios.post(
        `${config.serverUrl}/api/session`,
        {},
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
      auth: { token: session.token, role: "agent" },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1e3,
      reconnectionDelayMax: 3e4,
      randomizationFactor: 0.5,
      transports: ["websocket"]
    });
    this.registerSocketEvents();
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
    this.setStatus("stopped", "Session stopped");
  }
  // ── Socket events ─────────────────────────────────────────────────────────────
  registerSocketEvents() {
    const socket = this.socket;
    socket.on("connect", () => {
      const payload = {
        sessionToken: this.token,
        agentVersion: "1.0.0",
        platform: process.platform,
        hostname: os.hostname()
      };
      socket.emit(shared.Events.AGENT_REGISTER, payload);
      this.setStatus("waiting", "Waiting for mobile to pair…");
      if (this.qrInfo) this.emit("qr", this.qrInfo);
    });
    socket.on("reconnect", () => {
    });
    socket.on("disconnect", (_reason) => {
    });
    socket.on(shared.Events.SESSION_PAIR, (payload) => {
      if (this.isPaired) {
        const buffered = this.flushRingBuffer();
        if (buffered && socket.connected) {
          const out = {
            sessionId: this.sessionId,
            data: buffered,
            timestamp: Date.now(),
            seq: ++this.outputSeq
          };
          socket.emit(shared.Events.TERMINAL_OUTPUT, out);
        }
        return;
      }
      this.isPaired = true;
      this.setStatus("paired", `Paired with ${payload.mobileDeviceId}`);
      this.spawnClaude();
    });
    socket.on(shared.Events.SESSION_STATE, (payload) => {
      if (payload.state === shared.SessionState.MOBILE_DISCONNECTED) {
        this.setStatus("waiting", "Mobile disconnected — Claude still running…");
      }
    });
    socket.on(shared.Events.TERMINAL_INPUT, (payload) => {
      this.ptyProcess?.write(payload.data);
    });
    socket.on(shared.Events.TERMINAL_RESIZE, (payload) => {
      try {
        this.ptyProcess?.resize(payload.cols, payload.rows);
      } catch {
      }
    });
    socket.on(shared.Events.RUNTIME_ENSURE, (payload) => {
      if (payload.cliType !== shared.CliTypes.CLAUDE) {
        return;
      }
      if (this.ptyProcess) {
        this.emitRuntimeStatus({
          sessionId: this.sessionId,
          cliType: shared.CliTypes.CLAUDE,
          ready: true,
          started: false,
          timestamp: Date.now()
        });
        return;
      }
      this.spawnClaude();
      this.emitRuntimeStatus({
        sessionId: this.sessionId,
        cliType: shared.CliTypes.CLAUDE,
        ready: !!this.ptyProcess,
        started: !!this.ptyProcess,
        message: this.ptyProcess ? void 0 : "Claude CLI 启动失败",
        timestamp: Date.now()
      });
    });
    socket.on(shared.Events.SESSION_ERROR, (payload) => {
      if (payload.code === shared.SessionErrorCode.SESSION_EXPIRED) {
        this.setStatus("expired", "Session expired — please start a new session");
        this.stop();
      } else {
        this.emit("error", payload.message);
      }
    });
    this.pingInterval = setInterval(() => {
      if (socket.connected && this.sessionId) {
        socket.emit(shared.Events.SESSION_PING, { sessionId: this.sessionId, timestamp: Date.now() });
      }
    }, 3e4);
  }
  // ── PTY (Claude CLI) ──────────────────────────────────────────────────────────
  spawnClaude() {
    if (!this.config) return;
    const execPath = this.resolveExecutable(this.config.claudePath);
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus("error", `Cannot spawn Claude CLI at "${execPath}": ${msg}`);
      return;
    }
    this.ptyProcess.onData((data) => {
      this.feedDetector(data);
      this.appendToRing(data);
      this.batchOutput(data);
    });
    this.ptyProcess.onExit(({ exitCode }) => {
      this.emit("claude-exit", exitCode);
      this.ptyProcess = void 0;
    });
  }
  emitRuntimeStatus(payload) {
    if (!this.socket?.connected) {
      return;
    }
    this.socket.emit(shared.Events.RUNTIME_STATUS, payload);
  }
  // ── Output batching (~60fps) ──────────────────────────────────────────────────
  batchOutput(data) {
    this.batchBuffer += data;
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        const chunk = this.batchBuffer;
        this.batchBuffer = "";
        this.batchTimer = void 0;
        if (this.socket?.connected && this.sessionId) {
          const payload = {
            sessionId: this.sessionId,
            data: chunk,
            timestamp: Date.now(),
            seq: ++this.outputSeq
          };
          this.socket.emit(shared.Events.TERMINAL_OUTPUT, payload);
        }
        this.emit("output", chunk);
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
          }
          this.emit("prompt", { type, rawText: match[0] });
          break;
        }
      }
    }, DEBOUNCE_MS);
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
    const info = { status, message };
    this.emit("status", info);
  }
  clearTimers() {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    if (this.detectorTimer) clearTimeout(this.detectorTimer);
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.batchTimer = void 0;
    this.detectorTimer = void 0;
    this.pingInterval = void 0;
  }
  reset() {
    this.clearTimers();
    this.ringBuffer = [];
    this.ringBufferBytes = 0;
    this.detectorBuffer = "";
    this.batchBuffer = "";
    this.isPaired = false;
    this.outputSeq = 0;
    this.qrInfo = void 0;
    this.sessionId = void 0;
    this.token = void 0;
  }
}
const DEFAULTS = {
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
  if (!fs.existsSync(p)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}
function saveSettings(patch) {
  const current = getSettings();
  fs.writeFileSync(settingsPath(), JSON.stringify({ ...current, ...patch }, null, 2), "utf8");
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
let bridge = null;
function setupIpc(getWindow) {
  electron.ipcMain.handle("settings:get", () => getSettings());
  electron.ipcMain.handle("settings:save", (_e, patch) => {
    saveSettings(patch);
  });
  electron.ipcMain.handle("claude:detect", () => detectClaudePath());
  electron.ipcMain.handle("session:start", async () => {
    const settings = getSettings();
    if (!settings.serverUrl) {
      return { error: "Relay server URL is not configured. Please check Settings." };
    }
    if (bridge) {
      bridge.stop();
      bridge.removeAllListeners();
    }
    bridge = new TerminalBridge();
    wireBridgeEvents(bridge, getWindow);
    const config = {
      serverUrl: settings.serverUrl,
      claudePath: settings.claudePath,
      cwd: settings.cwd
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
}
async function maybeAutoStart(getWindow) {
  const settings = getSettings();
  if (!settings.autoStart || !settings.serverUrl) return;
  if (bridge) return;
  bridge = new TerminalBridge();
  wireBridgeEvents(bridge, getWindow);
  await bridge.start({
    serverUrl: settings.serverUrl,
    claudePath: settings.claudePath,
    cwd: settings.cwd
  });
}
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
