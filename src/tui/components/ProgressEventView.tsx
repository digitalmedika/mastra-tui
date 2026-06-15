import { Badge } from './Badge';
import { StreamingIndicator } from './StreamingIndicator';
import type { ProgressEvent } from '../types';
import { purpleBg } from '../constants';

export function ProgressEventView({ event }: { event: ProgressEvent }) {
  return (
    <box style={{ width: '100%', flexDirection: 'row', gap: 1 }}>
      <Badge label={event.label} bg={purpleBg} />
      <StreamingIndicator />
    </box>
  );
}

// Made with Bob
