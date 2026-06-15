import { useState, useEffect } from 'react';
import { TextAttributes } from '@opentui/core';
import { Badge } from './Badge';
import type { ShellEvent } from '../types';
import { branchFg, mutedFg, pathFg, redFg, shellBg, textFg } from '../constants';

export function ShellEventView({ event }: { event: ShellEvent }) {
  const [currentElapsed, setCurrentElapsed] = useState(event.elapsedSeconds);

  useEffect(() => {
    if (event.status !== 'running') {
      setCurrentElapsed(event.elapsedSeconds);
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - event.startedAt) / 1000);
      setCurrentElapsed(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [event.status, event.startedAt, event.elapsedSeconds]);

  const statusLabel =
    event.status === 'running'
      ? `Running (${currentElapsed}s)`
      : event.status === 'error'
        ? `Failed (${currentElapsed}s)`
        : `Done (${currentElapsed}s)`;

  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} bg={shellBg} />
        <text content="  " />
        <text content={event.command} style={{ fg: pathFg, attributes: TextAttributes.BOLD }} />
      </box>
      <text>
        <span fg={branchFg}>{'└ '}</span>
        <span fg={event.status === 'error' ? redFg : mutedFg}>{statusLabel}</span>
        <span fg={mutedFg}>{` di ${event.directory}`}</span>
      </text>
    </box>
  );
}
