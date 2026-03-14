import { Configuration, App } from '@midwayjs/decorator';
import { ILifeCycle } from '@midwayjs/core';
import * as koa from '@midwayjs/koa';
import * as socketio from '@midwayjs/socketio';
import * as orm from '@midwayjs/typeorm';
import * as validate from '@midwayjs/validate';
import { join } from 'path';
import { mkdirSync } from 'fs';

@Configuration({
  imports: [koa, socketio, orm, validate],
  importConfigs: [join(__dirname, 'config')],
})
export class ContainerLifeCycle implements ILifeCycle {
  @App()
  app: koa.Application;

  async onReady() {
    // Ensure data directory exists
    const dataDir = join(process.cwd(), 'data');
    mkdirSync(dataDir, { recursive: true });

    // CORS middleware for REST endpoints
    this.app.use(async (ctx, next) => {
      ctx.set('Access-Control-Allow-Origin', '*');
      ctx.set('Access-Control-Allow-Methods', 'GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS');
      ctx.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      if (ctx.method === 'OPTIONS') {
        ctx.status = 204;
        return;
      }
      await next();
    });

    console.log('[remote-claude] Server ready');
  }
}
