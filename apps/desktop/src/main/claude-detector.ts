import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import os from 'os'

const COMMON_PATHS_DARWIN = [
  '/usr/local/bin/claude',
  '/opt/homebrew/bin/claude',
  join(os.homedir(), '.npm-global', 'bin', 'claude'),
  join(os.homedir(), '.local', 'bin', 'claude'),
]

const COMMON_PATHS_WIN32 = [
  'C:\\Program Files\\nodejs\\claude.cmd',
  join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
  join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude'),
]

/**
 * Attempts to auto-detect the Claude CLI executable path.
 * Returns the absolute path if found, or null.
 */
export function detectClaudePath(): string | null {
  // 1. Try PATH via `which` / `where`
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const result = execFileSync(cmd, ['claude'], { encoding: 'utf8' }).trim()
    const first = result.split(/\r?\n/)[0]?.trim()
    if (first && existsSync(first)) return first
  } catch { /* not in PATH */ }

  // 2. Check well-known install locations
  const candidates = process.platform === 'win32' ? COMMON_PATHS_WIN32 : COMMON_PATHS_DARWIN
  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return null
}
