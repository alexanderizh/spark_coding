import { ipcMain, BrowserWindow } from 'electron'
import { TerminalBridge, BridgeConfig } from './terminal-bridge'
import { getSettings, saveSettings, AppSettings } from './store'
import { detectClaudePath } from './claude-detector'

let bridge: TerminalBridge | null = null

/**
 * Register all IPC handlers and wire TerminalBridge events → renderer.
 * Call once after the main window is created.
 */
export function setupIpc(getWindow: () => BrowserWindow | null): void {
  // ── Settings ────────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:save', (_e, patch: Partial<AppSettings>) => {
    saveSettings(patch)
  })

  ipcMain.handle('claude:detect', () => detectClaudePath())

  // ── Session ──────────────────────────────────────────────────────────────────
  ipcMain.handle('session:start', async () => {
    const settings = getSettings()

    if (!settings.serverUrl) {
      return { error: 'Relay server URL is not configured. Please check Settings.' }
    }

    if (bridge) {
      bridge.stop()
      bridge.removeAllListeners()
    }

    bridge = new TerminalBridge()
    wireBridgeEvents(bridge, getWindow)

    const config: BridgeConfig = {
      serverUrl: settings.serverUrl,
      claudePath: settings.claudePath,
      cwd: settings.cwd,
    }
    await bridge.start(config)
    return { ok: true }
  })

  ipcMain.handle('session:stop', () => {
    bridge?.stop()
    return { ok: true }
  })

  ipcMain.handle('session:getStatus', () => {
    if (!bridge) return { status: 'idle' }
    return {
      status: bridge.getStatus(),
      qrInfo: bridge.getQrInfo(),
    }
  })
}

/**
 * Forward TerminalBridge events to the renderer via webContents.send.
 */
function wireBridgeEvents(b: TerminalBridge, getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }

  b.on('status', (info) => send('session:status', info))
  b.on('qr',     (info) => send('session:qr', info))
  b.on('output', (data) => send('session:output', data))
  b.on('prompt', (p)    => send('session:prompt', p))
  b.on('claude-exit', (code) => send('session:claude-exit', code))
}

/**
 * Auto-start a session if settings are configured and autoStart is enabled.
 * Called after the main window finishes loading.
 */
export async function maybeAutoStart(getWindow: () => BrowserWindow | null): Promise<void> {
  const settings = getSettings()
  if (!settings.autoStart || !settings.serverUrl) return

  if (bridge) return  // already running

  bridge = new TerminalBridge()
  wireBridgeEvents(bridge, getWindow)

  await bridge.start({
    serverUrl: settings.serverUrl,
    claudePath: settings.claudePath,
    cwd: settings.cwd,
  })
}
