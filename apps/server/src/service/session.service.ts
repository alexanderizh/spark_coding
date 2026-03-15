import { Provide, Inject } from '@midwayjs/decorator';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, In, Not, IsNull, Or } from 'typeorm';
import { randomBytes } from 'crypto';
import { Session } from '../entity/session.entity';
import { SessionState, buildPairUrl } from '@spark_coder/shared';

const UNPAIRED_TTL_HOURS = 24;  // unpaired sessions expire after 24h

@Provide()
export class SessionService {
  @InjectEntityModel(Session)
  sessionRepo: Repository<Session>;

  // ── Create ───────────────────────────────────────────────────────────────

  async createSession(serverUrl: string, opts: {
    desktopDeviceId?: string;
    launchType?: string;
  } = {}): Promise<{ session: Session; qrPayload: string }> {
    const launchType = opts.launchType ?? 'claude';

    // ── Create a new session row ─────────────────────────
    const token    = randomBytes(32).toString('hex');
    const now      = new Date();
    const expiresAt = new Date(now.getTime() + UNPAIRED_TTL_HOURS * 60 * 60 * 1000);

    const session = this.sessionRepo.create({
      token,
      desktopDeviceId: opts.desktopDeviceId ?? null,
      mobileDeviceId:  null,
      launchType,
      state:           SessionState.WAITING_FOR_AGENT,
      desktopStatus:   'offline',
      mobileStatus:    'offline',
      agentSocketId:   null,
      mobileSocketId:  null,
      agentPlatform:   null,
      mobilePlatform:  null,
      agentHostname:   null,
      pairedAt:        null,
      lastActivityAt:  now,
      expiresAt,
    });

    await this.sessionRepo.save(session);
    const qrPayload = buildPairUrl(serverUrl, token, opts.desktopDeviceId);
    return { session, qrPayload };
  }

  // ── Find ─────────────────────────────────────────────────────────────────

  async findByToken(token: string): Promise<Session | null> {
    return this.sessionRepo.findOne({ where: { token } });
  }

  async findById(id: string): Promise<Session | null> {
    return this.sessionRepo.findOne({ where: { id } });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sessionRepo.delete(sessionId);
  }

  /** List sessions where mobile device has connected before */
  async findByMobileDeviceId(mobileDeviceId: string): Promise<Session[]> {
    return this.sessionRepo.find({
      where: { mobileDeviceId },
      order: { lastActivityAt: 'DESC' },
    });
  }

  async findByDesktopDeviceId(desktopDeviceId: string): Promise<Session[]> {
    return this.sessionRepo.find({
      where: { desktopDeviceId },
      order: { lastActivityAt: 'DESC' },
    });
  }

  /**
   * Find sessions that have an active agent socket for the given desktop device IDs.
   * Used to surface newly-started desktop sessions that haven't been re-paired yet.
   */
  async findActiveByDesktopDeviceIds(ids: string[]): Promise<Session[]> {
    if (ids.length === 0) return [];
    return this.sessionRepo.find({
      where: {
        desktopDeviceId: In(ids),
        agentSocketId:   Not(IsNull()),
      },
      order: { lastActivityAt: 'DESC' },
    });
  }

  /**
   * Find all sessions associated with a device (either desktop or mobile).
   */
  async findByDeviceId(deviceId: string): Promise<Session[]> {
    return this.sessionRepo.find({
      where: [
        { desktopDeviceId: deviceId },
        { mobileDeviceId: deviceId },
      ],
      order: { lastActivityAt: 'DESC' },
    });
  }

  /**
   * Find session by device pair (for checking if session already exists).
   */
  async findByDevicePair(
    desktopDeviceId: string,
    mobileDeviceId: string
  ): Promise<Session | null> {
    return this.sessionRepo.findOne({
      where: { desktopDeviceId, mobileDeviceId },
      order: { lastActivityAt: 'DESC' },
    });
  }

  /**
   * Update device online status for a specific session.
   */
  async updateDeviceStatus(
    sessionId: string,
    device: 'desktop' | 'mobile',
    status: 'online' | 'offline',
    socketId?: string | null
  ): Promise<void> {
    const patch: Partial<Session> = device === 'desktop'
      ? { desktopStatus: status, agentSocketId: socketId ?? null }
      : { mobileStatus: status, mobileSocketId: socketId ?? null };
    await this.sessionRepo.update(sessionId, { ...patch, lastActivityAt: new Date() });
  }

  /**
   * Update device status for all sessions associated with a device.
   */
  async updateAllSessionsDeviceStatus(
    deviceId: string,
    device: 'desktop' | 'mobile',
    status: 'online' | 'offline',
    socketId?: string
  ): Promise<void> {
    const sessions = await this.findByDeviceId(deviceId);
    for (const session of sessions) {
      await this.updateDeviceStatus(session.id, device, status, socketId);
    }
  }

  // ── Mutate ───────────────────────────────────────────────────────────────

  async updateState(
    sessionId: string,
    patch: Partial<Pick<Session,
      | 'state'
      | 'agentSocketId'
      | 'mobileSocketId'
      | 'agentPlatform'
      | 'mobilePlatform'
      | 'agentHostname'
      | 'mobileDeviceId'
      | 'desktopDeviceId'
      | 'desktopStatus'
      | 'mobileStatus'
      | 'pairedAt'
      | 'expiresAt'
      | 'lastActivityAt'
    >>
  ): Promise<void> {
    await this.sessionRepo.update(sessionId, { ...patch, lastActivityAt: new Date() });
  }

