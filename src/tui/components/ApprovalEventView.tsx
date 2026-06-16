import { Badge } from './Badge';
import type { ApprovalEvent } from '../types';
import { branchFg, mutedFg, pathFg, redFg, textFg } from '../constants';

export function ApprovalEventView({ event }: { event: ApprovalEvent }) {
  const statusText =
    event.status === 'pending'
      ? 'Waiting for approval'
      : event.status === 'approved'
        ? 'Approved'
        : 'Denied';
  const statusFg = event.status === 'denied' ? redFg : event.status === 'approved' ? pathFg : mutedFg;

  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} />
        <text content="  " />
        <text content={event.toolName} style={{ fg: textFg }} />
      </box>
      <text>
        <span fg={branchFg}>{'└ '}</span>
        <span fg={statusFg}>{statusText}</span>
        {event.path ? <span fg={mutedFg}>{` for ${event.path}`}</span> : null}
      </text>
      {event.status === 'pending' ? (
        <text>
          <span fg={branchFg}>{'└ '}</span>
          <span fg={mutedFg}>{'use the approval overlay above to continue or deny'}</span>
        </text>
      ) : null}
    </box>
  );
}
