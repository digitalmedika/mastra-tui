import type { ApprovalEvent, RunEvent, StreamEvent, TokenUsageEvent, ToolCardEvent, ProgressEvent } from './types';

type TextBlock = { id: number; type: 'text'; content: string };
type AssistantBlock = { id: number; type: 'assistant'; content: string };
export type StreamBlock = TextBlock | AssistantBlock | RunEvent | TokenUsageEvent | ToolCardEvent | ProgressEvent | ApprovalEvent;

export const buildStreamBlocks = (events: StreamEvent[]) => {
  const blocks: StreamBlock[] = [];
  let textBlock: { id: number; lines: string[] } | undefined;
  let assistantBlock: { id: number; lines: string[] } | undefined;

  const flushTextBlock = () => {
    if (textBlock) {
      blocks.push({ id: textBlock.id, type: 'text', content: textBlock.lines.join('\n') });
      textBlock = undefined;
    }
  };

  const flushAssistantBlock = () => {
    if (assistantBlock) {
      blocks.push({ id: assistantBlock.id, type: 'assistant', content: assistantBlock.lines.join('\n') });
      assistantBlock = undefined;
    }
  };

  for (const event of events) {
    if (event.type === 'text') {
      flushAssistantBlock();
      if (!textBlock) {
        textBlock = { id: event.id, lines: [] };
      }
      textBlock.lines.push(event.text);
      continue;
    }

    if (event.type === 'assistant') {
      flushTextBlock();
      if (!assistantBlock) {
        assistantBlock = { id: event.id, lines: [] };
      }
      assistantBlock.lines.push(event.text);
      continue;
    }

    if (event.type === 'progress') {
      flushTextBlock();
      flushAssistantBlock();
      blocks.push(event);
      continue;
    }

    flushTextBlock();
    flushAssistantBlock();
    blocks.push(event);
  }

  flushTextBlock();
  flushAssistantBlock();

  return blocks;
};
