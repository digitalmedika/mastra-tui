import { Badge } from './Badge';
import { StreamingIndicator } from './StreamingIndicator';
import type { ProgressEvent } from '../types';
import { branchFg, mutedFg, pathFg, redFg } from '../constants';

const readPathPrefix = 'reading file ';

const formatProgressDescription = (event: ProgressEvent) => {
  if (event.label === 'READ' && event.description.startsWith(readPathPrefix)) {
    return `[${event.description.slice(readPathPrefix.length)}]`;
  }

  return event.description;
};

export function ProgressEventView({ event }: { event: ProgressEvent }) {
  const description = formatProgressDescription(event);
  const status = event.status ?? 'running';
  const text = status === 'error' && description ? `! ${description}` : description;
  const fg = status === 'error' ? redFg : event.label === 'READ' ? pathFg : mutedFg;

  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'row', gap: 1 }}>
        <Badge label={event.label} />
        {status === 'running' ? <StreamingIndicator /> : null}
      </box>
      {text ? (
        <text>
          <span fg={branchFg}>{'└ '}</span>
          <span fg={fg}>{text}</span>
        </text>
      ) : null}
    </box>
  );
}
