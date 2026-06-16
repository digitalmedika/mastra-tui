import { Badge } from './Badge';
import type { ReadEvent } from '../types';
import { formatLineCount } from '../utils';
import { branchFg, mutedFg, redFg, textFg } from '../constants';

export function ReadEventView({ event }: { event: ReadEvent }) {
  const children = event.children ?? [];

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
      {children.map((child) => (
        <text key={`${event.id}-${child.id}-${child.path}`}>
          <span fg={branchFg}>{'└ '}</span>
          <span fg={child.ok === false ? redFg : branchFg}>READ</span>
          <span fg={child.ok === false ? redFg : branchFg}>{` (${child.path})`}</span>
          {typeof child.lines === 'number' ? <span fg={mutedFg}>{` ${formatLineCount(child.lines)}`}</span> : null}
        </text>
      ))}
    </box>
  );
}