  /**
   * Complete pairing: persist mobile device ID, remove expiry (paired sessions don't expire).
   */
  async completePairing(sessionId: string, params: {
    desktopDeviceId: string;
    mobileDeviceId:  string;
  }): Promise<void> {
    await this.sessionRepo.update(sessionId, {
      mobileDeviceId:  params.mobileDeviceId,
      desktopDeviceId: params.desktopDeviceId,
      expiresAt:       null,          // paired sessions don't expire
      lastActivityAt:  new Date(),
    });
  }

  async touchActivity(sessionId: string): Promise<void> {
    await this.sessionRepo.update(sessionId, { lastActivityAt: new Date() });
  }

  /**
   * Called on server startup: clears all stale socket IDs left over from the
   * previous process. After a restart every in-memory socket is gone, so any
   * non-null agentSocketId / mobileSocketId is invalid and would cause the
   * mobile to see a phantom "online" state.
   */
  async clearStaleSocketIds(): Promise<void> {
    await this.sessionRepo
      .createQueryBuilder()
      .update(Session)
      .set({ agentSocketId: null, mobileSocketId: null })
      .where('agentSocketId IS NOT NULL OR mobileSocketId IS NOT NULL')
      .execute();
  }

  async expireSession(sessionId: string): Promise<void> {
    await this.sessionRepo.update(sessionId, {
      state:           SessionState.EXPIRED,
      agentSocketId:   null,
      mobileSocketId:  null,
    });
  }

  isExpired(session: Session): boolean {
    // Paired sessions (with mobileDeviceId) never expire
    if (session.mobileDeviceId) return session.state === SessionState.EXPIRED;
    // Unpaired sessions expire after TTL
    return (session.expiresAt !== null && session.expiresAt < new Date())
      || session.state === SessionState.EXPIRED;
  }

  // ── Admin / housekeeping ──────────────────────────────────────────────────

  async cleanupExpired(): Promise<number> {
    // Only delete unpaired sessions expired >1h ago
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const result = await this.sessionRepo
      .createQueryBuilder()
      .delete()
      .where('mobile_device_id IS NULL AND expires_at IS NOT NULL AND expires_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  async listSessions(options: {
    page?: number;
    limit?: number;
    state?: SessionState;
    groupByConnection?: boolean;
  }): Promise<{ sessions: Session[]; total: number }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const skip = (page - 1) * limit;

    if (options.groupByConnection) {
      return this.listSessionsGroupedByConnection({ page, limit, skip, state: options.state });
    }

    const qb = this.sessionRepo
      .createQueryBuilder('s')
      .orderBy('s.last_activity_at', 'DESC');

    if (options.state) {
      qb.andWhere('s.state = :state', { state: options.state });
    }

    const [sessions, total] = await qb.skip(skip).take(limit).getManyAndCount();
    return { sessions, total };
  }

  private async listSessionsGroupedByConnection(options: {
    page: number;
    limit: number;
    skip: number;
    state?: SessionState;
  }): Promise<{ sessions: Session[]; total: number }> {
    const stateCond = options.state ? ' AND s.state = ?' : '';
    const idsParams: unknown[] = options.state
      ? [options.state, options.limit, options.skip]
      : [options.limit, options.skip];
    const countParams: unknown[] = options.state ? [options.state] : [];

    const idsSql = `
      WITH ranked AS (
        SELECT s.id, s.last_activity_at,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(s.desktop_device_id, '') || '|' || COALESCE(s.mobile_device_id, '')
            ORDER BY s.last_activity_at DESC
          ) AS rn
        FROM sessions s
        WHERE 1=1 ${stateCond}
      )
      SELECT id FROM ranked WHERE rn = 1
      ORDER BY last_activity_at DESC
      LIMIT ? OFFSET ?
    `;

    const countSql = `
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY COALESCE(desktop_device_id, '') || '|' || COALESCE(mobile_device_id, '')
          ORDER BY last_activity_at DESC
        ) AS rn
        FROM sessions
        WHERE 1=1 ${stateCond}
      )
      SELECT COUNT(*) AS cnt FROM ranked WHERE rn = 1
    `;

    const rawIds = await this.sessionRepo.query(idsSql, idsParams);
    const idList = rawIds.map((r: { id: string }) => r.id);

    const totalResult = await this.sessionRepo.query(countSql, countParams);
    const total = totalResult.length ? parseInt(totalResult[0].cnt, 10) : 0;

    if (idList.length === 0) {
      return { sessions: [], total };
    }

    const sessions = await this.sessionRepo
      .createQueryBuilder('s')
      .whereInIds(idList)
      .orderBy('s.last_activity_at', 'DESC')
      .getMany();

    return { sessions, total };
  }

  async getStats(): Promise<Record<string, number>> {
    const rows = await this.sessionRepo
      .createQueryBuilder('s')
      .select('s.state', 'state')
      .addSelect('COUNT(*)', 'count')
      .groupBy('s.state')
      .getRawMany<{ state: string; count: string }>();

    const stats: Record<string, number> = {};
    for (const r of rows) {
      stats[r.state] = parseInt(r.count, 10);
    }
    return stats;
  }
}
