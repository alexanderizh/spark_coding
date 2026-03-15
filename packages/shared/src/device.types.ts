// ── Device & Health Types ─────────────────────────────────────────────────────

export type DesktopHealthStatus = 'healthy' | 'degraded' | 'offline';
export type ServiceRunStatus    = 'running' | 'stopped' | 'error' | 'unknown';

/** Reported by desktop daemon → Server → cached, queryable by mobile */
export interface DesktopStatusReport {
  deviceId:       string;              // desktop fingerprint (32-char hex)
  hostname:       string;
  platform:       string;              // 'darwin' | 'win32' | 'linux'
  appVersion:     string;
  overallStatus:  DesktopHealthStatus;
  claudeStatus:   ServiceRunStatus;
  terminalStatus: ServiceRunStatus;
  claudePath:     string;
  uptimeMs:       number;
  reportedAt:     number;             // Unix ms
}

/** Stored per desktop in server DB; returned to mobile on status query */
export interface DesktopStatusSnapshot extends DesktopStatusReport {
  updatedAt: number;                  // last time server received a report
}

/** Lightweight device identity, sent at connection time */
export interface DeviceInfo {
  deviceId:  string;
  platform:  'desktop' | 'mobile';
  hostname?: string;
  name?:     string;
}

/** Stored locally on each side (desktop userData + mobile secure storage) */
export interface PairedSessionRecord {
  sessionId:       string;
  desktopDeviceId: string;
  mobileDeviceId:  string;
  serverUrl:       string;
  launchType:      string;
  hostname?:       string;
  pairedAt:        number;
  lastUsedAt:      number;
  desktopStatus?:  'online' | 'offline';
  mobileStatus?:   'online' | 'offline';
}
