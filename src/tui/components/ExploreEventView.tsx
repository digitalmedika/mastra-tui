import { Badge } from './Badge';
import type { ExploreEvent } from '../types';
import { branchFg, exploreBg, mutedFg, redFg } from '../constants';
import { formatTokenCount } from '../utils';

export function ExploreEventView({ event }: { event: ExploreEvent }) {
  const statusText =
    event.status === 'running'
      ? `Running (${event.elapsedSeconds}s | ${formatTokenCount(event.tokenEstimate)} tokens).`
      : event.status === 'error'
        ? `Failed (${event.elapsedSeconds}s | ${formatTokenCount(event.tokenEstimate)} tokens).`
        : `Done (${event.elapsedSeconds}s | ${formatTokenCount(event.tokenEstimate)} tokens).`;

  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} bg={exploreBg} />
      </box>
      <text>
        <span fg={branchFg}>{'└ '}</span>
        <span fg={event.status === 'error' ? redFg : mutedFg}>{statusText}</span>
      </text>
      {event.children.map((child) => (
        <text key={`${event.id}-${child.id}-${child.label}-${child.path}`}>
          <span fg={branchFg}>{'└ '}</span>
          <span fg={branchFg}>{child.label}</span>
          <span fg={branchFg}>{` (${child.path})`}</span>
        </text>
      ))}
    </box>
  );
}
