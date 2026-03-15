import { Provide } from '@midwayjs/decorator';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from '../entity/device.entity';
import { DesktopStatus } from '../entity/desktop-status.entity';
import { DesktopStatusReport, DesktopStatusSnapshot } from '@spark_coder/shared';

@Provide()
export class DeviceService {
  @InjectEntityModel(Device)
  deviceRepo: Repository<Device>;

  @InjectEntityModel(DesktopStatus)
  statusRepo: Repository<DesktopStatus>;

  // ── Device registration ──────────────────────────────────────────────────

  async upsertDevice(params: {
    id: string;
    platform: 'desktop' | 'mobile';
    hostname?: string | null;
    name?: string | null;
  }): Promise<Device> {
    const existing = await this.deviceRepo.findOne({ where: { id: params.id } });
    const now = new Date();

    if (existing) {
      existing.lastSeenAt = now;
      if (params.hostname !== undefined) existing.hostname = params.hostname ?? null;
      if (params.name !== undefined) existing.name = params.name ?? null;
      return this.deviceRepo.save(existing);
    }

    const device = this.deviceRepo.create({
      id: params.id,
      platform: params.platform,
      hostname: params.hostname ?? null,
      name: params.name ?? null,
      lastSeenAt: now,
    });
    return this.deviceRepo.save(device);
  }

  async touchDevice(deviceId: string): Promise<void> {
    await this.deviceRepo.update(deviceId, { lastSeenAt: new Date() });
  }

  // ── Desktop status ────────────────────────────────────────────────────────

  /** Desktop reports every 60 s; treat anything older than 90 s as stale. */
  private isStale(row: DesktopStatus): boolean {
    return Date.now() - row.updatedAt.getTime() > 90_000;
  }

  async upsertDesktopStatus(report: DesktopStatusReport): Promise<void> {
    const row: Partial<DesktopStatus> = {
      deviceId:      report.deviceId,
      hostname:      report.hostname,
      platform:      report.platform,
      appVersion:    report.appVersion ?? null,
      overallStatus: report.overallStatus,
      claudeStatus:  report.claudeStatus,
      terminalStatus: report.terminalStatus,
      claudePath:    report.claudePath ?? null,
      uptimeMs:      report.uptimeMs,
      reportedAt:    report.reportedAt,
      updatedAt:     new Date(),
    };

    // Upsert: insert or update on duplicate primary key
    await this.statusRepo.save(row as DesktopStatus);

    // Also touch the device record
    await this.upsertDevice({
      id:       report.deviceId,
      platform: 'desktop',
      hostname: report.hostname,
    });
  }

  async getDesktopStatus(deviceId: string): Promise<DesktopStatusSnapshot | null> {
    const row = await this.statusRepo.findOne({ where: { deviceId } });
    if (!row) return null;
    return {
      deviceId:      row.deviceId,
      hostname:      row.hostname,
      platform:      row.platform,
      appVersion:    row.appVersion ?? '',
      overallStatus: this.isStale(row) ? 'offline' : row.overallStatus as DesktopStatusSnapshot['overallStatus'],
      claudeStatus:  row.claudeStatus  as DesktopStatusSnapshot['claudeStatus'],
      terminalStatus: row.terminalStatus as DesktopStatusSnapshot['terminalStatus'],
      claudePath:    row.claudePath ?? '',
      uptimeMs:      Number(row.uptimeMs),
      reportedAt:    Number(row.reportedAt),
      updatedAt:     row.updatedAt.getTime(),
    };
  }

  async markDesktopOffline(deviceId: string): Promise<void> {
    await this.statusRepo.update(deviceId, {
      overallStatus: 'offline',
      updatedAt:     new Date(),
    });
  }

  async listDesktopStatuses(deviceIds: string[]): Promise<DesktopStatusSnapshot[]> {
    if (deviceIds.length === 0) return [];
    const rows = await this.statusRepo
      .createQueryBuilder('ds')
      .whereInIds(deviceIds)
      .getMany();
    return rows.map(row => ({
      deviceId:      row.deviceId,
      hostname:      row.hostname,
      platform:      row.platform,
      appVersion:    row.appVersion ?? '',
      overallStatus: this.isStale(row) ? 'offline' : row.overallStatus as DesktopStatusSnapshot['overallStatus'],
      claudeStatus:  row.claudeStatus  as DesktopStatusSnapshot['claudeStatus'],
      terminalStatus: row.terminalStatus as DesktopStatusSnapshot['terminalStatus'],
      claudePath:    row.claudePath ?? '',
      uptimeMs:      Number(row.uptimeMs),
      reportedAt:    Number(row.reportedAt),
      updatedAt:     row.updatedAt.getTime(),
    }));
  }
}
