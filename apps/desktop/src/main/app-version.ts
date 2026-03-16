import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

interface PackageJsonLike {
  version?: string
}

function readVersionFromPackageJson(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as PackageJsonLike
    if (typeof parsed.version === 'string' && parsed.version.trim()) {
      return parsed.version.trim()
    }
  } catch {
    return null
  }
  return null
}

export function getAppVersion(): string {
  const candidatePaths = [
    join(__dirname, '../../package.json'),
    join(app.getAppPath(), 'package.json'),
  ]

  for (const candidate of candidatePaths) {
    const version = readVersionFromPackageJson(candidate)
    if (version) return version
  }

  return app.getVersion()
}
