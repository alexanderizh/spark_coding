import { Provide, Inject } from '@midwayjs/decorator';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Session } from '../entity/session.entity';
import { SessionState, buildPairUrl } from '@spark_coder/shared';

const SESSION_TTL_HOURS = 24;

@Provide()
export class SessionService {
  @InjectEntityModel(Session)
  sessionRepo: Repository<Session>;

  async createSession(serverUrl: string): Promise<{
    session: Session;
    qrPayload: string;
  }> {
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000);

    const session = this.sessionRepo.create({
      token,
      state: SessionState.WAITING_FOR_AGENT,
      agentSocketId: null,
      mobileSocketId: null,
      agentPlatform: null,
      agentHostname: null,
      mobileDeviceId: null,
      pairedAt: null,
      lastActivityAt: now,
      expiresAt,
    });

    await this.sessionRepo.save(session);
    const qrPayload = buildPairUrl(serverUrl, token);
    return { session, qrPayload };
  }

  async findByToken(token: string): Promise<Session | null> {
    return this.sessionRepo.findOne({ where: { token } });
  }

  async findById(id: string): Promise<Session | null> {
    return this.sessionRepo.findOne({ where: { id } });
  }

  async updateState(
    sessionId: string,
    patch: Partial<Pick<Session,
      | 'state'
      | 'agentSocketId'
      | 'mobileSocketId'
      | 'agentPlatform'
      | 'agentHostname'
      | 'mobileDeviceId'
      | 'pairedAt'
      | 'lastActivityAt'
    >>
  ): Promise<void> {
    await this.sessionRepo.update(sessionId, { ...patch, lastActivityAt: new Date() });
  }

  async touchActivity(sessionId: string): Promise<void> {
    await this.sessionRepo.update(sessionId, { lastActivityAt: new Date() });
  }

  async expireSession(sessionId: string): Promise<void> {
    await this.sessionRepo.update(sessionId, {
      state: SessionState.EXPIRED,
      agentSocketId: null,
      mobileSocketId: null,
    });
  }

  isExpired(session: Session): boolean {
    return session.expiresAt < new Date() || session.state === SessionState.EXPIRED;
  }

  /** Cleanup sessions expired more than 1 hour ago — run periodically */
  async cleanupExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const result = await this.sessionRepo
      .createQueryBuilder()
      .delete()
      .where('expires_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  /** Admin: list sessions with pagination and optional state filter */
  async listSessions(options: {
    page?: number;
    limit?: number;
    state?: SessionState;
  }): Promise<{ sessions: Session[]; total: number }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const skip = (page - 1) * limit;

    const qb = this.sessionRepo
      .createQueryBuilder('s')
      .orderBy('s.last_activity_at', 'DESC');

    if (options.state) {
      qb.andWhere('s.state = :state', { state: options.state });
    }

    const [sessions, total] = await qb.skip(skip).take(limit).getManyAndCount();
    return { sessions, total };
  }

  /** Admin: get session counts by state */
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
