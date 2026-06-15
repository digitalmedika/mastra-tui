import { useEffect, useRef, useState } from 'react';
import {
  fetchSessionMe,
  pollDeviceToken,
  requestDeviceCode,
  storeDeviceToken,
  type DeviceCodeResponse,
} from '../auth/device';

export type DeviceLoginPhase = 'loading' | 'polling' | 'success' | 'error';

export interface DeviceLoginState {
  phase: DeviceLoginPhase;
  userCode?: string;
  verificationUri?: string;
  error?: string;
}

export function useDeviceLogin(onLogin: () => void): DeviceLoginState {
  const [state, setState] = useState<DeviceLoginState>({ phase: 'loading' });
  const onLoginRef = useRef(onLogin);
  onLoginRef.current = onLogin;

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const start = async () => {
      try {
        const code = await requestDeviceCode();
        if (cancelled) return;
        setState({
          phase: 'polling',
          userCode: code.user_code,
          verificationUri: code.verification_uri_complete ?? code.verification_uri,
        });
        poll(code);
      } catch (error) {
        if (cancelled) return;
        setState({
          phase: 'error',
          error: error instanceof Error ? error.message : 'Failed to request login code.',
        });
      }
    };

    const poll = async (code: DeviceCodeResponse) => {
      const intervalMs = Math.max(code.interval ?? 10, 1) * 1000;
      const expiresAt = Date.now() + Math.max(code.expires_in ?? 300, 1) * 1000;

      while (!cancelled) {
        await new Promise((resolve) => {
          timeoutId = setTimeout(resolve, intervalMs);
        });
        if (cancelled) return;

        try {
          const result = await pollDeviceToken(code.device_code);
          if (cancelled) return;

          if (result.status === 'success') {
            try {
              const session = await fetchSessionMe(result.token);
              if (cancelled) return;
              storeDeviceToken(result.token, result.expiresIn, session.data.user);
              setState({ phase: 'success' });
              if (!cancelled) onLoginRef.current();
            } catch (error) {
              if (cancelled) return;
              setState({
                phase: 'error',
                error: error instanceof Error ? error.message : 'Failed to validate session.',
              });
            }
            return;
          }

          if (result.status === 'error') {
            if (cancelled) return;
            setState({ phase: 'error', error: result.error });
            return;
          }

          if (Date.now() >= expiresAt) {
            if (cancelled) return;
            setState({ phase: 'error', error: 'Login code expired. Please try again.' });
            return;
          }
        } catch (error) {
          if (cancelled) return;
          setState({
            phase: 'error',
            error: error instanceof Error ? error.message : 'Failed to contact authentication server.',
          });
          return;
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  return state;
}
