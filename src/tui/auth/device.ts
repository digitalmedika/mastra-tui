import { authServerUrl } from '../constants';
import { storeSession } from './storage';

export const tuiClientId = 'loccle-cli';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

export interface SessionMeResponse {
  data: {
    sessionId: string;
    user: {
      id: string;
      email: string;
      name: string;
      isAdmin?: boolean;
    };
  };
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'success'; token: string; expiresIn: number }
  | { status: 'error'; error: string };

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; error_description?: string; message?: string };
    return body.error_description ?? body.error ?? body.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(`${authServerUrl}/api/auth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: tuiClientId }),
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `HTTP ${res.status}`));
  }

  return res.json() as Promise<DeviceCodeResponse>;
}

export async function pollDeviceToken(deviceCode: string, signal?: AbortSignal): Promise<PollResult> {
  const res = await fetch(`${authServerUrl}/api/auth/device/token`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: tuiClientId,
    }),
  });

  if (res.ok) {
    const body = (await res.json()) as DeviceTokenResponse;
    return { status: 'success', token: body.access_token, expiresIn: body.expires_in };
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    error_description?: string;
    message?: string;
  };
  const error = body.error_description ?? body.error ?? body.message ?? `HTTP ${res.status}`;

  if (body.error === 'authorization_pending' || body.error === 'slow_down') {
    return { status: 'pending' };
  }

  if (body.error === 'expired_token') {
    return { status: 'error', error: 'Login code expired. Please try again.' };
  }

  if (body.error === 'access_denied') {
    return { status: 'error', error: 'Login ditolak dari browser.' };
  }

  return { status: 'error', error };
}

export async function fetchSessionMe(token: string): Promise<SessionMeResponse> {
  const res = await fetch(`${authServerUrl}/api/session/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, `HTTP ${res.status}`));
  }

  return res.json() as Promise<SessionMeResponse>;
}

export function storeDeviceToken(token: string, expiresIn: number, user?: SessionMeResponse['data']['user']): void {
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined;
  storeSession({ token, user, expiresAt });
}
