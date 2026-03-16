/**
 * Desktop health checker — runs on startup and periodically (daemon).
 *
 * Checks:
 *  1. Claude CLI is accessible and executable
 *  2. Terminal bridge (PTY layer) is available
 *
 * Reports a DesktopStatusReport that is sent to the relay server and cached,
 * so mobile clients can see desktop health without an active session.
 */
import { execFileSync }       from 'child_process'
import { existsSync }         from 'fs'
import os                     from 'os'
import axios                  from 'axios'
import { DesktopStatusReport, ServiceRunStatus, DesktopHealthStatus } from '@spark_coder/shared'
import { getAppVersion } from './app-version'

// ── Health check result ───────────────────────────────────────────────────────

export interface HealthCheckResult {
  claudeStatus:   ServiceRunStatus
  claudePath:     string
  terminalStatus: ServiceRunStatus
  overallStatus:  DesktopHealthStatus
  message?:       string
}

/**
 * Performs a synchronous self-check.
 * Does NOT start anything — just inspects availability.
 */
export function runHealthCheck(claudePath: string): HealthCheckResult {
  const claudeCheck  = checkClaude(claudePath)
  const terminalCheck = checkTerminalLayer()

  let overall: DesktopHealthStatus = 'healthy'
  if (claudeCheck.status === 'error' && terminalCheck.status === 'error') {
    overall = 'offline'
  } else if (claudeCheck.status !== 'running' || terminalCheck.status !== 'running') {
    overall = 'degraded'
  }

  return {
    claudeStatus:   claudeCheck.status,
    claudePath:     claudeCheck.resolvedPath,
    terminalStatus: terminalCheck.status,
    overallStatus:  overall,
  }
}

/** Build a full status report payload from a health check result */
export function buildStatusReport(
  deviceId: string,
  result:   HealthCheckResult,
  startTime: number,
): DesktopStatusReport {
  return {
    deviceId,
    hostname:       os.hostname(),
    platform:       process.platform,
    appVersion:     getAppVersion(),
    overallStatus:  result.overallStatus,
    claudeStatus:   result.claudeStatus,
    terminalStatus: result.terminalStatus,
    claudePath:     result.claudePath,
    uptimeMs:       Date.now() - startTime,
    reportedAt:     Date.now(),
  }
}

/**
 * Report status to server via HTTP REST.
 * Non-throwing — logs errors but doesn't crash the app.
 */
export async function reportStatusToServer(
  serverUrl:    string,
  report:       DesktopStatusReport,
): Promise<void> {
  if (!serverUrl) return
  try {
    await axios.post(
      `${serverUrl}/api/device/status`,
      report,
      { timeout: 8_000 },
    )
  } catch {
    // Non-fatal — server may be unreachable
  }
}

// ── Individual checks ─────────────────────────────────────────────────────────

function checkClaude(claudePath: string): { status: ServiceRunStatus; resolvedPath: string } {
  const resolved = resolveExecutable(claudePath)

  // Check if the file exists and is executable
  if (resolved.includes('/') || resolved.includes('\\')) {
    if (!existsSync(resolved)) {
      return { status: 'stopped', resolvedPath: resolved }
    }
  }

  // Try running `claude --version`
  try {
    execFileSync(resolved, ['--version'], { encoding: 'utf8', timeout: 5_000 })
    return { status: 'running', resolvedPath: resolved }
  } catch {
    // Could be an older version without --version; try plain launch check
    try {
      // Just verify the binary is callable
      execFileSync(resolved, ['--help'], { encoding: 'utf8', timeout: 3_000 })
      return { status: 'running', resolvedPath: resolved }
    } catch {
      return { status: 'error', resolvedPath: resolved }
    }
  }
}

function checkTerminalLayer(): { status: ServiceRunStatus } {
  // node-pty is a native module — verify it can be required
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node-pty')
    return { status: 'running' }
  } catch {
    return { status: 'error' }
  }
}

function resolveExecutable(command: string): string {
  if (command.includes('/') || (process.platform === 'win32' && command.includes('\\'))) {
    return command
  }
  try {
    const cmd    = process.platform === 'win32' ? 'where' : 'which'
    const result = execFileSync(cmd, [command], { encoding: 'utf8' }).trim()
    return result.split(/\r?\n/)[0]?.trim() || command
  } catch {
    return command
  }
}
