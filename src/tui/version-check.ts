const PACKAGE_NAME = 'loccle';
const NPM_REGISTRY = 'https://registry.npmjs.org';

export interface VersionCheckResult {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
}

function parseSemver(version: string): number[] {
  return version.split('.').map(Number);
}

function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

let cachedResult: VersionCheckResult | null = null;

export function getCachedVersionResult(): VersionCheckResult | null {
  return cachedResult;
}

export async function checkVersion(currentVersion: string): Promise<VersionCheckResult> {
  if (cachedResult) return cachedResult;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${NPM_REGISTRY}/${PACKAGE_NAME}/latest`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = (await res.json()) as { version?: string };
    const latest = data.version ?? null;

    if (!latest) {
      cachedResult = { current: currentVersion, latest: null, hasUpdate: false };
      return cachedResult;
    }

    const hasUpdate = isNewer(latest, currentVersion);
    cachedResult = { current: currentVersion, latest, hasUpdate };
    return cachedResult;
  } catch {
    cachedResult = { current: currentVersion, latest: null, hasUpdate: false };
    return cachedResult;
  }
}
