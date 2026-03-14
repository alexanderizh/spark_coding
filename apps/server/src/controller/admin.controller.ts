import { Controller, Get, Query, Inject } from '@midwayjs/decorator';
import { Context } from '@midwayjs/koa';
import { SessionService } from '../service/session.service';
import { AdminAuthMiddleware } from '../middleware/adminAuth.middleware';
import { SessionState } from '@remote-claude/shared';

@Controller('/api/admin', { middleware: [AdminAuthMiddleware] })
export class AdminController {
  @Inject()
  ctx: Context;

  @Inject()
  sessionService: SessionService;

  /** Admin stats: session counts by state */
  @Get('/stats')
  async getStats() {
    const stats = await this.sessionService.getStats();
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    const active =
      (stats[SessionState.PAIRED] ?? 0) +
      (stats[SessionState.WAITING_FOR_AGENT] ?? 0) +
      (stats[SessionState.WAITING_FOR_MOBILE] ?? 0);
    const closed =
      (stats[SessionState.EXPIRED] ?? 0) +
      (stats[SessionState.AGENT_DISCONNECTED] ?? 0) +
      (stats[SessionState.MOBILE_DISCONNECTED] ?? 0) +
      (stats[SessionState.ERROR] ?? 0);

    return {
      success: true,
      data: {
        total,
        active,
        closed,
        byState: stats,
      },
    };
  }

  /** Admin: list sessions (host-app bindings) with pagination */
  @Get('/sessions')
  async listSessions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('state') state?: SessionState
  ) {
    const { sessions, total } = await this.sessionService.listSessions({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      state,
    });

    const items = sessions.map(s => ({
      id: s.id,
      token: s.token,
      state: s.state,
      agentSocketId: s.agentSocketId,
      mobileSocketId: s.mobileSocketId,
      agentPlatform: s.agentPlatform,
      mobileDeviceId: s.mobileDeviceId,
      pairedAt: s.pairedAt?.getTime() ?? null,
      lastActivityAt: s.lastActivityAt.getTime(),
      expiresAt: s.expiresAt.getTime(),
      createdAt: s.createdAt.getTime(),
    }));

    return {
      success: true,
      data: {
        items,
        total,
      },
    };
  }
}
