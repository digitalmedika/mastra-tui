import { TextAttributes } from '@opentui/core';
import { Badge } from './Badge';
import type { EditEvent } from '../types';
import { greenBg, greenFg, mutedFg, pathFg, redBg, redFg, textFg, treeSitterClient } from '../constants';
import { plural } from '../utils';

export function EditEventView({ event }: { event: EditEvent }) {
  const removalSummary = event.removals > 0 ? `, ${plural(event.removals, 'removal', 'removals')}` : '';

  return (
    <box style={{ width: '100%', flexDirection: 'column', marginTop: 1 }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} />
        <text content="  " />
        <text content={event.path} style={{ fg: pathFg, attributes: TextAttributes.BOLD }} />
      </box>
      <text>
        <span fg={mutedFg}>{'- Updated '}</span>
        <span fg={pathFg} attributes={TextAttributes.BOLD}>{event.path}</span>
        <span fg={mutedFg}>{' with '}</span>
        <span fg={greenFg}>{plural(event.additions, 'addition', 'additions')}</span>
        <span fg={mutedFg}>{removalSummary}</span>
      </text>
      <box style={{ width: '100%', flexDirection: 'column', marginLeft: 2 }}>
        <diff
          diff={event.diff}
          view="unified"
          filetype={event.filetype}
          treeSitterClient={treeSitterClient}
          showLineNumbers
          wrapMode="none"
          height={event.diffHeight}
          width="100%"
          lineNumberFg={mutedFg}
          addedBg={greenBg}
          removedBg={redBg}
          addedSignColor={greenFg}
          removedSignColor={redFg}
          fg={textFg}
        />
        {event.hiddenLines > 0 ? (
          <text content={`... (${event.hiddenLines} more lines) [ctrl+o to expand]`} style={{ fg: mutedFg }} />
        ) : null}
      </box>
    </box>
  );
}
