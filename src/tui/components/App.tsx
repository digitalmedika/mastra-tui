import { spawn } from 'node:child_process';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearSession, getStoredSession } from '../auth/storage';
import { createPaymentTopUp, fetchCreditsMe, fetchPaymentStatus, fetchSessionMe } from '../auth/device';
import { useAgentStream } from '../hooks';
import { assistantMarkerFg, greenFg, inputBorderFg, mutedFg, redFg, runBg, textFg } from '../constants';
import { toSessionOption } from '../utils';
import { refreshAgent } from '../../mastra/agents/openai-compatible-agent';
import { checkVersion, type VersionCheckResult } from '../version-check';
import type { ApprovalEvent, StreamEvent } from '../types';
import { ApprovalOverlay } from './ApprovalOverlay';
import { Badge } from './Badge';
import { DeviceLogin } from './DeviceLogin';
import { StreamingIndicator } from './StreamingIndicator';
import { TaskListPanel } from './TaskListPanel';
import { StreamView } from './StreamView';
import { PaymentOverlay, PAYMENT_AMOUNTS, type PaymentData, type PaymentPhase } from './PaymentOverlay';
import pkg from '../../../package.json';
import { TextareaRenderable } from '@opentui/core';

const hasPositiveBalance = (value: string | null) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0;
};

const getPendingApprovalEvent = (events: StreamEvent[]): ApprovalEvent | null => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === 'approval' && event.status === 'pending') return event;
  }
  return null;
};

