import path from 'path';
import { config as loadDotenv } from 'dotenv';
import { program } from 'commander';

// 开发用 .env，打包/生产用 .prod.env
const isProd = process.env.NODE_ENV === 'production';
const envFile = isProd ? '.prod.env' : '.env';
const envPath = path.resolve(__dirname, '../..', envFile);
loadDotenv({ path: envPath });

export interface AgentConfig {
  serverUrl: string;
  claudePath: string;
  cwd: string;
  restoreToken: string | null;
  agentVersion: string;
}

export function loadConfig(): AgentConfig {
  program
    .name('spark')
    .description('Remote Claude CLI controller — exposes Claude to your mobile via QR pairing')
    .option('-s, --server-url <url>', 'Relay server URL', process.env.REMOTE_CLAUDE_SERVER ?? 'http://localhost:7001')
    .option('-c, --claude-path <path>', 'Path to claude executable', process.env.CLAUDE_PATH ?? 'claude')
    .option('-d, --cwd <dir>', 'Working directory for Claude', process.cwd())
    .option('-r, --restore-token <token>', 'Restore an existing session token')
    .parse(process.argv);

  const opts = program.opts<{
    serverUrl: string;
    claudePath: string;
    cwd: string;
    restoreToken?: string;
  }>();

  return {
    serverUrl: opts.serverUrl.replace(/\/$/, ''),
    claudePath: opts.claudePath,
    cwd: opts.cwd,
    restoreToken: opts.restoreToken ?? null,
    agentVersion: '1.0.0',
  };
}
