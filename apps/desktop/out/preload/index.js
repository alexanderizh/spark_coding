"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  // ── Settings ────────────────────────────────────────────────────────────────
  getSettings: () => electron.ipcRenderer.invoke("settings:get"),
  saveSettings: (patch) => electron.ipcRenderer.invoke("settings:save", patch),
  detectClaude: () => electron.ipcRenderer.invoke("claude:detect"),
  // ── Session ──────────────────────────────────────────────────────────────────
  startSession: () => electron.ipcRenderer.invoke("session:start"),
  stopSession: () => electron.ipcRenderer.invoke("session:stop"),
  getSessionStatus: () => electron.ipcRenderer.invoke("session:getStatus"),
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
  }
});
