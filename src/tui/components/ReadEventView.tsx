import { Badge } from './Badge';
import type { ReadEvent } from '../types';
import { formatLineCount } from '../utils';
import { mutedFg, textFg } from '../constants';

export function ReadEventView({ event }: { event: ReadEvent }) {
  return (
    <box style={{ width: '100%', flexDirection: 'row', marginTop: 1 }}>
      <Badge label={event.label} />
      <text content="  " />
      <text>
        <span fg={textFg}>{`[${event.path}]`}</span>
        <span fg={mutedFg}>{` ${formatLineCount(event.lines)}`}</span>
      </text>
    </box>
  );
}
