import { ipcMain, BrowserWindow, app, IpcMainEvent }    from 'electron'
import { TerminalBridge, BridgeConfig }                  from './terminal-bridge'
import { getSettings, saveSettings, getEffectiveServerUrl, AppSettings, PairedSessionRecord } from './store'
import { detectClaudePath }                              from './claude-detector'
import { getOrCreateDeviceId }                           from './device-id'
import { runHealthCheck, buildStatusReport }             from './health-checker'

let bridge: TerminalBridge | null = null

/**
 * Register all IPC handlers and wire TerminalBridge events → renderer.
 * Call once after the main window is created.
 */
export function setupIpc(getWindow: () => BrowserWindow | null): void {
  // ── Device ───────────────────────────────────────────────────────────────
  ipcMain.handle('device:getId', () => getOrCreateDeviceId())

  ipcMain.handle('device:getVersion', () => app.getVersion())

  ipcMain.handle('device:getStatus', () => {
    const settings   = getSettings()
    const deviceId   = getOrCreateDeviceId()
    const health     = runHealthCheck(settings.claudePath)
    const report     = buildStatusReport(deviceId, health, app.getStartTime?.() ?? Date.now())
    // Inject live Claude process state
    if (bridge && bridge.getStatus() === 'paired') {
      report.claudeStatus   = 'running'
      report.terminalStatus = 'running'
      report.overallStatus  = 'healthy'
    }
    return report
  })

  // ── Paired sessions ───────────────────────────────────────────────────────
  ipcMain.handle('session:listPaired', async () => {
    const serverUrl = getEffectiveServerUrl()
    const desktopDeviceId = getOrCreateDeviceId()
    if (!serverUrl) return []
    try {
      return await fetchDesktopSessionsFromServer(serverUrl, desktopDeviceId)
    } catch (_) {
      return []
    }
  })

  ipcMain.handle('session:delete', async (_e, sessionId: string, serverUrl: string) => {
    try {
      await fetch(`${serverUrl}/api/session/${sessionId}`, { method: 'DELETE' })
    } catch (_) {
      // ignore
    }
    return { ok: true }
  })

  // ── Settings ─────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:save', (_e, patch: Partial<AppSettings>) => {
    saveSettings(patch)
  })

  ipcMain.handle('claude:detect', () => detectClaudePath())

  // ── Session ───────────────────────────────────────────────────────────────
  ipcMain.handle('session:start', async () => {
    const settings  = getSettings()
    const serverUrl = getEffectiveServerUrl()
    const deviceId  = getOrCreateDeviceId()

    if (!serverUrl) {
      return {
        error: 'Relay server URL is not configured. ' +
               'Please set it in Settings or set the RELAY_SERVER_URL env var.',
      }
    }

    if (bridge) {
      bridge.stop()
      bridge.removeAllListeners()
    }

    bridge = new TerminalBridge()
    wireBridgeEvents(bridge, getWindow)

    const config: BridgeConfig = {
      serverUrl,
      claudePath: settings.claudePath,
      cwd:        settings.cwd,
      deviceId,
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

  ipcMain.handle('session:getOutputBuffer', () => {
    return bridge?.getOutputBuffer() ?? ''
  })

  ipcMain.handle('session:getLogBuffer', () => {
    return bridge?.getLogBuffer() ?? ''
  })

  ipcMain.handle('session:restartClaude', () => {
    if (!bridge) return { ok: false, error: 'No active session' }
    return bridge.restartClaude()
  })

  ipcMain.handle('app:relaunch', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.on('xterm:snapshot', (_e: IpcMainEvent, snapshot: string) => {
    bridge?.setXtermSnapshot(snapshot)
  })
}

async function fetchDesktopSessionsFromServer(serverUrl: string, desktopDeviceId: string): Promise<PairedSessionRecord[]> {
  const response = await fetch(
    `${serverUrl}/api/sessions/desktop?desktopDeviceId=${encodeURIComponent(desktopDeviceId)}`
  )
  if (!response.ok) return []
  const result = await response.json() as {
    success?: boolean
    data?: Array<{
      sessionId: string
      agentHostname?: string | null
      agentPlatform?: string | null
      mobilePlatform?: string | null
      desktopDeviceId?: string | null
      mobileDeviceId?: string | null
      desktopStatus?: 'online' | 'offline'
      mobileStatus?: 'online' | 'offline'
      launchType?: string | null
      pairedAt?: number | null
      lastActiveAt?: number
      deviceStatus?: { platform?: string | null } | null
    }>
  }

  if (!result.success || !Array.isArray(result.data)) return []

  return result.data.map((item) => ({
    sessionId:       item.sessionId,
    serverUrl,
    desktopDeviceId: item.desktopDeviceId ?? desktopDeviceId,
    mobileDeviceId:  item.mobileDeviceId ?? 'unknown',
    desktopPlatform: item.agentPlatform ?? item.deviceStatus?.platform ?? undefined,
    mobilePlatform:  item.mobilePlatform ?? undefined,
    desktopStatus:   item.desktopStatus,
    mobileStatus:    item.mobileStatus,
    launchType:      item.launchType ?? 'claude',
    hostname:        item.agentHostname ?? undefined,
    pairedAt:        item.pairedAt ?? item.lastActiveAt ?? Date.now(),
    lastUsedAt:      item.lastActiveAt ?? Date.now(),
  }))
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

  b.on('status',         (info)  => send('session:status',        info))
  b.on('qr',             (info)  => send('session:qr',            info))
  b.on('output',         (data)  => send('session:output',        data))
  b.on('prompt',         (p)     => send('session:prompt',        p))
  b.on('claude-exit',    (code)  => send('session:claude-exit',   code))
  b.on('desktop-status', (stat)  => send('session:desktop-status', stat))
}

/**
 * Auto-start a session if settings are configured and autoStart is enabled.
 * Called after the main window finishes loading.
 */
export async function maybeAutoStart(getWindow: () => BrowserWindow | null): Promise<void> {
  const settings  = getSettings()
  const serverUrl = getEffectiveServerUrl()
  const deviceId  = getOrCreateDeviceId()

  if (!settings.autoStart || !serverUrl) return
  if (bridge) return  // already running

  bridge = new TerminalBridge()
  wireBridgeEvents(bridge, getWindow)

  await bridge.start({
    serverUrl,
    claudePath: settings.claudePath,
    cwd:        settings.cwd,
    deviceId,
  })
}
