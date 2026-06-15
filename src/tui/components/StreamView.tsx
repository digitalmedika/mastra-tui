import type { StreamEvent, StreamStatus } from '../types';
import { buildStreamBlocks } from '../stream-builder';
import { AssistantMessageView } from './AssistantMessageView';
import { RunEventView } from './RunEventView';
import { ReadEventView } from './ReadEventView';
import { ExploreEventView } from './ExploreEventView';
import { ShellEventView } from './ShellEventView';
import { TaskListEventView } from './TaskListEventView';
import { EditEventView } from './EditEventView';
import { markdownSyntaxStyle } from '../constants';

export function StreamView({ events, status }: { events: StreamEvent[]; status: StreamStatus }) {
  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      {buildStreamBlocks(events).map((block) =>
        block.type === 'text' ? (
          <markdown
            key={block.id}
            content={block.content}
            syntaxStyle={markdownSyntaxStyle}
            streaming={status === 'streaming'}
            tableOptions={{
              style: 'grid',
              widthMode: 'content',
              columnFitter: 'balanced',
              wrapMode: 'word',
              cellPaddingX: 1,
              borders: true,
            }}
            style={{ width: '100%' }}
          />
        ) : block.type === 'assistant' ? (
          <AssistantMessageView key={block.id} content={block.content} streaming={status === 'streaming'} />
        ) : block.type === 'run' ? (
          <RunEventView key={block.id} event={block} />
        ) : block.type === 'read' ? (
          <ReadEventView key={block.id} event={block} />
        ) : block.type === 'explore' ? (
          <ExploreEventView key={block.id} event={block} />
        ) : block.type === 'shell' ? (
          <ShellEventView key={block.id} event={block} />
        ) : block.type === 'task-list' ? (
          <TaskListEventView key={block.id} event={block} />
        ) : (
          <EditEventView key={block.id} event={block} />
        ),
      )}
    </box>
  );
}
