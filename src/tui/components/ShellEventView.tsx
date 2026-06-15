import { TextAttributes } from '@opentui/core';
import { Badge } from './Badge';
import type { ShellEvent } from '../types';
import { branchFg, mutedFg, pathFg, redFg, shellBg, textFg } from '../constants';

export function ShellEventView({ event }: { event: ShellEvent }) {
  const statusLabel =
    event.status === 'running'
      ? `Running (${event.elapsedSeconds}s)`
      : event.status === 'error'
        ? `Failed (${event.elapsedSeconds}s)`
        : `Done (${event.elapsedSeconds}s)`;

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
