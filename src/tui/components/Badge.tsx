import { TextAttributes } from '@opentui/core';
import { purpleBg } from '../constants';

export function Badge({ label, bg = purpleBg }: { label: string; bg?: string }) {
  return (
    <text content={` ${label} `} style={{ fg: '#ffffff', bg, attributes: TextAttributes.BOLD }} />
  );
}
