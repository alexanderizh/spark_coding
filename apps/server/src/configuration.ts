import { Configuration } from '@midwayjs/decorator';
import { ILifeCycle, IMidwayContainer, MidwayFrameworkService } from '@midwayjs/core';
import * as koa from '@midwayjs/koa';
import * as socketio from '@midwayjs/socketio';
import * as orm from '@midwayjs/typeorm';
import * as validate from '@midwayjs/validate';
import { join } from 'path';
import { TypeORMDataSourceManager } from '@midwayjs/typeorm';

@Configuration({
  imports: [koa, socketio, orm, validate],
  importConfigs: [join(__dirname, 'config')],
})
export class ContainerLifeCycle implements ILifeCycle {
  async onReady(container: IMidwayContainer) {
    // Get the Koa app via MidwayFrameworkService to avoid @App() property
    // injection timing issues on Linux/Docker (framework init order differs from macOS).
    const frameworkService = await container.getAsync(MidwayFrameworkService);
    const app = frameworkService.getMainApp() as koa.Application;

    // CORS middleware for REST endpoints
    app.use(async (ctx, next) => {
      ctx.set('Access-Control-Allow-Origin', '*');
      ctx.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS');
      ctx.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      if (ctx.method === 'OPTIONS') {
        ctx.status = 204;
        return;
      }
      await next();
    });

    // Clear stale socket IDs left from previous server process.
    // After restart every WebSocket is gone; non-null IDs would cause mobile
    // to see a phantom "online" state for disconnected desktops.
    try {
      const dsm = await container.getAsync(TypeORMDataSourceManager);
      const ds = dsm.getDataSource('default');
      await ds.query(
        `UPDATE sessions SET agent_socket_id = NULL, mobile_socket_id = NULL
         WHERE agent_socket_id IS NOT NULL OR mobile_socket_id IS NOT NULL`,
      );
    } catch (err) {
      console.warn('[spark_coder] clearStaleSocketIds failed:', err);
    }

    console.log('[spark_coder] Server ready');
  }
}
