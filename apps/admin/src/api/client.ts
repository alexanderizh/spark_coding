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

// ── Version Management ─────────────────────────────────────────────────────

export type VersionType = 'app' | 'desktop';
export type VersionPlatform = 'android' | 'macos' | 'windows';

export interface VersionItem {
  id: string;
  type: VersionType;
  version: string;
  platform: VersionPlatform;
  downloadUrl: string;
  releaseNotes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface VersionsResponse {
  items: VersionItem[];
  total: number;
}

export interface CreateVersionParams {
  type: VersionType;
  version: string;
  platform: VersionPlatform;
  downloadUrl: string;
  releaseNotes?: string;
}

export interface UpdateVersionParams {
  version?: string;
  platform?: VersionPlatform;
  downloadUrl?: string;
  releaseNotes?: string;
}

async function fetchAdminWithBody<T>(
  path: string,
  credentials: { username: string; password: string },
  method: 'POST' | 'PUT' | 'DELETE',
  body?: object
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: getAuthHeader(credentials.username, credentials.password),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
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

export async function getVersions(
  credentials: { username: string; password: string },
  params?: { type?: VersionType; page?: number; limit?: number }
): Promise<{ success: boolean; data: VersionsResponse }> {
  const search = new URLSearchParams();
  if (params?.type) search.set('type', params.type);
  if (params?.page) search.set('page', String(params.page));
  if (params?.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return fetchAdmin(`/api/admin/versions${qs ? '?' + qs : ''}`, credentials);
}

export async function createVersion(
  credentials: { username: string; password: string },
  params: CreateVersionParams
): Promise<{ success: boolean; data: VersionItem }> {
  return fetchAdminWithBody('/api/admin/versions', credentials, 'POST', params);
}

export async function updateVersion(
  credentials: { username: string; password: string },
  id: string,
  params: UpdateVersionParams
): Promise<{ success: boolean; data: VersionItem }> {
  return fetchAdminWithBody(`/api/admin/versions/${id}`, credentials, 'PUT', params);
}

export async function deleteVersion(
  credentials: { username: string; password: string },
  id: string
): Promise<{ success: boolean }> {
  return fetchAdminWithBody(`/api/admin/versions/${id}`, credentials, 'DELETE');
}
