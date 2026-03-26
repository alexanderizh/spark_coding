import { ipcMain, BrowserWindow, app, IpcMainEvent, shell } from 'electron'
import * as https from 'https'
import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import { TerminalBridge, BridgeConfig }                  from './terminal-bridge'
import { getSettings, saveSettings, getEffectiveServerUrl, AppSettings, PairedSessionRecord } from './store'
import { detectClaudePath }                              from './claude-detector'
import { getOrCreateDeviceId }                           from './device-id'
import { runHealthCheck, buildStatusReport }             from './health-checker'
import { getAppVersion }                                 from './app-version'
import { setQuitting } from './window-manager'
import { RELAY_SERVER_URL_ENV } from './store'

let bridge: TerminalBridge | null = null

/**
 * Register all IPC handlers and wire TerminalBridge events → renderer.
 * Call once after the main window is created.
 */
export function setupIpc(getWindow: () => BrowserWindow | null): void {
  // ── Device ───────────────────────────────────────────────────────────────
  ipcMain.handle('device:getId', () => getOrCreateDeviceId())

  ipcMain.handle('device:getVersion', () => getAppVersion())

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

  ipcMain.handle('session:deleteBatch', async (_e, sessions: Array<{ sessionId: string; serverUrl: string }>) => {
    const results = await Promise.allSettled(
      sessions.map(({ sessionId, serverUrl }) =>
        fetch(`${serverUrl}/api/session/${sessionId}`, { method: 'DELETE' }).catch(() => null)
      )
    )
    const failed = results.filter(r => r.status === 'rejected').length
    return { ok: true, failed }
  })

  // ── Settings ─────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:save', (_e, patch: Partial<AppSettings>) => {
    saveSettings(patch)
  })

  ipcMain.handle('settings:getEffectiveServerUrl', () => {
    return {
      url: getEffectiveServerUrl(),
      source: getSettings().serverUrl?.trim() ? 'settings' : 'env',
      envVar: RELAY_SERVER_URL_ENV,
    }
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

  ipcMain.handle('app:quit', () => {
    setQuitting(true)
    app.quit()
  })

  ipcMain.on('xterm:snapshot', (_e: IpcMainEvent, snapshot: string) => {
    bridge?.setXtermSnapshot(snapshot)
  })

  // ── Terminal Input ───────────────────────────────────────────────────────
  ipcMain.on('terminal:input', (_e: IpcMainEvent, data: string) => {
    bridge?.writeToTerminal(data)
  })

  // ── Local Terminal Tabs ───────────────────────────────────────────────────────
  ipcMain.handle('local-terminal:create', () => {
    if (!bridge) {
      // Create a minimal bridge just for local terminals if needed
      bridge = new TerminalBridge()
      wireBridgeEvents(bridge, getWindow)
    }
    const settings = getSettings()
    return bridge.createLocalTerminal(settings.claudePath, settings.cwd)
  })

  ipcMain.handle('local-terminal:close', (_e, tabId: string) => {
    bridge?.closeLocalTerminal(tabId)
    return { ok: true }
  })

  ipcMain.handle('local-terminal:getOutput', (_e, tabId: string) => {
    return bridge?.getLocalTerminalOutput(tabId) ?? ''
  })

  ipcMain.handle('local-terminal:resize', (_e, tabId: string, cols: number, rows: number) => {
    bridge?.resizeLocalTerminal(tabId, cols, rows)
  })

  ipcMain.on('local-terminal:input', (_e: IpcMainEvent, tabId: string, data: string) => {
    bridge?.writeToLocalTerminal(tabId, data)
  })

  // ── Auto-update ───────────────────────────────────────────────────────────
  ipcMain.handle('update:check', async () => {
    const serverUrl = getEffectiveServerUrl()
    if (!serverUrl) return { hasUpdate: false }
    const platform = process.platform === 'darwin' ? 'macos' : 'windows'
    try {
      const current = getAppVersion()
      const resp = await fetch(`${serverUrl}/api/version/latest?platform=${platform}`)
      if (!resp.ok) return { hasUpdate: false }
      const body = await resp.json() as { success?: boolean; data?: { version: string; downloadUrl: string; releaseNotes?: string | null } | null }
      if (!body.success || !body.data) return { hasUpdate: false }
      const { version: remote, downloadUrl, releaseNotes } = body.data
      if (!isNewer(remote, current)) return { hasUpdate: false }
      return { hasUpdate: true, version: remote, downloadUrl, releaseNotes: releaseNotes ?? null }
    } catch (_) {
      return { hasUpdate: false }
    }
  })

  ipcMain.handle('update:download', async (_e, url: string) => {
    try {
      const filePath = await downloadUpdate(url, getWindow)
      return { ok: true, filePath }
    } catch (_) {
      return { ok: false }
    }
  })

  ipcMain.handle('update:install', async (_e, filePath: string) => {
    try {
      await shell.openPath(filePath)
      return { ok: true }
    } catch (_) {
      return { ok: false }
    }
  })

  ipcMain.handle('update:showInFolder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
    return { ok: true }
  })
}

/** Returns true if remote version string is newer than current. */
function isNewer(remote: string, current: string): boolean {
  const rParts = remote.split('.').map(Number)
  const cParts = current.split('.').map(Number)
  const len = Math.max(rParts.length, cParts.length)
  for (let i = 0; i < len; i++) {
    const r = rParts[i] ?? 0
    const c = cParts[i] ?? 0
    if (r > c) return true
    if (r < c) return false
  }
  return false
}

/** Downloads a file from url to the system temp directory, emitting progress events. */
function downloadUpdate(url: string, getWindow: () => BrowserWindow | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const ext = process.platform === 'darwin' ? 'dmg' : 'exe'
    const destPath = path.join(app.getPath('temp'), `spark_coder_update.${ext}`)
    const file = fs.createWriteStream(destPath)

    const protocol = url.startsWith('https') ? https : http
    protocol.get(url, (res) => {
      const total = parseInt(res.headers['content-length'] ?? '0', 10)
      let received = 0

      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (total > 0) {
          const progress = received / total
          const win = getWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.send('update:progress', { progress })
          }
        }
      })

      res.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve(destPath)
      })
    }).on('error', (err) => {
      fs.unlink(destPath, () => { /* ignore */ })
      reject(err)
    })
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

  // Local terminal events
  b.on('local-output',   (e: { tabId: string; data: string }) => send('local-terminal:output', e))
  b.on('local-exit',     (e: { tabId: string; exitCode: number }) => send('local-terminal:exit', e))
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
