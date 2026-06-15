import { TextAttributes } from '@opentui/core';
import { Badge } from './Badge';
import type { TaskListEvent } from '../types';
import { branchFg, mutedFg, pathFg, redFg, taskBg } from '../constants';

export function TaskListEventView({ event }: { event: TaskListEvent }) {
  const statusText = event.status === 'running' ? 'Running' : event.status === 'error' ? 'Failed' : 'Done';

  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} bg={taskBg} />
        <text content="  " />
        <text content={event.summary} style={{ fg: pathFg, attributes: TextAttributes.BOLD }} />
      </box>
      <text>
        <span fg={branchFg}>{'└ '}</span>
        <span fg={event.status === 'error' ? redFg : mutedFg}>{statusText}</span>
      </text>
    </box>
  );
}
