import { useState, useEffect } from 'react';
import { Badge } from './Badge';
import type { ExploreEvent } from '../types';
import { branchFg, exploreBg, mutedFg, redFg } from '../constants';
import { formatTokenCount } from '../utils';

export function ExploreEventView({ event }: { event: ExploreEvent }) {
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

  const statusText =
    event.status === 'running'
      ? `Running (${currentElapsed}s | ${formatTokenCount(event.tokenEstimate)} tokens).`
      : event.status === 'error'
        ? `Failed (${currentElapsed}s | ${formatTokenCount(event.tokenEstimate)} tokens).`
        : `Done (${currentElapsed}s | ${formatTokenCount(event.tokenEstimate)} tokens).`;

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
