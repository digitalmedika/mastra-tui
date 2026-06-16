import { TextAttributes } from '@opentui/core';
import type { ApprovalEvent } from '../types';
import {
  approveBg,
  greenBg,
  inputBorderFg,
  mutedFg,
  redBg,
  runBg,
  textFg,
} from '../constants';
import { Badge } from './Badge';

export interface ApprovalOverlayProps {
  event: ApprovalEvent;
  selectedIndex: number;
  submitting: boolean;
}

const formatPath = (path: string | undefined) => path ?? '(path tidak tersedia)';

export function ApprovalOverlay({ event, selectedIndex, submitting }: ApprovalOverlayProps) {
  const approveSelected = selectedIndex === 0;
  const denySelected = selectedIndex === 1;

  return (
    <box
      style={{
        width: '100%',
        flexDirection: 'column',
        border: true,
        borderStyle: 'single',
        borderColor: inputBorderFg,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
        flexShrink: 0,
      }}
    >
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label="APPROVAL" bg={approveBg} />
        <text content={`  ${event.toolName} meminta akses di luar workspace`} style={{ fg: textFg }} />
      </box>

      <box style={{ width: '100%', flexDirection: 'column', paddingTop: 1, paddingBottom: 1 }}>
        <text content="Target" style={{ fg: mutedFg }} />
        <text content={formatPath(event.path)} style={{ fg: textFg }} />
      </box>

      <box style={{ width: '100%', flexDirection: 'row' }}>
        <text
          content={approveSelected ? '  > APPROVE  ' : '    APPROVE  '}
          style={{
            fg: '#ffffff',
            bg: approveSelected ? greenBg : runBg,
            attributes: approveSelected ? TextAttributes.BOLD : undefined,
          }}
        />
        <text content="  " />
        <text
          content={denySelected ? '  > DENY  ' : '    DENY  '}
          style={{
            fg: '#ffffff',
            bg: denySelected ? redBg : approveBg,
            attributes: denySelected ? TextAttributes.BOLD : undefined,
          }}
        />
        {submitting ? <text content="  applying..." style={{ fg: mutedFg }} /> : null}
      </box>

      <text content="←/→ pilih  •  enter konfirmasi  •  a approve  •  d/esc deny" style={{ fg: mutedFg }} />
    </box>
  );
}
