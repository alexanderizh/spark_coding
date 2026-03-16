import { Controller, Get, Post, Put, Del, Query, Body, Param, Inject } from '@midwayjs/decorator';
import { Context } from '@midwayjs/koa';
import { SessionService } from '../service/session.service';
import { VersionService, CreateVersionDto, UpdateVersionDto } from '../service/version.service';
import { AdminAuthMiddleware } from '../middleware/adminAuth.middleware';
import { SessionState } from '@spark_coder/shared';
import { VersionType } from '../entity/version.entity';

@Controller('/api/admin', { middleware: [AdminAuthMiddleware] })
export class AdminController {
  @Inject()
  ctx: Context;

  @Inject()
  sessionService: SessionService;

  @Inject()
  versionService: VersionService;

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

  /** Admin: list sessions (host-app bindings) with pagination, 默认按连接去重 */
  @Get('/sessions')
  async listSessions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('state') state?: SessionState,
    @Query('groupByConnection') groupByConnection?: string
  ) {
    const { sessions, total } = await this.sessionService.listSessions({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      state,
      groupByConnection: groupByConnection !== 'false',
    });

    const items = sessions.map(s => ({
      id: s.id,
      token: s.token,
      state: s.state,
      agentSocketId: s.agentSocketId,
      mobileSocketId: s.mobileSocketId,
      agentPlatform: s.agentPlatform,
      agentHostname: s.agentHostname,
      mobileDeviceId: s.mobileDeviceId,
      pairedAt: s.pairedAt?.getTime() ?? null,
      lastActivityAt: s.lastActivityAt.getTime(),
      expiresAt: s.expiresAt?.getTime() ?? null,
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

  // ── Version Management ─────────────────────────────────────────────────────

  @Get('/versions')
  async listVersions(
    @Query('type') type?: VersionType,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    const { items, total } = await this.versionService.list({
      type,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });

    return {
      success: true,
      data: {
        items: items.map(v => ({
          id: v.id,
          type: v.type,
          version: v.version,
          platform: v.platform,
          downloadUrl: v.downloadUrl,
          releaseNotes: v.releaseNotes,
          createdAt: v.createdAt.getTime(),
          updatedAt: v.updatedAt.getTime(),
        })),
        total,
      },
    };
  }

  @Post('/versions')
  async createVersion(@Body() body: CreateVersionDto) {
    const version = await this.versionService.create(body);
    return {
      success: true,
      data: {
        id: version.id,
        type: version.type,
        version: version.version,
        platform: version.platform,
        downloadUrl: version.downloadUrl,
        releaseNotes: version.releaseNotes,
        createdAt: version.createdAt.getTime(),
        updatedAt: version.updatedAt.getTime(),
      },
    };
  }

  @Put('/versions/:id')
  async updateVersion(
    @Param('id') id: string,
    @Body() body: UpdateVersionDto
  ) {
    const version = await this.versionService.update(id, body);
    if (!version) {
      return { success: false, error: 'Version not found' };
    }
    return {
      success: true,
      data: {
        id: version.id,
        type: version.type,
        version: version.version,
        platform: version.platform,
        downloadUrl: version.downloadUrl,
        releaseNotes: version.releaseNotes,
        createdAt: version.createdAt.getTime(),
        updatedAt: version.updatedAt.getTime(),
      },
    };
  }

  @Del('/versions/:id')
  async deleteVersion(@Param('id') id: string) {
    const deleted = await this.versionService.delete(id);
    if (!deleted) {
      return { success: false, error: 'Version not found' };
    }
    return { success: true };
  }
}
