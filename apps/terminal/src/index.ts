import { loadConfig } from './utils/config';
import { createSession } from './session/session-manager';
import { displayQr } from './session/qr-display';
import { AgentSocketClient } from './socket/socket-client';

async function main(): Promise<void> {
  const config = loadConfig();

  console.log(`[spark] Connecting to server: ${config.serverUrl}`);

  let session;
  try {
    session = await createSession(config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[error] Could not reach server at ${config.serverUrl}: ${msg}`);
    console.error('  Is the server running? Start it with: yarn dev:server');
    process.exit(1);
  }

  displayQr(session.qrPayload, config.serverUrl, session.token);

  const client = new AgentSocketClient({
    serverUrl: config.serverUrl,
    token: session.token,
    sessionId: session.sessionId,
    config,
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[spark] Shutting down…');
    client.destroy();
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
}

main();
