import { Badge } from './Badge';
import type { TokenUsageEvent } from '../types';
import { greenFg, mutedFg, redFg, runBg } from '../constants';
import { formatTokenCount } from '../utils';

export function TokenUsageEventView({ event }: { event: TokenUsageEvent }) {
  const { inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, estimated } = event.usage;

  // Don't render if no token data is available
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return null;
  }

  const parts: string[] = [];
  if (inputTokens !== undefined) {
    parts.push(`in ${formatTokenCount(inputTokens)}`);
  }
  if (outputTokens !== undefined) {
    parts.push(`out ${formatTokenCount(outputTokens)}`);
  }
  if (cacheReadTokens !== undefined && cacheReadTokens > 0) {
    parts.push(`cache read ${formatTokenCount(cacheReadTokens)}`);
  }
  if (cacheWriteTokens !== undefined && cacheWriteTokens > 0) {
    parts.push(`cache write ${formatTokenCount(cacheWriteTokens)}`);
  }
  // Fallback: if no input/output breakdown, show total
  if (parts.length === 0 && totalTokens !== undefined) {
    parts.push(`total ${formatTokenCount(totalTokens)}`);
  }
  if (estimated) {
    parts.push('estimated');
  }

  return (
    <box style={{ width: '100%', flexDirection: 'row', marginTop: 1 }}>
      <Badge label={event.label} bg={runBg} />
      <text content=" " />
      <text>
        {parts.map((part, i) => {
          const isInput = part.startsWith('in ');
          const isOutput = part.startsWith('out ');
          return (
            <span key={i}>
              {i > 0 ? <span fg={mutedFg} content="  " /> : null}
              <span fg={isInput ? greenFg : isOutput ? redFg : mutedFg} content={part} />
            </span>
          );
        })}
      </text>
    </box>
  );
}
