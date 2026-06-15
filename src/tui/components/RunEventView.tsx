import { TextAttributes } from '@opentui/core';
import { Badge } from './Badge';
import type { RunEvent } from '../types';
import { branchFg, mutedFg, pathFg, runBg, textFg } from '../constants';

export function RunEventView({ event }: { event: RunEvent }) {
  const statusText =
    event.status === 'waiting'
      ? 'Waiting for streaming response'
      : event.status === 'streaming'
        ? 'Streaming response'
        : event.status === 'error'
          ? 'Error'
          : 'Done';

  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} bg={runBg} />
        <text content="  " />
        <text content={event.prompt} style={{ fg: pathFg, attributes: TextAttributes.BOLD }} />
      </box>
      <text>
        <span fg={branchFg}>{'└ '}</span>
        <span fg={mutedFg}>{'agent '}</span>
        <span fg={textFg}>{event.agent}</span>
        <span fg={mutedFg}>{` · ${statusText}`}</span>
      </text>
    </box>
  );
}
