export interface AdminStats {
  total: number;
  active: number;
  closed: number;
  byState: Record<string, number>;
}

export interface SessionItem {
  id: string;
  token: string;
  state: string;
  agentSocketId: string | null;
  mobileSocketId: string | null;
  agentPlatform: string | null;
  agentHostname: string | null;
  mobileDeviceId: string | null;
  pairedAt: number | null;
  lastActivityAt: number;
  expiresAt: number;
  createdAt: number;
}

/** 连接标识：主机+手机+claude，用于展示与去重 */
export function connectionLink(item: SessionItem): string {
  const agent = item.agentHostname || item.agentPlatform || '—';
  const mobile = item.mobileDeviceId || '—';
  return `${agent}|${mobile}|claude`;
}

export interface SessionsResponse {
  items: SessionItem[];
  total: number;
}

function getAuthHeader(username: string, password: string): string {
  return 'Basic ' + btoa(`${username}:${password}`);
}

export async function fetchAdmin<T>(
  path: string,
  credentials: { username: string; password: string }
): Promise<T> {
  const res = await fetch(path, {
    headers: {
      Authorization: getAuthHeader(credentials.username, credentials.password),
    },
  });
  if (res.status === 401) {
    throw new Error('UNAUTHORIZED');
  }
  if (res.status === 503) {
    throw new Error('ADMIN_NOT_CONFIGURED');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getStats(
  credentials: { username: string; password: string }
): Promise<{ success: boolean; data: AdminStats }> {
  return fetchAdmin('/api/admin/stats', credentials);
}

export async function getSessions(
  credentials: { username: string; password: string },
  params?: { page?: number; limit?: number; state?: string }
): Promise<{ success: boolean; data: SessionsResponse }> {
  const search = new URLSearchParams();
  if (params?.page) search.set('page', String(params.page));
  if (params?.limit) search.set('limit', String(params.limit));
  if (params?.state) search.set('state', params.state);
  const qs = search.toString();
  return fetchAdmin(`/api/admin/sessions${qs ? '?' + qs : ''}`, credentials);
}
