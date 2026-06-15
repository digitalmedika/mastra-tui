import { useTerminalDimensions } from '@opentui/react';
import { useDeviceLogin } from '../hooks';
import { assistantMarkerFg, mutedFg, redFg } from '../constants';

export interface DeviceLoginProps {
  onLogin: () => void;
}

export function DeviceLogin({ onLogin }: DeviceLoginProps) {
  const { phase, userCode, verificationUri, error } = useDeviceLogin(onLogin);
  const { width: terminalWidth } = useTerminalDimensions();

  const divider = '-'.repeat(Math.max(terminalWidth - 8, 12));

  return (
    <box style={{ width: '100%', height: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'column', paddingLeft: 4, paddingRight: 4 }}>
        <box style={{ height: 1 }} />
        <text content="Device login" style={{ fg: assistantMarkerFg }} />
        <box style={{ height: 1 }} />
        <text content={divider} style={{ fg: mutedFg }} />
        <box style={{ height: 1 }} />
        <text content="Open the URL in your browser and enter the code below to authorize the TUI." style={{ fg: mutedFg }} />
        <box style={{ height: 1 }} />
        <text content={verificationUri ? `URL: ${verificationUri}` : 'Loading URL...'} style={{ fg: mutedFg }} />
        <box style={{ height: 2 }} />
        <text content={userCode ? `Code: ${userCode}` : 'Loading code...'} style={{ fg: assistantMarkerFg }} />
        <box style={{ height: 2 }} />
        {phase === 'loading' && <text content="Requesting login code..." style={{ fg: mutedFg }} />}
        {phase === 'polling' && <text content="Waiting for browser approval..." style={{ fg: mutedFg }} />}
        {phase === 'success' && <text content="Login successful! Opening TUI..." style={{ fg: assistantMarkerFg }} />}
        {phase === 'error' && error && (
          <text content={`Error: ${error}`} style={{ fg: redFg }} />
        )}
        <box style={{ height: 2 }} />
        <text content="Press esc to exit." style={{ fg: mutedFg }} />
      </box>
    </box>
  );
}
