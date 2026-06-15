import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  isAdmin?: boolean;
}

export interface StoredSession {
  token: string;
  user?: StoredUser;
  expiresAt?: number;
}

const authDir = process.env.LOCCLE_TUI_AUTH_DIR ?? join(homedir(), '.loccle');
const authFilePath = process.env.LOCCLE_TUI_AUTH_PATH ?? join(authDir, 'tui-auth.json');

export function getStoredSession(): StoredSession | null {
  try {
    if (!existsSync(authFilePath)) return null;
    const raw = readFileSync(authFilePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isStoredSession(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeSession(session: StoredSession): void {
  mkdirSync(dirname(authFilePath), { recursive: true });
  writeFileSync(authFilePath, JSON.stringify(session, null, 2), { mode: 0o600 });
}

export function clearSession(): void {
  try {
    writeFileSync(authFilePath, '{}', { mode: 0o600 });
  } catch {
    // ignore
  }
}

function isStoredSession(value: unknown): value is StoredSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    'token' in value &&
    typeof (value as Record<string, unknown>).token === 'string'
  );
}
