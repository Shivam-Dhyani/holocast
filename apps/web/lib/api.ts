/** Same-origin API client (Caddy serves /api and / under one origin; TDD §3.3). */

export interface StorageStatus {
  status: 'NONE' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  channelTitle: string | null;
  deepLink: string;
  botUsername: string;
}

export interface PublicUser {
  id: string;
  telegramUserId: string;
  firstName: string;
  lastName?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  publicId: string;
}

export interface MeResponse {
  user: PublicUser;
  storageStatus: { status: StorageStatus['status']; channelTitle: string | null };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    const err = new Error(body.message ?? `request failed (${res.status})`);
    (err as Error & { code?: string; status?: number }).code = body.code;
    (err as Error & { code?: string; status?: number }).status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const loginWithTelegram = (payload: Record<string, unknown>): Promise<MeResponse> =>
  apiFetch('/api/auth/telegram', { method: 'POST', body: JSON.stringify(payload) });

export const getMe = (): Promise<MeResponse> => apiFetch('/api/me');

export const getStorage = (): Promise<StorageStatus> => apiFetch('/api/storage');

export const disconnectStorage = (): Promise<StorageStatus> =>
  apiFetch('/api/storage/disconnect', { method: 'POST' });

export const logout = (): Promise<void> => apiFetch('/api/auth/logout', { method: 'POST' });

export interface LabTest {
  id: string;
  name: string;
  runner: 'SERVER' | 'BROWSER' | 'CLI' | 'MANUAL' | 'AUTOTEST';
  thresholdText: string;
  serverRunnable: boolean;
  latestStatus: 'PASS' | 'FAIL' | 'BLOCKED' | 'INFO' | 'NOT_RUN' | 'RUNNING';
  latestMetrics: Record<string, unknown> | null;
  notes: string | null;
  runCount: number;
  lastRunAt: string | null;
}

export type LinkType = 'PUBLIC' | 'UNLISTED' | 'PASSWORD' | 'PRIVATE';

export interface CreateVideoResponse {
  videoId: string;
  shareUrl: string;
  uploadToken: string;
  segmentTargetSeconds: number;
  bitrateBps: number;
}

export const createVideo = (body: {
  title?: string;
  visibility: LinkType;
  password?: string;
  bitrateBps?: number;
}): Promise<CreateVideoResponse> =>
  apiFetch('/api/videos', { method: 'POST', body: JSON.stringify(body) });

export const finalizeVideo = (
  videoId: string,
  uploadToken: string,
  body: { expectedSegments: number; durationUs: string; stats?: Record<string, unknown> },
): Promise<unknown> =>
  apiFetch(`/api/videos/${videoId}/finalize`, {
    method: 'POST',
    headers: { 'x-upload-token': uploadToken },
    body: JSON.stringify(body),
  });

export const getLabTests = (): Promise<{ tests: LabTest[] }> => apiFetch('/api/lab/tests');

export const runLabTest = (id: string): Promise<{ runId: string; status: string }> =>
  apiFetch(`/api/lab/run/${id}`, { method: 'POST' });
