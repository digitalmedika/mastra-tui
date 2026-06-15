import { Badge } from './Badge';
import { StreamingIndicator } from './StreamingIndicator';
import type { ProgressEvent } from '../types';
import { mutedFg, pathFg, purpleBg } from '../constants';

const readPathPrefix = 'reading file ';

const formatProgressDescription = (event: ProgressEvent) => {
  if (event.label === 'READ' && event.description.startsWith(readPathPrefix)) {
    return `[${event.description.slice(readPathPrefix.length)}]`;
  }

  return event.description;
};

export function ProgressEventView({ event }: { event: ProgressEvent }) {
  const description = formatProgressDescription(event);

  return (
    <box style={{ width: '100%', flexDirection: 'row', gap: 1 }}>
      <Badge label={event.label} bg={purpleBg} />
      <StreamingIndicator />
      {description ? <text content={description} style={{ fg: event.label === 'READ' ? pathFg : mutedFg }} /> : null}
    </box>
  );
}

// Made with Bob
