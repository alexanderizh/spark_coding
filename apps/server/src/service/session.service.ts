import { Provide, Inject } from '@midwayjs/decorator';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository, In, Not, IsNull } from 'typeorm';
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

    // ── Reuse existing paired session (stable UUID across restarts) ──────────
    // If this desktop has already paired with a mobile, reuse the same session row
    // so the session UUID never changes. Only rotate the token so clients with
    // stale tokens can still reconnect via the tokensJson array.
    if (opts.desktopDeviceId) {
      const existing = await this.sessionRepo.findOne({
        where: {
          desktopDeviceId: opts.desktopDeviceId,
          launchType,
          connectionKey: Not(IsNull()),
        },
        order: { lastActivityAt: 'DESC' },
      });

      if (existing) {
        const newToken  = randomBytes(32).toString('hex');
        const allTokens = existing.tokens;
        allTokens.push(newToken);
        // Keep at most the 20 most recent tokens to prevent unbounded growth
        const cappedTokens = allTokens.slice(-20);

        await this.sessionRepo.update(existing.id, {
          token:          newToken,         // rotate primary token
          tokensJson:     JSON.stringify(cappedTokens),
          state:          SessionState.WAITING_FOR_AGENT,
          agentSocketId:  null,             // reset — will be set on WS connect
          mobileSocketId: null,
          lastActivityAt: new Date(),
        });

        const reloaded  = await this.sessionRepo.findOne({ where: { id: existing.id } });
        const qrPayload = buildPairUrl(serverUrl, newToken, opts.desktopDeviceId);
        return { session: reloaded!, qrPayload };
      }
    }

    // ── First-time pairing: create a new session row ─────────────────────────
    const token    = randomBytes(32).toString('hex');
    const now      = new Date();
    const expiresAt = new Date(now.getTime() + UNPAIRED_TTL_HOURS * 60 * 60 * 1000);

    const session = this.sessionRepo.create({
      token,
      connectionKey:   null,
      tokensJson:      JSON.stringify([token]),
      desktopDeviceId: opts.desktopDeviceId ?? null,
      mobileDeviceId:  null,
      launchType,
      state:           SessionState.WAITING_FOR_AGENT,
      agentSocketId:   null,
      mobileSocketId:  null,
      agentPlatform:   null,
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

  async findByConnectionKey(connectionKey: string): Promise<Session | null> {
    return this.sessionRepo.findOne({ where: { connectionKey } });
  }

  /**
   * Find a session that contains the given token in its `tokens` array.
   * Used for token-based reconnection (no QR scan).
   */
  async findByAnyToken(token: string): Promise<Session | null> {
    // Check primary token column first (fast indexed lookup).
    // If found but expired (e.g. an old session orphaned by completePairing),
    // fall through — the token may also live in a valid session's tokensJson array.
    const byPrimary = await this.findByToken(token);
    if (byPrimary && !this.isExpired(byPrimary)) return byPrimary;

    // Scan tokensJson for a non-expired session containing this token.
    const rows = await this.sessionRepo
      .createQueryBuilder('s')
      .where('s.tokensJson LIKE :pat', { pat: `%${token}%` })
      .getMany();

    return rows.find(s => !this.isExpired(s) && s.tokens.includes(token)) ?? null;
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

  // ── Mutate ───────────────────────────────────────────────────────────────

  async updateState(
    sessionId: string,
    patch: Partial<Pick<Session,
      | 'state'
      | 'agentSocketId'
      | 'mobileSocketId'
      | 'agentPlatform'
      | 'agentHostname'
      | 'mobileDeviceId'
      | 'desktopDeviceId'
      | 'connectionKey'
      | 'tokensJson'
      | 'pairedAt'
      | 'expiresAt'
      | 'lastActivityAt'
    >>
  ): Promise<void> {
    await this.sessionRepo.update(sessionId, { ...patch, lastActivityAt: new Date() });
  }

  /**
   * Add a new token to the session's tokens array (after pairing).
   * Returns the updated tokens array.
   */
  async addToken(sessionId: string, newToken: string): Promise<string[]> {
    const session = await this.findById(sessionId);
    if (!session) return [];
    const tokens = session.tokens;
    if (!tokens.includes(newToken)) tokens.push(newToken);
    await this.sessionRepo.update(sessionId, { tokensJson: JSON.stringify(tokens) });
    return tokens;
  }

  /** Verify a token is valid for a session */
  isValidToken(session: Session, token: string): boolean {
    return session.token === token || session.tokens.includes(token);
  }

  /**
   * Complete pairing: assign connectionKey, persist mobile device ID,
   * remove expiry (paired sessions don't expire), add paired token.
   */
  async completePairing(sessionId: string, params: {
    desktopDeviceId: string;
    mobileDeviceId:  string;
    launchType:      string;
    pairedToken:     string;
  }): Promise<string> {
    const connectionKey = `${params.desktopDeviceId}_${params.mobileDeviceId}_${params.launchType}`;
    const session = await this.findById(sessionId);
    if (!session) return connectionKey;

    // Merge tokens from current session
    const tokens = session.tokens;
    if (!tokens.includes(params.pairedToken)) tokens.push(params.pairedToken);

    // If a previous session already holds this connectionKey, clear it first
    // (avoids UNIQUE constraint violation) and merge its tokens so existing
    // clients can still reconnect with their old tokens.
    // Also clear mobileDeviceId so it no longer appears in /api/sessions queries.
    const existing = await this.findByConnectionKey(connectionKey);
    if (existing && existing.id !== sessionId) {
      for (const t of existing.tokens) {
        if (!tokens.includes(t)) tokens.push(t);
      }
      await this.sessionRepo.update(existing.id, {
        connectionKey:  null,
        mobileDeviceId: null,   // orphan: exclude from future mobile queries
        state:          SessionState.EXPIRED,
      });
    }

    await this.sessionRepo.update(sessionId, {
      connectionKey,
      mobileDeviceId:  params.mobileDeviceId,
      desktopDeviceId: params.desktopDeviceId,
      tokensJson:      JSON.stringify(tokens),
      expiresAt:       null,          // paired sessions don't expire
      lastActivityAt:  new Date(),
    });
    return connectionKey;
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
    // Paired sessions (with connectionKey) never expire
    if (session.connectionKey) return session.state === SessionState.EXPIRED;
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
      .where('connection_key IS NULL AND expires_at IS NOT NULL AND expires_at < :cutoff', { cutoff })
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
            PARTITION BY COALESCE(s.connection_key, COALESCE(s.agent_hostname, s.agent_platform, '') || '|' || COALESCE(s.mobile_device_id, ''))
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
          PARTITION BY COALESCE(connection_key, COALESCE(agent_hostname, agent_platform, '') || '|' || COALESCE(mobile_device_id, ''))
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
