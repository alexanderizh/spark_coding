export interface AppSettings {
  serverUrl:  string
  claudePath: string
  cwd:        string
  autoStart:  boolean
}

export type BridgeStatus =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'paired'
  | 'error'
  | 'expired'
  | 'stopped'

export interface StatusInfo {
  status:   BridgeStatus
  message?: string
}

export interface QrInfo {
  qrPayload: string
  token:     string
  sessionId: string
}

export interface DesktopStatusReport {
  deviceId:       string
  hostname:       string
  platform:       string
  appVersion:     string
  overallStatus:  'healthy' | 'degraded' | 'offline'
  claudeStatus:   'running' | 'stopped' | 'error' | 'unknown'
  terminalStatus: 'running' | 'stopped' | 'error' | 'unknown'
  claudePath:     string
  uptimeMs:       number
  reportedAt:     number
}

export interface PairedSessionRecord {
  sessionId:       string
  serverUrl:       string
  desktopDeviceId: string
  mobileDeviceId:  string
  desktopPlatform?: string
  mobilePlatform?: string
  desktopStatus?:  'online' | 'offline'
  mobileStatus?:   'online' | 'offline'
  launchType:      string
  hostname?:       string
  pairedAt:        number
  lastUsedAt:      number
}

declare global {
  interface Window {
    api: {
      // Device
      getDeviceId:    () => Promise<string>
      getDeviceStatus: () => Promise<DesktopStatusReport>
      getAppVersion:  () => Promise<string>

      // Settings
      getSettings:    () => Promise<AppSettings>
      saveSettings:   (patch: Partial<AppSettings>) => Promise<void>
      detectClaude:   () => Promise<string | null>

      // Paired sessions
      listPairedSessions: () => Promise<PairedSessionRecord[]>
      deleteSession: (sessionId: string, serverUrl: string) => Promise<{ ok: boolean }>
      deleteSessions: (sessions: Array<{ sessionId: string; serverUrl: string }>) => Promise<{ ok: boolean; failed: number }>

      // Session
      startSession:    () => Promise<{ ok?: boolean; error?: string }>
      stopSession:     () => Promise<{ ok: boolean }>
      getSessionStatus: () => Promise<{ status: BridgeStatus; qrInfo?: QrInfo }>
      getOutputBuffer:  () => Promise<string>
      restartClaude:   () => Promise<{ ok: boolean; error?: string }>
      relaunchApp:     () => Promise<void>
      quitApp:         () => Promise<void>
      reportXtermSnapshot: (snapshot: string) => void

      // Events (return unsubscribe fn)
      onStatus:        (cb: (v: StatusInfo) => void)          => () => void
      onQr:            (cb: (v: QrInfo) => void)              => () => void
      onOutput:        (cb: (data: string) => void)           => () => void
      onClaudeExit:    (cb: (code: number) => void)           => () => void
      onDesktopStatus: (cb: (v: DesktopStatusReport) => void) => () => void
    }
  }
}
