import { Controller, Get, Post, Del, Query, Param, Body, Inject, App } from '@midwayjs/decorator';
import { Context } from '@midwayjs/koa';
import { Application } from '@midwayjs/socketio';
import { SessionService } from '../service/session.service';
import { DeviceService } from '../service/device.service';
import { QrService } from '../service/qr.service';
import { VersionService } from '../service/version.service';
import { SessionErrorCode, Events, SessionDeletedPayload } from '@spark_coder/shared';
import type { VersionPlatform } from '../entity/version.entity';

@Controller('/api')
export class SessionController {
  @Inject()
  ctx: Context;

  @App('socketIO')
  socketApp: Application;

  @Inject()
  sessionService: SessionService;

  @Inject()
  deviceService: DeviceService;

  @Inject()
  qrService: QrService;

  @Inject()
  versionService: VersionService;

  /** Public endpoint — no auth required. Returns the latest version for a given platform. */
  @Get('/version/latest')
  async getLatestVersion(@Query('platform') platform: string) {
    const validPlatforms = ['android', 'macos', 'windows'];
    if (!platform || !validPlatforms.includes(platform)) {
      this.ctx.status = 400;
      return { success: false, error: 'platform query param required (android|macos|windows)' };
    }
    const version = await this.versionService.getLatest(platform as VersionPlatform);
    return {
      success: true,
      data: version
        ? { version: version.version, downloadUrl: version.downloadUrl, releaseNotes: version.releaseNotes ?? null }
        : null,
    };
  }

  /**
   * Create a new session (called by Desktop on startup).
   * If desktopDeviceId is provided, it's embedded into the QR URL.
   */
  @Post('/session')
  async createSession(@Body() body: { desktopDeviceId?: string; launchType?: string } = {}) {
    const serverUrl = this.resolveServerUrl();
    const { session, qrPayload } = await this.sessionService.createSession(serverUrl, {
      desktopDeviceId: body.desktopDeviceId,
      launchType:      body.launchType ?? 'claude',
    });

    // Register/touch the desktop device record
    if (body.desktopDeviceId) {
      await this.deviceService.upsertDevice({
        id:       body.desktopDeviceId,
        platform: 'desktop',
      });
    }

    return {
      success: true,
      data: {
        sessionId: session.id,
        token:     session.token,
        qrPayload,
        state:     session.state,
        expiresAt: session.expiresAt?.getTime() ?? null,
      },
    };
  }

  /** Get session status by token (supports token array — any valid token works). */
  @Get('/session/:token')
  async getSession(@Param('token') token: string) {
    const session = await this.sessionService.findByToken(token);
    if (!session) {
      this.ctx.status = 404;
      return { success: false, error: { code: SessionErrorCode.SESSION_NOT_FOUND } };
    }
    if (this.sessionService.isExpired(session)) {
      this.ctx.status = 410;
      return { success: false, error: { code: SessionErrorCode.SESSION_EXPIRED } };
    }
    return {
      success: true,
      data: {
        sessionId:       session.id,
        state:           session.state,
        agentConnected:  !!session.agentSocketId,
        mobileConnected: !!session.mobileSocketId,
        agentHostname:   session.agentHostname ?? null,
        agentPlatform:   session.agentPlatform ?? null,
        mobilePlatform:  session.mobilePlatform ?? null,
        desktopDeviceId: session.desktopDeviceId ?? null,
        mobileDeviceId:  session.mobileDeviceId ?? null,
        desktopStatus:   session.desktopStatus,
        mobileStatus:    session.mobileStatus,
        launchType:      session.launchType,
        pairedAt:        session.pairedAt?.getTime() ?? null,
        expiresAt:       session.expiresAt?.getTime() ?? null,
      },
    };
  }

  /**
   * List sessions relevant to the given mobile device.
   * Returns only sessions associated with the given mobileDeviceId.
   */
  @Get('/sessions')
  async listSessions(@Query('mobileDeviceId') mobileDeviceId: string) {
    if (!mobileDeviceId) {
      this.ctx.status = 400;
      return { success: false, error: 'mobileDeviceId query param required' };
    }

    const sessions = await this.sessionService.findByMobileDeviceId(mobileDeviceId);
    const data = await this.buildSessionListData(sessions);
    return { success: true, data };
  }

  @Get('/sessions/desktop')
  async listDesktopSessions(@Query('desktopDeviceId') desktopDeviceId: string) {
    if (!desktopDeviceId) {
      this.ctx.status = 400;
      return { success: false, error: 'desktopDeviceId query param required' };
    }

    const sessions = await this.sessionService.findByDesktopDeviceId(desktopDeviceId);
    const data = await this.buildSessionListData(sessions);
    return { success: true, data };
  }

