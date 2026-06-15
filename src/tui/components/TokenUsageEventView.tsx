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

  // Don't render if no token data is available
  if (usageParts.length === 0) {
    return null;
  }

  // Don't render if only total tokens and it's 0
  if (usageParts.length === 1 && event.usage.totalTokens === 0) {
    return null;
  }

  return (
    <box style={{ width: '100%', flexDirection: 'column', marginTop: 1 }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} bg={runBg} />
        <text content="  " />
        <text content="Token usage" style={{ fg: pathFg }} />
      </box>
      <text>
        <span fg={branchFg}>{'└ '}</span>
        <span fg={mutedFg}>tokens: </span>
        <span fg={textFg}>{usageParts.join(' | ')}</span>
      </text>
    </box>
  );
}
