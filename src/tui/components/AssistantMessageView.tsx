import { assistantMarkerFg, markdownSyntaxStyle, treeSitterClient } from '../constants';

export function AssistantMessageView({ content, streaming }: { content: string; streaming: boolean }) {
  if (!content.trim()) {
    return <text content="" />;
  }

  return (
    <box style={{ width: '100%', flexDirection: 'row' }}>
      <text content="✣ " style={{ fg: assistantMarkerFg, width: 3, flexShrink: 0 }} />
      <box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, flexDirection: 'column' }}>
        <markdown
          content={content.trim()}
          syntaxStyle={markdownSyntaxStyle}
          treeSitterClient={treeSitterClient}
          streaming={streaming}
          tableOptions={{
            style: 'grid',
            widthMode: 'full',
            columnFitter: 'balanced',
            wrapMode: 'word',
            cellPaddingX: 1,
            borders: true,
          }}
          style={{ width: '100%' }}
        />
      </box>
    </box>
  );
}
