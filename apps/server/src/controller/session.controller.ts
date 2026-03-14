import { Controller, Get, Post, Param, Inject } from '@midwayjs/decorator';
import { Context } from '@midwayjs/koa';
import { SessionService } from '../service/session.service';
import { QrService } from '../service/qr.service';
import { SessionErrorCode } from '@spark_coder/shared';

@Controller('/api')
export class SessionController {
  @Inject()
  ctx: Context;

  @Inject()
  sessionService: SessionService;

  @Inject()
  qrService: QrService;

  /** Create a new session. Returns sessionId, token, and the QR payload URL. */
  @Post('/session')
  async createSession() {
    const serverUrl = this.resolveServerUrl();
    const { session, qrPayload } = await this.sessionService.createSession(serverUrl);
    return {
      success: true,
      data: {
        sessionId: session.id,
        token: session.token,
        qrPayload,
        state: session.state,
        expiresAt: session.expiresAt.getTime(),
      },
    };
  }

  /** Get session status by token. */
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
        sessionId: session.id,
        state: session.state,
        agentConnected: !!session.agentSocketId,
        mobileConnected: !!session.mobileSocketId,
        pairedAt: session.pairedAt?.getTime() ?? null,
        expiresAt: session.expiresAt.getTime(),
      },
    };
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
    const payload = buildPairUrl(serverUrl, token);
    const png = await this.qrService.toPng(payload);
    this.ctx.set('Content-Type', 'image/png');
    this.ctx.body = png;
  }

  private resolveServerUrl(): string {
    const host = this.ctx.request.headers['x-forwarded-host'] ?? this.ctx.host;
    const proto = this.ctx.request.headers['x-forwarded-proto'] ?? 'http';
    return `${proto}://${host}`;
  }
}
