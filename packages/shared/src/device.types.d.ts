export type DesktopHealthStatus = 'healthy' | 'degraded' | 'offline';
export type ServiceRunStatus = 'running' | 'stopped' | 'error' | 'unknown';
/** Reported by desktop daemon → Server → cached, queryable by mobile */
export interface DesktopStatusReport {
    deviceId: string;
    hostname: string;
    platform: string;
    appVersion: string;
    overallStatus: DesktopHealthStatus;
    claudeStatus: ServiceRunStatus;
    terminalStatus: ServiceRunStatus;
    claudePath: string;
    uptimeMs: number;
    reportedAt: number;
}
/** Stored per desktop in server DB; returned to mobile on status query */
export interface DesktopStatusSnapshot extends DesktopStatusReport {
    updatedAt: number;
}
/** Lightweight device identity, sent at connection time */
export interface DeviceInfo {
    deviceId: string;
    platform: 'desktop' | 'mobile';
    hostname?: string;
    name?: string;
}
/** Stored locally on each side (desktop userData + mobile secure storage) */
export interface PairedSessionRecord {
    sessionId: string;
    desktopDeviceId: string;
    mobileDeviceId: string;
    serverUrl: string;
    launchType: string;
    hostname?: string;
    pairedAt: number;
    lastUsedAt: number;
    desktopStatus?: 'online' | 'offline';
    mobileStatus?: 'online' | 'offline';
}
//# sourceMappingURL=device.types.d.ts.map