import fs from 'fs';
import path from 'path';
import os from 'os';

const SPARK_DIR = path.join(os.homedir(), '.spark');
const SESSION_FILE = path.join(SPARK_DIR, 'session.json');

export interface StoredSession {
  token: string;
  sessionId: string;
  expiresAt: number;
  serverUrl: string;
}

export function loadSession(serverUrl: string): StoredSession | null {
  try {
    const raw = fs.readFileSync(SESSION_FILE, 'utf8');
    const data = JSON.parse(raw) as StoredSession;
    if (
      typeof data.token !== 'string' ||
      typeof data.sessionId !== 'string' ||
      typeof data.expiresAt !== 'number' ||
      typeof data.serverUrl !== 'string'
    ) return null;
    if (data.serverUrl !== serverUrl) return null;
    if (Date.now() >= data.expiresAt - 60_000) return null; // 60s buffer
    return data;
  } catch { return null; }
}

export function saveSession(data: StoredSession): void {
  try {
    fs.mkdirSync(SPARK_DIR, { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* 非致命 */ }
}
