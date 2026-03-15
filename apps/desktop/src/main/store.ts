import { app }                                         from 'electron'
import { join }                                        from 'path'
import { readFileSync, writeFileSync, existsSync }     from 'fs'
import os                                              from 'os'

// ── App settings ──────────────────────────────────────────────────────────────

export interface AppSettings {
  serverUrl:  string
  claudePath: string
  cwd:        string
  autoStart:  boolean
}

const SETTINGS_DEFAULTS: AppSettings = {
  serverUrl:  '',
  claudePath: 'claude',
  cwd:        os.homedir(),
  autoStart:  true,
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): AppSettings {
  const p = settingsPath()
  if (!existsSync(p)) return { ...SETTINGS_DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<AppSettings>
    return { ...SETTINGS_DEFAULTS, ...raw }
  } catch {
    return { ...SETTINGS_DEFAULTS }
  }
}

export const RELAY_SERVER_URL_ENV = 'RELAY_SERVER_URL'

export function getEffectiveServerUrl(): string {
  const settings    = getSettings()
  const fromSettings = settings.serverUrl?.trim()
  if (fromSettings) return fromSettings
  return process.env[RELAY_SERVER_URL_ENV]?.trim() ?? ''
}

export function saveSettings(patch: Partial<AppSettings>): void {
  const current = getSettings()
  writeFileSync(settingsPath(), JSON.stringify({ ...current, ...patch }, null, 2), 'utf8')
}

// ── Paired sessions storage ───────────────────────────────────────────────────

/**
 * A persistent record of a successfully-paired session.
 * Stored in userData/paired-sessions.json.
 * Used by desktop to reconnect without QR, and by mobile (via server) for
 * the session list.
 */
export interface PairedSessionRecord {
  /** Server-side UUID for the session */
  sessionId:       string
  serverUrl:       string
  desktopDeviceId: string
  mobileDeviceId:  string
  desktopPlatform?: string
  mobilePlatform?: string
  desktopStatus?:  'online' | 'offline'
  mobileStatus?:   'online' | 'offline'
  launchType:      string
  /** Desktop hostname at time of pairing */
  hostname?:       string
  pairedAt:        number  // Unix ms
  lastUsedAt:      number  // Unix ms
}

function pairedSessionsPath(): string {
  return join(app.getPath('userData'), 'paired-sessions.json')
}

export function getPairedSessions(): PairedSessionRecord[] {
  const p = pairedSessionsPath()
  if (!existsSync(p)) return []
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PairedSessionRecord[]
  } catch {
    return []
  }
}

export function savePairedSession(record: PairedSessionRecord): void {
  const all = getPairedSessions()
  const idx = all.findIndex(s => s.sessionId === record.sessionId)
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...record }
  } else {
    all.push(record)
  }
  writeFileSync(pairedSessionsPath(), JSON.stringify(all, null, 2), 'utf8')
}

export function updatePairedSessionLastUsed(sessionId: string): void {
  const all = getPairedSessions()
  const idx = all.findIndex(s => s.sessionId === sessionId)
  if (idx >= 0) {
    all[idx].lastUsedAt = Date.now()
    writeFileSync(pairedSessionsPath(), JSON.stringify(all, null, 2), 'utf8')
  }
}

export function removePairedSessionById(sessionId: string): void {
  const all = getPairedSessions().filter(s => s.sessionId !== sessionId)
  writeFileSync(pairedSessionsPath(), JSON.stringify(all, null, 2), 'utf8')
}
