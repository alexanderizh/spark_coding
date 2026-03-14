import { MidwayConfig } from '@midwayjs/core';
import { Session } from '../entity/session.entity';

export default {
  // Cookie signing keys (required by Midway Koa)
  keys: process.env.APP_KEYS?.split(',') ?? ['remote-claude-default-key'],

  // HTTP server
  koa: {
    port: parseInt(process.env.PORT ?? '7001', 10),
  },

  // Socket.IO
  socketIO: {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 64 * 1024, // 64 KB
  },

  // CORS for REST endpoints
  cors: {
    origin: '*',
    allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS',
  },

  // TypeORM / MySQL
  typeorm: {
    dataSource: {
      default: {
        type: 'mysql',
        host: process.env.DB_HOST ?? 'localhost',
        port: parseInt(process.env.DB_PORT ?? '3306', 10),
        username: process.env.DB_USER ?? 'root',
        password: process.env.DB_PASSWORD ?? '',
        database: process.env.DB_NAME ?? 'remote_claude',
        synchronize: process.env.NODE_ENV !== 'production',
        logging: process.env.NODE_ENV === 'local',
        timezone: '+00:00',
        entities: [Session],
      },
    },
  },
} as MidwayConfig;
