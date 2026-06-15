import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useEffect, useState } from 'react';
import { clearSession, getStoredSession } from '../auth/storage';
import { fetchCreditsMe, fetchSessionMe } from '../auth/device';
import { useAgentStream } from '../hooks';
import { assistantMarkerFg, inputBorderFg, mutedFg, runBg, textFg } from '../constants';
import { toSessionOption } from '../utils';
import { refreshAgent } from '../../mastra/agents/openai-compatible-agent';
import { Badge } from './Badge';
import { DeviceLogin } from './DeviceLogin';
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
    models,
    selectedModelId,
    modelPickerOpen,
    modelsLoaded,
    openModelPicker,
    closeModelPicker,
    selectModel,
  } = useAgentStream();
  const [inputValue, setInputValue] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const { width: terminalWidth } = useTerminalDimensions();
  const hasTasks = tasks.length > 0;
  const showSideTasks = hasTasks && terminalWidth >= 132;
  const sessionOptions = sessions.map(toSessionOption);
  const selectedSessionIndex = Math.max(
    0,
    sessions.findIndex((session) => session.id === currentSession.id),
  );
  const sessionSelectHeight = Math.min(14, Math.max(3, sessionOptions.length * 2));
  const modelOptions = models.map((m) => ({
    name: m.name,
    description: `${m.providerName} - ${m.publicModelId}`,
    value: m.publicModelId,
  }));
  const selectedModelIndex = Math.max(
    0,
    models.findIndex((m) => m.publicModelId === selectedModelId),
  );
  const modelSelectHeight = Math.min(14, Math.max(3, modelOptions.length * 2));
  const anyPickerOpen = sessionPickerOpen || modelPickerOpen;
  const activeModel = models.find((m) => m.publicModelId === selectedModelId);
  const modelDisplayName = activeModel ? activeModel.name : selectedModelId;

  useEffect(() => {
    const session = getStoredSession();
    if (!session) {
      setIsAuthenticated(false);
      return;
    }
    fetchSessionMe(session.token)
      .then(() => {
        refreshAgent();
        setIsAuthenticated(true);
      })
      .catch((error) => {
        console.error('[Auth] Failed to verify session:', error);
        clearSession();
        setIsAuthenticated(false);
      });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const session = getStoredSession();
    if (!session) return;
    fetchCreditsMe(session.token)
      .then((res) => setBalance(res.data.balance))
      .catch((err) => console.error('[Balance] Failed to fetch:', err));
  }, [isAuthenticated]);

  useKeyboard((key) => {
    if (key.name === 'escape') {
      if (modelPickerOpen) {
        closeModelPicker();
        return;
      }
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

    if (trimmedValue === '/model' && status !== 'streaming') {
      setInputValue('');
      void openModelPicker();
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

    if (trimmedValue === '/logout') {
      setInputValue('');
      clearSession();
      setIsAuthenticated(false);
      return;
    }

    if (submitPrompt(value)) {
      setInputValue('');
    }
  };

  if (isAuthenticated === null) {
    return (
      <box style={{ width: '100%', height: '100%', flexDirection: 'column', paddingLeft: 4, paddingRight: 4 }}>
        <box style={{ height: 1 }} />
        <text content="Loading authentication..." style={{ fg: mutedFg }} />
      </box>
    );
  }

  if (!isAuthenticated) {
    return <DeviceLogin onLogin={() => {
      refreshAgent();
      setIsAuthenticated(true);
    }} />;
  }

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
            <text content="  choose a session, then press enter" style={{ fg: mutedFg }} />
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
          <text content="enter select - esc cancel - /new from input to create a session" style={{ fg: mutedFg }} />
        </box>
      ) : null}
      {modelPickerOpen ? (
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
            <Badge label="MODELS" bg={runBg} />
            <text content={`  choose a model (current: ${selectedModelId}), then press enter`} style={{ fg: mutedFg }} />
          </box>
          {modelsLoaded && modelOptions.length === 0 ? (
            <box style={{ width: '100%', flexDirection: 'column', paddingTop: 1, paddingBottom: 1 }}>
              <text content="  No models available from the catalog." style={{ fg: mutedFg }} />
              <text content="  Falling back to default model." style={{ fg: mutedFg }} />
            </box>
          ) : (
            <select
              focused
              options={modelOptions}
              selectedIndex={selectedModelIndex}
              showScrollIndicator
              wrapSelection
              style={{ width: '100%', height: modelSelectHeight }}
              onSelect={(_index, option) => {
                const modelId = typeof option?.value === 'string' ? option.value : undefined;
                if (modelId) {
                  void selectModel(modelId);
                }
              }}
            />
          )}
          <text content="enter select - esc cancel" style={{ fg: mutedFg }} />
        </box>
      ) : null}
      {hasTasks && !showSideTasks ? (
        <TaskListPanel tasks={tasks} sidePanel={false} terminalWidth={terminalWidth} />
      ) : null}
      <box style={{ width: '100%', flexGrow: 1, flexShrink: 1, flexBasis: 0, flexDirection: 'row' }}>
        <scrollbox
          focused={!anyPickerOpen}
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
      <box
        style={{
          width: '100%',
          height: 3,
          flexDirection: 'row',
          alignItems: 'center',
          flexShrink: 0,
          border: true,
          borderStyle: 'single',
          borderColor: inputBorderFg,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text content="> " style={{ fg: assistantMarkerFg, width: 2, flexShrink: 0 }} />
        <input
          focused={!anyPickerOpen}
          value={inputValue}
          placeholder={status === 'streaming' ? 'Wait for streaming to finish...' : 'Ask your question...'}
          onInput={setInputValue}
          onSubmit={handleSubmit}
          style={{
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 0,
            textColor: textFg,
            focusedTextColor: textFg,
            placeholderColor: mutedFg,
            cursorColor: assistantMarkerFg,
          }}
        />
        {status === 'streaming' ? <StreamingIndicator /> : null}
      </box>
      <box
        style={{
          width: '100%',
          height: 1,
          flexDirection: 'row',
          flexShrink: 0,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <text
          content={`${modelDisplayName}`}
          style={{ fg: assistantMarkerFg }}
        />
        {balance !== null ? (
          <text
            content={`  •  $${Number(balance).toFixed(2)}`}
            style={{ fg: assistantMarkerFg }}
          />
        ) : null}
      </box>
    </box>
  );
}
