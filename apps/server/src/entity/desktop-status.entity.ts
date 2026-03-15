import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Stores the latest health status reported by each desktop device.
 * One row per desktop (upserted on each daemon report).
 */
@Entity('desktop_status')
export class DesktopStatus {
  /** Desktop device fingerprint (FK to devices.id, stored inline for simplicity) */
  @PrimaryColumn({ type: 'varchar', length: 128, name: 'device_id' })
  deviceId!: string;

  /** Desktop hostname at time of last report */
  @Column({ type: 'varchar', length: 128 })
  hostname!: string;

  /** 'darwin' | 'win32' | 'linux' */
  @Column({ type: 'varchar', length: 32 })
  platform!: string;

  /** Electron app version */
  @Column({ type: 'varchar', nullable: true, length: 32, name: 'app_version' })
  appVersion!: string | null;

  /** 'healthy' | 'degraded' | 'offline' */
  @Column({ type: 'varchar', length: 16, name: 'overall_status', default: 'unknown' })
  overallStatus!: string;

  /** 'running' | 'stopped' | 'error' | 'unknown' */
  @Column({ type: 'varchar', length: 16, name: 'claude_status', default: 'unknown' })
  claudeStatus!: string;

  /** 'running' | 'stopped' | 'error' | 'unknown' */
  @Column({ type: 'varchar', length: 16, name: 'terminal_status', default: 'unknown' })
  terminalStatus!: string;

  /** Resolved Claude CLI path */
  @Column({ type: 'varchar', nullable: true, length: 512, name: 'claude_path' })
  claudePath!: string | null;

  /** Process uptime in ms at time of report */
  @Column({ type: 'bigint', default: 0, name: 'uptime_ms' })
  uptimeMs!: number;

  /** When the desktop submitted this report (Unix ms) */
  @Column({ type: 'bigint', name: 'reported_at' })
  reportedAt!: number;

  /** When the server last received a report from this device */
  @Column({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}
