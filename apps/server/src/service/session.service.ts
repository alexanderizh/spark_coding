import { Provide, Inject } from '@midwayjs/decorator';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Session } from '../entity/session.entity';
import { SessionState, buildPairUrl } from '@remote-claude/shared';

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
}
