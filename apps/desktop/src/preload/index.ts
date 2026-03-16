import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

type Unsubscribe = () => void

/**
 * Exposed to renderer via window.api
 * All calls go through contextBridge for security isolation.
 */
contextBridge.exposeInMainWorld('api', {
  // ── Device ───────────────────────────────────────────────────────────────────
  getDeviceId: (): Promise<string> =>
    ipcRenderer.invoke('device:getId'),

  getDeviceStatus: (): Promise<unknown> =>
    ipcRenderer.invoke('device:getStatus'),

  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke('device:getVersion'),

  // ── Settings ─────────────────────────────────────────────────────────────────
  getSettings: (): Promise<unknown> =>
    ipcRenderer.invoke('settings:get'),

  saveSettings: (patch: unknown): Promise<void> =>
    ipcRenderer.invoke('settings:save', patch),

  getEffectiveServerUrl: (): Promise<{ url: string; source: 'settings' | 'env'; envVar: string }> =>
    ipcRenderer.invoke('settings:getEffectiveServerUrl'),

  detectClaude: (): Promise<string | null> =>
    ipcRenderer.invoke('claude:detect'),

  // ── Paired sessions ───────────────────────────────────────────────────────────
  listPairedSessions: (): Promise<unknown[]> =>
    ipcRenderer.invoke('session:listPaired'),

  deleteSession: (sessionId: string, serverUrl: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('session:delete', sessionId, serverUrl),

  deleteSessions: (sessions: Array<{ sessionId: string; serverUrl: string }>): Promise<{ ok: boolean; failed: number }> =>
    ipcRenderer.invoke('session:deleteBatch', sessions),

  // ── Session ───────────────────────────────────────────────────────────────────
  startSession: (): Promise<unknown> =>
    ipcRenderer.invoke('session:start'),

  stopSession: (): Promise<unknown> =>
    ipcRenderer.invoke('session:stop'),

  getSessionStatus: (): Promise<unknown> =>
    ipcRenderer.invoke('session:getStatus'),

  getOutputBuffer: (): Promise<string> =>
    ipcRenderer.invoke('session:getOutputBuffer'),

  getLogBuffer: (): Promise<string> =>
    ipcRenderer.invoke('session:getLogBuffer'),

  restartClaude: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('session:restartClaude'),

  relaunchApp: (): Promise<void> =>
    ipcRenderer.invoke('app:relaunch'),

  quitApp: (): Promise<void> =>
    ipcRenderer.invoke('app:quit'),

  // ── Events: main → renderer ───────────────────────────────────────────────────
  onStatus: (cb: (v: unknown) => void): Unsubscribe => {
    const handler = (_: IpcRendererEvent, v: unknown) => cb(v)
    ipcRenderer.on('session:status', handler)
    return () => ipcRenderer.off('session:status', handler)
  },

  onQr: (cb: (v: unknown) => void): Unsubscribe => {
    const handler = (_: IpcRendererEvent, v: unknown) => cb(v)
    ipcRenderer.on('session:qr', handler)
    return () => ipcRenderer.off('session:qr', handler)
  },

  onOutput: (cb: (data: string) => void): Unsubscribe => {
    const handler = (_: IpcRendererEvent, v: string) => cb(v)
    ipcRenderer.on('session:output', handler)
    return () => ipcRenderer.off('session:output', handler)
  },

  onClaudeExit: (cb: (code: number) => void): Unsubscribe => {
    const handler = (_: IpcRendererEvent, v: number) => cb(v)
    ipcRenderer.on('session:claude-exit', handler)
    return () => ipcRenderer.off('session:claude-exit', handler)
  },

  onDesktopStatus: (cb: (v: unknown) => void): Unsubscribe => {
    const handler = (_: IpcRendererEvent, v: unknown) => cb(v)
    ipcRenderer.on('session:desktop-status', handler)
    return () => ipcRenderer.off('session:desktop-status', handler)
  },

  reportXtermSnapshot: (snapshot: string): void => {
    ipcRenderer.send('xterm:snapshot', snapshot)
  },

  // ── Auto-update ───────────────────────────────────────────────────────────
  checkForUpdate: (): Promise<unknown> =>
    ipcRenderer.invoke('update:check'),

  downloadUpdate: (url: string): Promise<{ ok: boolean; filePath?: string }> =>
    ipcRenderer.invoke('update:download', url),

  installUpdate: (filePath: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('update:install', filePath),

  showUpdateInFolder: (filePath: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('update:showInFolder', filePath),

  onUpdateProgress: (cb: (v: { progress: number }) => void): Unsubscribe => {
    const handler = (_: IpcRendererEvent, v: { progress: number }) => cb(v)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.off('update:progress', handler)
  },
})
