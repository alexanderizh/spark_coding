import { IMiddleware } from '@midwayjs/core';
import { Middleware } from '@midwayjs/decorator';
import { Context, NextFunction } from '@midwayjs/koa';

@Middleware()
export class AdminAuthMiddleware implements IMiddleware<Context, NextFunction> {
  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const username = process.env.ADMIN_USERNAME;
      const password = process.env.ADMIN_PASSWORD;

      if (!username || !password) {
        ctx.status = 503;
        ctx.body = { success: false, error: 'Admin not configured' };
        return;
      }

      const auth = ctx.get('authorization');
      if (!auth?.startsWith('Basic ')) {
        ctx.set('WWW-Authenticate', 'Basic realm="Admin"');
        ctx.status = 401;
        ctx.body = { success: false, error: 'Unauthorized' };
        return;
      }

      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const [user, pass] = decoded.split(':');
      if (user !== username || pass !== password) {
        ctx.set('WWW-Authenticate', 'Basic realm="Admin"');
        ctx.status = 401;
        ctx.body = { success: false, error: 'Invalid credentials' };
        return;
      }

      await next();
    };
  }

  static getName(): string {
    return 'adminAuth';
  }
}
