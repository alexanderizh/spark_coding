import { MidwayConfig } from '@midwayjs/core';
import { join } from 'path';
import { Session } from '../entity/session.entity';

export default {
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

  // TypeORM / SQLite
  typeorm: {
    dataSource: {
      default: {
        type: 'better-sqlite3',
        database: process.env.DB_PATH ?? join(process.cwd(), 'data', 'remote-claude.db'),
        synchronize: true,
        logging: process.env.NODE_ENV === 'local',
        entities: [Session],
      },
    },
  },
} as MidwayConfig;
