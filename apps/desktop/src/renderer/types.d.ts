export interface AppSettings {
  serverUrl: string
  claudePath: string
  cwd: string
  autoStart: boolean
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
  status: BridgeStatus
  message?: string
}

export interface QrInfo {
  qrPayload: string
  token: string
  sessionId: string
}

declare global {
  interface Window {
    api: {
      // Settings
      getSettings: () => Promise<AppSettings>
      saveSettings: (patch: Partial<AppSettings>) => Promise<void>
      detectClaude: () => Promise<string | null>

      // Session
      startSession: () => Promise<{ ok?: boolean; error?: string }>
      stopSession: () => Promise<{ ok: boolean }>
      getSessionStatus: () => Promise<{ status: BridgeStatus; qrInfo?: QrInfo }>

      // Events (return unsubscribe fn)
      onStatus: (cb: (v: StatusInfo) => void) => () => void
      onQr: (cb: (v: QrInfo) => void) => () => void
      onOutput: (cb: (data: string) => void) => () => void
      onClaudeExit: (cb: (code: number) => void) => () => void
    }
  }
}
