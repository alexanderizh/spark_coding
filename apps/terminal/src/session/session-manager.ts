import axios from 'axios';
import { AgentConfig } from '../utils/config';

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
