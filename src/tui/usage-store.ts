import { getStoredSession } from './auth/storage';
import type { TokenUsage } from './types';

interface BackendUsageRequest {
  status?: string;
  startedAt?: string | number | Date;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const authServerUrl = process.env.AUTH_SERVER_URL ?? 'https://api.loccle.com';

const toTimestamp = (value: BackendUsageRequest['startedAt']) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const hasTokenData = (request: BackendUsageRequest) => {
  return (
    (request.inputTokens ?? 0) > 0 ||
    (request.outputTokens ?? 0) > 0 ||
    (request.cacheReadTokens ?? 0) > 0 ||
    (request.cacheWriteTokens ?? 0) > 0
  );
};

const toTokenUsage = (request: BackendUsageRequest): TokenUsage => {
  const inputTokens = request.inputTokens ?? undefined;
  const outputTokens = request.outputTokens ?? undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined,
    cacheReadTokens: request.cacheReadTokens ?? undefined,
    cacheWriteTokens: request.cacheWriteTokens ?? undefined,
  };
};

export async function fetchLatestBackendTokenUsageSince(startedAtMs: number): Promise<TokenUsage | undefined> {
  const token = getStoredSession()?.token;
  if (!token) return undefined;

  const minStartedAt = startedAtMs - 10_000;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const res = await fetch(`${authServerUrl}/api/usage/me?limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return undefined;

      const body = (await res.json()) as { data?: { requests?: BackendUsageRequest[] } };
      const request = body.data?.requests?.find((item) => {
        const startedAt = toTimestamp(item.startedAt);
        if (startedAt === undefined || startedAt < minStartedAt) return false;
        if (item.status !== 'completed' && item.status !== 'partial') return false;
        return hasTokenData(item);
      });

      if (request) return toTokenUsage(request);
    } catch {
      return undefined;
    }

    await wait(300);
  }

  return undefined;
}
