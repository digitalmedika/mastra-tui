import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useState } from 'react';
import { useAgentStream } from '../hooks';
import { assistantMarkerFg, mutedFg, redBg, runBg, shellBg, taskBg } from '../constants';
import { compactText, getSessionTitle, toSessionOption } from '../utils';
import { Badge } from './Badge';
import { StreamingIndicator } from './StreamingIndicator';
import { TaskListPanel } from './TaskListPanel';
import { StreamView } from './StreamView';

export function App({ onExit }: { onExit: () => void }) {
  const {
    events,
    tasks,
    status,
    currentSession,
    sessions,
    sessionPickerOpen,
    submitPrompt,
    clearMemory,
    createSession,
    openSessionPicker,
    closeSessionPicker,
    selectSession,
  } = useAgentStream();
  const [inputValue, setInputValue] = useState('');
  const { width: terminalWidth } = useTerminalDimensions();
  const hasTasks = tasks.length > 0;
  const showSideTasks = hasTasks && terminalWidth >= 132;
  const allTasksDone = hasTasks && tasks.every((task) => task.done);
  const sessionOptions = sessions.map(toSessionOption);
  const selectedSessionIndex = Math.max(
    0,
    sessions.findIndex((session) => session.id === currentSession.id),
  );
  const sessionSelectHeight = Math.min(14, Math.max(3, sessionOptions.length * 2));
  const sessionLabel = compactText(getSessionTitle(currentSession), 36);
  const visibleFooterState =
    status === 'idle'
      ? { label: 'READY', bg: runBg, text: `session ${sessionLabel} - enter kirim - /new - /sessions - /clear` }
      : status === 'streaming'
        ? { label: 'STREAM', bg: shellBg, text: `session ${sessionLabel} - scroll panah/page - esc keluar` }
        : status === 'error'
          ? { label: 'ERROR', bg: redBg, text: `session ${sessionLabel} - enter kirim - /new - /sessions - /clear` }
          : allTasksDone
            ? { label: 'DONE', bg: taskBg, text: `session ${sessionLabel} - task selesai - enter kirim` }
            : { label: 'PAUSED', bg: redBg, text: `session ${sessionLabel} - task belum selesai - enter lanjut` };
  const footerState =
    status === 'idle'
      ? { label: 'READY', bg: runBg, text: 'enter kirim · esc keluar · /clear bersihkan' }
      : status === 'streaming'
        ? { label: 'STREAM', bg: shellBg, text: 'scroll panah/page · esc keluar' }
        : status === 'error'
          ? { label: 'ERROR', bg: redBg, text: 'enter kirim · esc keluar · /clear bersihkan' }
          : allTasksDone
            ? { label: 'DONE', bg: taskBg, text: 'task selesai · enter kirim · esc keluar' }
            : { label: 'PAUSED', bg: redBg, text: 'task belum selesai · enter lanjut · esc keluar' };

  useKeyboard((key) => {
    if (key.name === 'escape') {
      if (sessionPickerOpen) {
        closeSessionPicker();
        return;
      }
      onExit();
    }
  });

  const handleSubmit = (value: unknown) => {
    if (typeof value !== 'string') return;

    const trimmedValue = value.trim();

    if (trimmedValue === '/clear' && status !== 'streaming') {
      setInputValue('');
      void clearMemory();
      return;
    }

    if (trimmedValue === '/sessions' && status !== 'streaming') {
      setInputValue('');
      void openSessionPicker();
      return;
    }

    if (trimmedValue === '/new' || trimmedValue.startsWith('/new ')) {
      if (status !== 'streaming') {
        const title = trimmedValue.slice('/new'.length).trim();
        setInputValue('');
        void createSession(title || undefined);
      }
      return;
    }

    if (submitPrompt(value)) {
      setInputValue('');
    }
  };

  return (
    <box style={{ width: '100%', height: '100%', flexDirection: 'column' }}>
      {sessionPickerOpen ? (
        <box
          style={{
            width: '100%',
            flexDirection: 'column',
            border: true,
            paddingLeft: 1,
            paddingRight: 1,
            flexShrink: 0,
          }}
        >
          <box style={{ width: '100%', flexDirection: 'row' }}>
            <Badge label="SESSIONS" bg={runBg} />
            <text content="  pilih session lalu enter" style={{ fg: mutedFg }} />
          </box>
          <select
            focused
            options={sessionOptions}
            selectedIndex={selectedSessionIndex}
            showScrollIndicator
            wrapSelection
            style={{ width: '100%', height: sessionSelectHeight }}
            onSelect={(_index, option) => {
              const sessionId = typeof option?.value === 'string' ? option.value : undefined;
              if (sessionId) {
                void selectSession(sessionId);
              }
            }}
          />
          <text content="enter pilih - esc batal - /new dari input untuk session baru" style={{ fg: mutedFg }} />
        </box>
      ) : null}
      {hasTasks && !showSideTasks ? (
        <TaskListPanel tasks={tasks} sidePanel={false} terminalWidth={terminalWidth} />
      ) : null}
      <box style={{ width: '100%', flexGrow: 1, flexShrink: 1, flexBasis: 0, flexDirection: 'row' }}>
        <scrollbox
          focused={!sessionPickerOpen}
          stickyScroll
          stickyStart="bottom"
          scrollY
          style={{ width: '100%', flexGrow: 1, flexShrink: 1, flexBasis: 0 }}
        >
          <StreamView events={events} status={status} />
        </scrollbox>
        {showSideTasks ? (
          <TaskListPanel tasks={tasks} sidePanel terminalWidth={terminalWidth} />
        ) : null}
      </box>
      <box style={{ width: '100%', flexDirection: 'row', flexShrink: 0 }}>
        <Badge label={visibleFooterState.label} bg={visibleFooterState.bg} />
        {status === 'streaming' ? <StreamingIndicator /> : <text content="  " />}
        <text content={visibleFooterState.text} style={{ fg: mutedFg }} />
      </box>
      <text content={'─'.repeat(terminalWidth)} style={{ fg: mutedFg }} />
      <box style={{ width: '100%', flexDirection: 'row', flexShrink: 0 }}>
        <text content="> " style={{ fg: assistantMarkerFg }} />
        <input
          focused={!sessionPickerOpen}
          value={inputValue}
          placeholder={status === 'streaming' ? 'tunggu streaming selesai...' : 'ketik instruksi lalu enter'}
          onInput={setInputValue}
          onSubmit={handleSubmit}
          style={{ flexGrow: 1 }}
        />
      </box>
      <text content={'─'.repeat(terminalWidth)} style={{ fg: mutedFg }} />
    </box>
  );
}
