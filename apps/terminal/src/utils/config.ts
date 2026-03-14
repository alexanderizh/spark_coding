import { program } from 'commander';

export interface AgentConfig {
  serverUrl: string;
  claudePath: string;
  cwd: string;
  restoreToken: string | null;
  agentVersion: string;
}

export function loadConfig(): AgentConfig {
  program
    .name('remote-claude')
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