export function App({ onExit }: { onExit: () => void }) {
  const {
    events,
    tasks,
    status,
    currentSession,
    sessions,
    sessionPickerOpen,
    submitPrompt,
    respondToApproval,
    allowExternalPath,
    showAllowedExternalPaths,
    clearMemory,
    createSession,
    openSessionPicker,
    closeSessionPicker,
    selectSession,
    models,
    selectedModelId,
    modelPickerOpen,
    modelsLoaded,
    modelsLoading,
    openModelPicker,
    closeModelPicker,
    selectModel,
  } = useAgentStream();
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<TextareaRenderable>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [paymentOverlayOpen, setPaymentOverlayOpen] = useState(false);
  const [paymentPhase, setPaymentPhase] = useState<PaymentPhase>('select');
  const [paymentSelectedIndex, setPaymentSelectedIndex] = useState(0);
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [versionResult, setVersionResult] = useState<VersionCheckResult | null>(null);
  const [approvalSelectedIndex, setApprovalSelectedIndex] = useState(0);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const { width: terminalWidth } = useTerminalDimensions();
  const hasTasks = tasks.length > 0;
  const showSideTasks = hasTasks && terminalWidth >= 132;
  const pendingApprovalEvent = getPendingApprovalEvent(events);
  const approvalOverlayOpen = status === 'awaiting-approval' && pendingApprovalEvent !== null;
  const sessionOptions = sessions.map(toSessionOption);
  const lastCtrlCPressRef = useRef(0);
  const exitHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showExitHint, setShowExitHint] = useState(false);
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
  const anyPickerOpen = sessionPickerOpen || modelPickerOpen || paymentOverlayOpen || approvalOverlayOpen;
  const activeModel = models.find((m) => m.publicModelId === selectedModelId);
  const modelDisplayName = activeModel ? activeModel.name : selectedModelId;

  const refreshBalance = useCallback(async () => {
    const session = getStoredSession();
    if (!session) return null;

    const res = await fetchCreditsMe(session.token);
    setBalance(res.data.balance);
    return res.data.balance;
  }, []);

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
    checkVersion(pkg.version).then(setVersionResult).catch(() => setVersionResult(null));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshBalance()
      .catch((err) => console.error('[Balance] Failed to fetch:', err));
  }, [isAuthenticated, refreshBalance]);

  useEffect(() => {
    if (approvalOverlayOpen) {
      setApprovalSelectedIndex(0);
      setApprovalSubmitting(false);
      return;
    }

    setApprovalSubmitting(false);
  }, [approvalOverlayOpen, pendingApprovalEvent?.id]);

  // Refresh balance after each streaming request completes
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    if ((prev === 'streaming' || prev === 'awaiting-approval') && (status === 'finished' || status === 'error')) {
      refreshBalance()
        .catch((err) => console.error('[Balance] Failed to refresh after stream:', err));
    }
  }, [refreshBalance, status]);

  useEffect(() => {
    if (!paymentOverlayOpen || paymentPhase !== 'ready') return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const pollBalance = async () => {
      try {
        const session = getStoredSession();
        const paymentStatus =
          session && paymentData?.orderId
            ? await fetchPaymentStatus(session.token, paymentData.orderId)
            : null;
        const latestBalance = await refreshBalance();
        if (cancelled) return;

        if (paymentStatus?.data.status === 'failed') {
          setPaymentError('Pembayaran gagal atau kedaluwarsa. Silakan coba lagi.');
          setPaymentPhase('error');
          return;
        }

        if (paymentStatus?.data.status === 'success' || hasPositiveBalance(latestBalance)) {
          setPaymentOverlayOpen(false);
          setPaymentPhase('select');
          setPaymentSelectedIndex(0);
          setPaymentData(null);
          setPaymentError(null);

          if (pendingPrompt && status !== 'streaming' && status !== 'awaiting-approval') {
            if (submitPrompt(pendingPrompt)) {
              clearInput();
            }
            setPendingPrompt(null);
          }
          return;
        }
      } catch (err) {
        console.error('[Balance] Failed to poll after payment:', err);
      }

      if (!cancelled) {
        timeout = setTimeout(pollBalance, 2000);
      }
    };

    timeout = setTimeout(pollBalance, 1000);

    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [paymentData, paymentOverlayOpen, paymentPhase, pendingPrompt, refreshBalance, status, submitPrompt]);

  const handleApprovalDecision = useCallback(async (approved: boolean) => {
    if (!approvalOverlayOpen || approvalSubmitting) return;

    setApprovalSubmitting(true);
    const ok = await respondToApproval(approved);
    if (!ok) setApprovalSubmitting(false);
  }, [approvalOverlayOpen, approvalSubmitting, respondToApproval]);

  useKeyboard((key) => {
    // Payment overlay keyboard navigation
    if (paymentOverlayOpen) {
      if (key.name === 'up') {
        setPaymentSelectedIndex((prev) => (prev > 0 ? prev - 1 : PAYMENT_AMOUNTS.length - 1));
        return;
      }
      if (key.name === 'down') {
        setPaymentSelectedIndex((prev) => (prev < PAYMENT_AMOUNTS.length - 1 ? prev + 1 : 0));
        return;
      }
      if (key.name === 'return') {
        if (paymentPhase === 'select') {
          void handlePaymentSelect(PAYMENT_AMOUNTS[paymentSelectedIndex].value);
        } else if (paymentPhase === 'ready' && paymentData) {
          const url = paymentData.redirectUrl ?? paymentData.qrCodeUrl;
          if (url) openUrl(url);
        } else if (paymentPhase === 'error') {
          resetPaymentOverlay();
        }
        return;
      }
      if (key.name === 'escape') {
        resetPaymentOverlay();
        return;
      }
      return;
    }

    if (approvalOverlayOpen) {
      if (key.name === 'left' || key.name === 'up') {
        setApprovalSelectedIndex(0);
        return;
      }
      if (key.name === 'right' || key.name === 'down' || key.name === 'tab') {
        setApprovalSelectedIndex(1);
        return;
      }
      if (key.name === 'return') {
        void handleApprovalDecision(approvalSelectedIndex === 0);
        return;
      }
      if (key.name === 'a' || key.name === 'y') {
        setApprovalSelectedIndex(0);
        void handleApprovalDecision(true);
        return;
      }
      if (key.name === 'd' || key.name === 'n' || key.name === 'escape') {
        setApprovalSelectedIndex(1);
        void handleApprovalDecision(false);
        return;
      }
      return;
    }

    if (key.name === 'escape') {
      if (modelPickerOpen) {
        closeModelPicker();
        return;
      }
      if (sessionPickerOpen) {
        closeSessionPicker();
        return;
      }
      return;
    }

    // Ctrl+C double press to exit
    if (key.name === 'c' && key.ctrl) {
      const now = Date.now();
      if (lastCtrlCPressRef.current > 0 && now - lastCtrlCPressRef.current < 1500) {
        onExit();
        return;
      }
      lastCtrlCPressRef.current = now;
      setShowExitHint(true);
      if (exitHintTimeoutRef.current) {
        clearTimeout(exitHintTimeoutRef.current);
      }
      exitHintTimeoutRef.current = setTimeout(() => {
        setShowExitHint(false);
        lastCtrlCPressRef.current = 0;
      }, 1500);
      return;
    }
  });

  const resetPaymentOverlay = useCallback(() => {
    setPaymentOverlayOpen(false);
    setPaymentPhase('select');
    setPaymentSelectedIndex(0);
    setPaymentData(null);
    setPaymentError(null);
    setPendingPrompt(null);
  }, []);

  const clearInput = useCallback(() => {
    textareaRef.current?.setText('');
    setInputValue('');
  }, []);

  const openUrl = useCallback((url: string) => {
    const cmd =
      process.platform === 'darwin'
        ? ['open', url]
        : process.platform === 'win32'
          ? ['cmd', '/c', 'start', '', url]
          : ['xdg-open', url];
    const child = spawn(cmd[0], cmd.slice(1), {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }, []);

  const handlePaymentSelect = useCallback(async (amountIdr: number) => {
    setPaymentPhase('loading');
    setPaymentError(null);

    try {
      const session = getStoredSession();
      if (!session) throw new Error('No active session');

      const result = await createPaymentTopUp(session.token, amountIdr);
      setPaymentData(result.data);
      setPaymentPhase('ready');

      // Refresh balance after successful payment creation
      fetchCreditsMe(session.token)
        .then((res) => setBalance(res.data.balance))
        .catch((err) => console.error('[Balance] Failed to refresh:', err));
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : String(err));
      setPaymentPhase('error');
    }
  }, []);

  const handleSubmit = () => {
    const value = textareaRef.current?.plainText;
    if (typeof value !== 'string') return;

    const trimmedValue = value.trim();

    // If payment overlay is open, ignore text input
    if (paymentOverlayOpen) return;

    const canStartAction = status !== 'streaming' && status !== 'awaiting-approval';

    if (trimmedValue === '/approve' && status === 'awaiting-approval') {
      clearInput();
      void respondToApproval(true);
      return;
    }

    if ((trimmedValue === '/deny' || trimmedValue === '/reject') && status === 'awaiting-approval') {
      clearInput();
      void respondToApproval(false);
      return;
    }

    if (trimmedValue === '/clear' && canStartAction) {
      clearInput();
      void clearMemory();
      return;
    }

    if (trimmedValue === '/sessions' && canStartAction) {
      clearInput();
      void openSessionPicker();
      return;
    }

    if (trimmedValue === '/model' && canStartAction) {
      clearInput();
      void openModelPicker();
      return;
    }

    if (trimmedValue === '/allow' && canStartAction) {
      clearInput();
      showAllowedExternalPaths();
      return;
    }

    if (trimmedValue.startsWith('/allow ') && canStartAction) {
      const targetPath = trimmedValue.slice('/allow'.length).trim();
      clearInput();
      allowExternalPath(targetPath);
      return;
    }

    if (trimmedValue === '/new' || trimmedValue.startsWith('/new ')) {
      if (canStartAction) {
        const title = trimmedValue.slice('/new'.length).trim();
        clearInput();
        void createSession(title || undefined);
      }
      return;
    }

    if (trimmedValue === '/logout') {
      clearInput();
      clearSession();
      setIsAuthenticated(false);
      return;
    }

    // Check balance before submitting a regular prompt
    if (canStartAction && !trimmedValue.startsWith('/')) {
      const balanceNum = Number(balance);
      if (balance !== null && Number.isFinite(balanceNum) && balanceNum <= 0) {
        setPendingPrompt(value);
        setPaymentOverlayOpen(true);
        setPaymentPhase('select');
        setPaymentSelectedIndex(0);
        setPaymentData(null);
        setPaymentError(null);
        return;
      }
    }

    if (submitPrompt(value)) {
      clearInput();
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
          {modelsLoading ? (
            <box style={{ width: '100%', paddingTop: 1, paddingBottom: 1 }}>
              <StreamingIndicator />
              <text content="  Loading models from catalog..." style={{ fg: mutedFg }} />
            </box>
          ) : modelsLoaded && modelOptions.length === 0 ? (
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
      {paymentOverlayOpen ? (
        <PaymentOverlay
          phase={paymentPhase}
          selectedIndex={paymentSelectedIndex}
          paymentData={paymentData}
          error={paymentError}
        />
      ) : null}
      {approvalOverlayOpen && pendingApprovalEvent ? (
        <ApprovalOverlay
          event={pendingApprovalEvent}
          selectedIndex={approvalSelectedIndex}
          submitting={approvalSubmitting}
        />
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
          minHeight: 3,
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
        <textarea
          ref={textareaRef}
          focused={!anyPickerOpen}
          placeholder={
            paymentOverlayOpen
              ? 'Pilih nominal top-up terlebih dahulu...'
              : status === 'awaiting-approval'
                ? 'Gunakan approval overlay, atau ketik /approve /deny sebagai fallback...'
                : status === 'streaming'
                  ? 'Wait for streaming to finish...'
                  : 'Ask your question...'
          }
          wrapMode="word"
          minHeight={1}
          maxHeight={6}
          keyBindings={[
            { name: 'return', action: 'submit' },
            { name: 'kpenter', action: 'submit' },
            { name: 'return', shift: true, action: 'newline' },
            { name: 'kpenter', shift: true, action: 'newline' },
          ]}
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
      {showExitHint ? (
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
            content="Press Ctrl+C again to exit"
            style={{ fg: '#FFD700' }}
          />
        </box>
      ) : null}
      {versionResult?.hasUpdate && versionResult.latest ? (
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
            content={`Update tersedia: v${versionResult.current} → v${versionResult.latest}. Jalankan "npm i -g loccle@latest" untuk update.`}
            style={{ fg: '#FFD700' }}
          />
        </box>
      ) : null}
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
        <box style={{ flexGrow: 1 }} />
        <text content="▄▄▄" style={{ fg: '#FFFFFF', bg: '#CE1126' }} />
      </box>
    </box>
  );
}
