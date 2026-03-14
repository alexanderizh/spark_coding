import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import os from 'os'

export interface AppSettings {
  serverUrl: string
  claudePath: string
  cwd: string
  autoStart: boolean
}

const DEFAULTS: AppSettings = {
  serverUrl: '',
  claudePath: 'claude',
  cwd: os.homedir(),
  autoStart: true,
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): AppSettings {
  const p = settingsPath()
  if (!existsSync(p)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<AppSettings>
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(patch: Partial<AppSettings>): void {
  const current = getSettings()
  writeFileSync(settingsPath(), JSON.stringify({ ...current, ...patch }, null, 2), 'utf8')
}
