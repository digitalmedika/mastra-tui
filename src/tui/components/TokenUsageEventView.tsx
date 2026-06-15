import { Badge } from './Badge';
import type { TokenUsageEvent } from '../types';
import { branchFg, mutedFg, pathFg, runBg, textFg } from '../constants';
import { formatTokenCount } from '../utils';

const formatUsagePart = (label: string, value: number | undefined) => {
  return value === undefined ? undefined : `${label} ${formatTokenCount(value)}`;
};

export function TokenUsageEventView({ event }: { event: TokenUsageEvent }) {
  const usageParts = [
    formatUsagePart('input', event.usage.inputTokens),
    formatUsagePart('output', event.usage.outputTokens),
    formatUsagePart('total', event.usage.totalTokens),
    formatUsagePart('cache read', event.usage.cacheReadTokens),
    formatUsagePart('cache write', event.usage.cacheWriteTokens),
  ].filter((part): part is string => Boolean(part));

  return (
    <box style={{ width: '100%', flexDirection: 'column', marginTop: 1 }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} bg={runBg} />
        <text content="  " />
        <text content="Token usage" style={{ fg: pathFg }} />
      </box>
      <text>
        <span fg={branchFg}>{'â”” '}</span>
        <span fg={mutedFg}>tokens: </span>
        <span fg={textFg}>{usageParts.join(' | ')}</span>
      </text>
    </box>
  );
}
