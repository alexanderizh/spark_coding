import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

type Unsubscribe = () => void

/**
 * Exposed to renderer via window.api
 * All calls go through contextBridge for security isolation.
 */
contextBridge.exposeInMainWorld('api', {
  // ── Settings ────────────────────────────────────────────────────────────────
  getSettings: (): Promise<unknown> =>
    ipcRenderer.invoke('settings:get'),

  saveSettings: (patch: unknown): Promise<void> =>
    ipcRenderer.invoke('settings:save', patch),

  detectClaude: (): Promise<string | null> =>
    ipcRenderer.invoke('claude:detect'),

  // ── Session ──────────────────────────────────────────────────────────────────
  startSession: (): Promise<unknown> =>
    ipcRenderer.invoke('session:start'),

  stopSession: (): Promise<unknown> =>
    ipcRenderer.invoke('session:stop'),

  getSessionStatus: (): Promise<unknown> =>
    ipcRenderer.invoke('session:getStatus'),

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
})
