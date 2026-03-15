import { loadConfig } from './utils/config';
import { getOrCreateSession } from './session/session-manager';
import { displayQr } from './session/qr-display';
import { AgentSocketClient } from './socket/socket-client';
import { runStartupChecks } from './startup/startup-check';

async function main(): Promise<void> {
  const config = loadConfig();

  console.log(`[spark] 正在检查运行环境...`);
  const checks = await runStartupChecks(config);
  console.log(`[检查] Claude CLI: ${checks.claudeCli.ok ? '✅' : '❌'} ${checks.claudeCli.message}`);
  console.log(`[检查] 服务端: ${checks.server.ok ? '✅' : '❌'} ${checks.server.message}`);

  if (!checks.claudeCli.ok) {
    console.error('[error] 请先安装 Claude CLI，或通过 --claude-path 指定可执行文件路径');
    process.exit(1);
  }

  if (!checks.server.ok) {
    console.error(`[error] 服务端未启动或不可用：${config.serverUrl}`);
    console.error('  请先启动服务端：yarn dev:server');
    process.exit(1);
  }

  console.log(`[spark] 环境检查通过，正在连接服务端：${config.serverUrl}`);

  let session;
  try {
    session = await getOrCreateSession(config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[error] 创建会话失败：${msg}`);
    console.error(`  服务端地址：${config.serverUrl}`);
    console.error('  请确认服务端已启动：yarn dev:server');
    process.exit(1);
  }

  displayQr(session.qrPayload, config.serverUrl, session.token);

  const client = new AgentSocketClient({
    serverUrl: config.serverUrl,
    token: session.token,
    sessionId: session.sessionId,
    config,
  });

  const shutdown = () => {
    console.log('\n[spark] 正在退出...');
    client.destroy();
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
}

main();
