import { Badge } from './Badge';
import type { ReadEvent } from '../types';
import { formatLineCount } from '../utils';
import { branchFg, mutedFg, textFg } from '../constants';

export function ReadEventView({ event }: { event: ReadEvent }) {
  return (
    <box style={{ width: '100%', flexDirection: 'column', marginTop: 1 }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} />
      </box>
      <text>
        <span fg={branchFg}>{'└ '}</span>
        <span fg={textFg}>{`[${event.path}]`}</span>
        <span fg={mutedFg}>{` ${formatLineCount(event.lines)}`}</span>
      </text>
    </box>
  );
}
