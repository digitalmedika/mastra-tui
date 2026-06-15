import { TextAttributes } from '@opentui/core';
import { getBadgeBg } from '../constants';

export function Badge({ label, bg }: { label: string; bg?: string }) {
  return (
    <text content={` ${label} `} style={{ fg: '#ffffff', bg: bg ?? getBadgeBg(label), attributes: TextAttributes.BOLD }} />
  );
}
