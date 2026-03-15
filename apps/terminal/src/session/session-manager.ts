import axios from 'axios';
import { buildPairUrl } from '@spark_coder/shared';
import { AgentConfig } from '../utils/config';
import { loadSession, saveSession } from './session-store';

export interface RemoteSession {
  sessionId: string;
  token: string;
  qrPayload: string;
  expiresAt: number;
}

export async function createSession(config: AgentConfig): Promise<RemoteSession> {
  const res = await axios.post<{ success: boolean; data: RemoteSession }>(
    `${config.serverUrl}/api/session`,
    {},
    { timeout: 10_000 }
  );
  if (!res.data.success) throw new Error('Server returned failure on session create');
  return res.data.data;
}

export async function getOrCreateSession(config: AgentConfig): Promise<RemoteSession> {
  const stored = loadSession(config.serverUrl);
  if (stored) {
    try {
      const res = await axios.get<{ success: boolean; data?: { sessionId: string; expiresAt: number } }>(
        `${config.serverUrl}/api/session/${stored.token}`,
        { timeout: 10_000 }
      );
      if (res.data.success && res.data.data) {
        const { sessionId, expiresAt } = res.data.data;
        const qrPayload = buildPairUrl(config.serverUrl, stored.token);
        console.log('[spark] 已恢复现有会话，token 保持不变');
        return { sessionId, token: stored.token, qrPayload, expiresAt };
      }
    } catch {
      console.log('[spark] 无法验证已存储的会话，将创建新会话');
    }
  }
  const session = await createSession(config);
  saveSession({ token: session.token, sessionId: session.sessionId, expiresAt: session.expiresAt, serverUrl: config.serverUrl });
  return session;
}
