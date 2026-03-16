import { existsSync, readdirSync } from 'fs'
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
 * Enumerate nvm-installed claude binaries (any node version).
 * Returns all found paths sorted by node version (descending — newest first).
 */
function nvmClaudePaths(): string[] {
  const nvmDir = process.env.NVM_DIR || join(os.homedir(), '.nvm')
  const versionsDir = join(nvmDir, 'versions', 'node')
  if (!existsSync(versionsDir)) return []
  try {
    return readdirSync(versionsDir)
      .sort()
      .reverse()
      .map(v => join(versionsDir, v, 'bin', 'claude'))
      .filter(existsSync)
  } catch {
    return []
  }
}

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

  // 2. Check nvm-managed node versions (common when node is installed via nvm)
  if (process.platform !== 'win32') {
    const nvmPaths = nvmClaudePaths()
    if (nvmPaths.length > 0) return nvmPaths[0]
  }

  // 3. Check well-known install locations
  const candidates = process.platform === 'win32' ? COMMON_PATHS_WIN32 : COMMON_PATHS_DARWIN
  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return null
}