  /**
   * Get desktop status by device fingerprint.
   * Mobile uses this to poll desktop health without an active session.
   */
  @Get('/device/:deviceId/status')
  async getDesktopStatus(@Param('deviceId') deviceId: string) {
    const status = await this.deviceService.getDesktopStatus(deviceId);
    if (!status) {
      this.ctx.status = 404;
      return { success: false, error: 'Device status not found' };
    }
    return { success: true, data: status };
  }

  /**
   * Desktop reports its health status via REST.
   * Server caches and broadcasts to any connected mobile in same session.
   */
  @Post('/device/status')
  async reportDesktopStatus(@Body() body: {
    deviceId:       string;
    hostname:       string;
    platform:       string;
    appVersion?:    string;
    overallStatus:  string;
    claudeStatus:   string;
    terminalStatus: string;
    claudePath?:    string;
    uptimeMs?:      number;
    reportedAt?:    number;
  }) {
    if (!body.deviceId) {
      this.ctx.status = 400;
      return { success: false, error: 'deviceId required' };
    }
    await this.deviceService.upsertDesktopStatus({
      deviceId:       body.deviceId,
      hostname:       body.hostname ?? '',
      platform:       body.platform ?? '',
      appVersion:     body.appVersion ?? '',
      overallStatus:  body.overallStatus as 'healthy' | 'degraded' | 'offline',
      claudeStatus:   body.claudeStatus  as 'running' | 'stopped' | 'error' | 'unknown',
      terminalStatus: body.terminalStatus as 'running' | 'stopped' | 'error' | 'unknown',
      claudePath:     body.claudePath ?? '',
      uptimeMs:       body.uptimeMs ?? 0,
      reportedAt:     body.reportedAt ?? Date.now(),
    });
    return { success: true };
  }

  /** Return a PNG QR code image for the pairing URL. */
  @Get('/session/:token/qr.png')
  async getQrPng(@Param('token') token: string) {
    const session = await this.sessionService.findByToken(token);
    if (!session || this.sessionService.isExpired(session)) {
      this.ctx.status = 404;
      return;
    }
    const serverUrl = this.resolveServerUrl();
    const { buildPairUrl } = await import('@spark_coder/shared');
    const payload = buildPairUrl(serverUrl, token, session.desktopDeviceId ?? undefined);
    const png = await this.qrService.toPng(payload);
    this.ctx.set('Content-Type', 'image/png');
    this.ctx.body = png;
  }

  /**
   * Delete a session by ID. Notifies all connected clients in the session room,
   * then removes the record from the database.
   */
  @Del('/session/:sessionId')
  async deleteSession(@Param('sessionId') sessionId: string) {
    const session = await this.sessionService.findById(sessionId);
    if (!session) {
      this.ctx.status = 404;
      return { success: false, error: 'Session not found' };
    }

    // Notify all connected clients before deleting
    const payload: SessionDeletedPayload = {
      sessionId: session.id,
    };
    this.socketApp.to(session.id).emit(Events.SESSION_DELETED, payload);

    await this.sessionService.deleteSession(sessionId);
    return { success: true };
  }

  private resolveServerUrl(): string {
    const host = this.ctx.request.headers['x-forwarded-host'] ?? this.ctx.host;
    const proto = this.ctx.request.headers['x-forwarded-proto'] ?? 'http';
    return `${proto}://${host}`;
  }

  private async buildSessionListData(sessions: Awaited<ReturnType<SessionService['findByMobileDeviceId']>>) {
    const desktopIds = [...new Set(
      sessions.map(s => s.desktopDeviceId).filter(Boolean) as string[]
    )];
    const statuses = await this.deviceService.listDesktopStatuses(desktopIds);
    const statusMap = new Map(statuses.map(s => [s.deviceId, s]));

    return sessions.map(s => ({
      sessionId:       s.id,
      token:           s.token,
      state:           s.state,
      agentConnected:  !!s.agentSocketId,
      mobileConnected: !!s.mobileSocketId,
      agentHostname:   s.agentHostname ?? null,
      agentPlatform:   s.agentPlatform ?? null,
      mobilePlatform:  s.mobilePlatform ?? null,
      desktopDeviceId: s.desktopDeviceId ?? null,
      mobileDeviceId:  s.mobileDeviceId ?? null,
      desktopStatus:   s.desktopStatus,
      mobileStatus:    s.mobileStatus,
      launchType:      s.launchType,
      pairedAt:        s.pairedAt?.getTime() ?? null,
      lastActiveAt:    s.lastActivityAt.getTime(),
      deviceStatus:    s.desktopDeviceId ? (statusMap.get(s.desktopDeviceId) ?? null) : null,
    }));
  }
}
