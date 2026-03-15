/**
 * Generates and persists a stable physical device fingerprint for the desktop.
 *
 * The fingerprint is derived from hardware-level identifiers (MAC addresses,
 * hostname, CPU architecture) that remain constant across reboots and app
 * reinstalls.  It is stored in userData so that it survives app updates.
 */
import { createHash }                                  from 'crypto'
import os                                              from 'os'
import { app }                                         from 'electron'
import { join }                                        from 'path'
import { readFileSync, writeFileSync, existsSync }     from 'fs'

const DEVICE_ID_FILENAME = 'device-id'

/**
 * Returns the stable device fingerprint, generating and persisting it on first
 * call.  The fingerprint is a 32-character lowercase hex string.
 */
export function getOrCreateDeviceId(): string {
  const idPath = join(app.getPath('userData'), DEVICE_ID_FILENAME)

  if (existsSync(idPath)) {
    try {
      const stored = readFileSync(idPath, 'utf8').trim()
      if (stored && stored.length === 32) return stored
    } catch { /* fall through to re-generate */ }
  }

  const id = generateDeviceFingerprint()
  try {
    writeFileSync(idPath, id, { encoding: 'utf8', flag: 'w' })
  } catch {
    // Disk write failure is non-fatal; we'll return the in-memory value
  }
  return id
}

/**
 * Builds a SHA-256 hash from stable hardware identifiers.
 * We truncate to 32 hex chars (128 bits) — more than sufficient for uniqueness.
 */
function generateDeviceFingerprint(): string {
  const parts: string[] = [
    os.hostname(),
    process.platform,
    process.arch,
    os.cpus()[0]?.model ?? '',
    ...collectMacAddresses(),
  ]
  return createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .substring(0, 32)
}

/** Collects non-internal MAC addresses, sorted for determinism. */
function collectMacAddresses(): string[] {
  const macs: string[] = []
  const interfaces = os.networkInterfaces()
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface ?? []) {
      if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
        macs.push(addr.mac.toLowerCase())
      }
    }
  }
  return macs.sort()
}
