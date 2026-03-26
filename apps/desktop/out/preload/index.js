"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  // ── Device ───────────────────────────────────────────────────────────────────
  getDeviceId: () => electron.ipcRenderer.invoke("device:getId"),
  getDeviceStatus: () => electron.ipcRenderer.invoke("device:getStatus"),
  getAppVersion: () => electron.ipcRenderer.invoke("device:getVersion"),
  // ── Settings ─────────────────────────────────────────────────────────────────
  getSettings: () => electron.ipcRenderer.invoke("settings:get"),
  saveSettings: (patch) => electron.ipcRenderer.invoke("settings:save", patch),
  getEffectiveServerUrl: () => electron.ipcRenderer.invoke("settings:getEffectiveServerUrl"),
  detectClaude: () => electron.ipcRenderer.invoke("claude:detect"),
  // ── Paired sessions ───────────────────────────────────────────────────────────
  listPairedSessions: () => electron.ipcRenderer.invoke("session:listPaired"),
  deleteSession: (sessionId, serverUrl) => electron.ipcRenderer.invoke("session:delete", sessionId, serverUrl),
  deleteSessions: (sessions) => electron.ipcRenderer.invoke("session:deleteBatch", sessions),
  // ── Session ───────────────────────────────────────────────────────────────────
  startSession: () => electron.ipcRenderer.invoke("session:start"),
  stopSession: () => electron.ipcRenderer.invoke("session:stop"),
  getSessionStatus: () => electron.ipcRenderer.invoke("session:getStatus"),
  getOutputBuffer: () => electron.ipcRenderer.invoke("session:getOutputBuffer"),
  getLogBuffer: () => electron.ipcRenderer.invoke("session:getLogBuffer"),
  restartClaude: () => electron.ipcRenderer.invoke("session:restartClaude"),
  relaunchApp: () => electron.ipcRenderer.invoke("app:relaunch"),
  quitApp: () => electron.ipcRenderer.invoke("app:quit"),
  // ── Events: main → renderer ───────────────────────────────────────────────────
  onStatus: (cb) => {
    const handler = (_, v) => cb(v);
    electron.ipcRenderer.on("session:status", handler);
    return () => electron.ipcRenderer.off("session:status", handler);
  },
  onQr: (cb) => {
    const handler = (_, v) => cb(v);
    electron.ipcRenderer.on("session:qr", handler);
    return () => electron.ipcRenderer.off("session:qr", handler);
  },
  onOutput: (cb) => {
    const handler = (_, v) => cb(v);
    electron.ipcRenderer.on("session:output", handler);
    return () => electron.ipcRenderer.off("session:output", handler);
  },
  onClaudeExit: (cb) => {
    const handler = (_, v) => cb(v);
    electron.ipcRenderer.on("session:claude-exit", handler);
    return () => electron.ipcRenderer.off("session:claude-exit", handler);
  },
  onDesktopStatus: (cb) => {
    const handler = (_, v) => cb(v);
    electron.ipcRenderer.on("session:desktop-status", handler);
    return () => electron.ipcRenderer.off("session:desktop-status", handler);
  },
  reportXtermSnapshot: (snapshot) => {
    electron.ipcRenderer.send("xterm:snapshot", snapshot);
  },
  // ── Terminal Input ───────────────────────────────────────────────────────
  sendTerminalInput: (data) => {
    electron.ipcRenderer.send("terminal:input", data);
  },
  // ── Local Terminal Tabs ───────────────────────────────────────────────────────
  createLocalTerminal: () => electron.ipcRenderer.invoke("local-terminal:create"),
  closeLocalTerminal: (tabId) => electron.ipcRenderer.invoke("local-terminal:close", tabId),
  getLocalTerminalOutput: (tabId) => electron.ipcRenderer.invoke("local-terminal:getOutput", tabId),
  resizeLocalTerminal: (tabId, cols, rows) => electron.ipcRenderer.invoke("local-terminal:resize", tabId, cols, rows),
  sendLocalTerminalInput: (tabId, data) => {
    electron.ipcRenderer.send("local-terminal:input", tabId, data);
  },
  onLocalTerminalOutput: (cb) => {
    const handler = (_, e) => cb(e);
    electron.ipcRenderer.on("local-terminal:output", handler);
    return () => electron.ipcRenderer.off("local-terminal:output", handler);
  },
  onLocalTerminalExit: (cb) => {
    const handler = (_, e) => cb(e);
    electron.ipcRenderer.on("local-terminal:exit", handler);
    return () => electron.ipcRenderer.off("local-terminal:exit", handler);
  },
  // ── Auto-update ───────────────────────────────────────────────────────────
  checkForUpdate: () => electron.ipcRenderer.invoke("update:check"),
  downloadUpdate: (url) => electron.ipcRenderer.invoke("update:download", url),
  installUpdate: (filePath) => electron.ipcRenderer.invoke("update:install", filePath),
  showUpdateInFolder: (filePath) => electron.ipcRenderer.invoke("update:showInFolder", filePath),
  onUpdateProgress: (cb) => {
    const handler = (_, v) => cb(v);
    electron.ipcRenderer.on("update:progress", handler);
    return () => electron.ipcRenderer.off("update:progress", handler);
  }
});
