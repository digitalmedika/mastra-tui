import { spawn } from 'node:child_process';
import { useKeyboard, usePaste, useTerminalDimensions } from '@opentui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearSession, getStoredSession } from '../auth/storage';
import { createPaymentTopUp, fetchCreditsMe, fetchPaymentStatus, fetchSessionMe } from '../auth/device';
import { useAgentStream } from '../hooks';
import { assistantMarkerFg, greenFg, inputBorderFg, mutedFg, redFg, runBg, textFg } from '../constants';
import { formatTokenCount, toSessionOption } from '../utils';
import { refreshAgent } from '../../mastra/agents/openai-compatible-agent';
import { checkVersion, type VersionCheckResult } from '../version-check';
import type { ApprovalEvent, ImageAttachment, StreamEvent } from '../types';
import { ApprovalOverlay } from './ApprovalOverlay';
import { Badge } from './Badge';
import { DeviceLogin } from './DeviceLogin';
import { StreamingIndicator } from './StreamingIndicator';
import { TaskListPanel } from './TaskListPanel';
import { StreamView } from './StreamView';
import { PaymentOverlay, PAYMENT_AMOUNTS, type PaymentData, type PaymentPhase } from './PaymentOverlay';
import pkg from '../../../package.json';
import { TextareaRenderable } from '@opentui/core';
import { SlashCommandSuggestion, filterSlashCommands, type SlashCommand } from './SlashCommandSuggestion';

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
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
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

  // Compute context token display from latest usage event or estimate from history
  const contextDisplay = useMemo(() => {
    const contextWindow = activeModel?.contextWindow;
    if (!contextWindow) return null;

    const barWidth = 10;

    const buildDisplay = (used: number, total: number, remaining: number) => {
      const ratio = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
      const filledCount = Math.round(ratio * barWidth);
      const emptyCount = barWidth - filledCount;
      const bar = `${'█'.repeat(filledCount)}${'░'.repeat(emptyCount)}`;
      return { bar, remaining, ratio, used, total };
    };

    // Find the latest usage event to get accurate API-reported token count
    const latestUsage = [...events].reverse().find((e): e is StreamEvent & { type: 'usage' } => e.type === 'usage');
    const usedTokens = latestUsage?.usage?.inputTokens;

    if (usedTokens !== undefined && usedTokens > 0) {
      const remaining = Math.max(0, contextWindow - usedTokens);
      return buildDisplay(usedTokens, contextWindow, remaining);
    }

    // No usage event yet — estimate from loaded history (text + assistant events)
    const historyChars = events.reduce((sum, e) => {
      if (e.type === 'text' || e.type === 'assistant') {
        return sum + e.text.length;
      }
      return sum;
    }, 0);

    if (historyChars > 0) {
      const estimated = Math.max(1, Math.round(historyChars / 4));
      const remaining = Math.max(0, contextWindow - estimated);
      return buildDisplay(estimated, contextWindow, remaining);
    }

    return buildDisplay(0, contextWindow, contextWindow);
  }, [activeModel?.contextWindow, events]);

  // Slash command suggestion state
  const [slashVisible, setSlashVisible] = useState(false);
  const [slashSuggestions, setSlashSuggestions] = useState<SlashCommand[]>([]);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);

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

  // Dismiss slash suggestions when any picker becomes open
  useEffect(() => {
    if (anyPickerOpen) {
      setSlashVisible(false);
      setSlashSuggestions([]);
    }
  }, [anyPickerOpen]);

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

    // Slash command suggestion keyboard navigation
    if (slashVisible) {
      if (key.name === 'up') {
        key.preventDefault();
        setSlashSelectedIndex((prev) => (prev > 0 ? prev - 1 : slashSuggestions.length - 1));
        return;
      }
      if (key.name === 'down') {
        key.preventDefault();
        setSlashSelectedIndex((prev) => (prev < slashSuggestions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (key.name === 'tab') {
        key.preventDefault();
        const selected = slashSuggestions[slashSelectedIndex];
        if (selected) {
          textareaRef.current?.setText(selected.insertText);
          setInputValue(selected.insertText);
          setSlashVisible(false);
        }
        return;
      }
      if (key.name === 'return') {
        key.preventDefault();
        const selected = slashSuggestions[slashSelectedIndex];
        if (selected) {
          textareaRef.current?.setText(selected.insertText);
          setInputValue(selected.insertText);
          setSlashVisible(false);
          // Auto-submit only when insertText equals command (no arguments to fill)
          if (selected.insertText === selected.command) {
            handleSubmit();
          }
        }
        return;
      }
      if (key.name === 'escape') {
        key.preventDefault();
        setSlashVisible(false);
        return;
      }
      // For any other key, dismiss but let textarea handle it
      const isPrintable = key.sequence && key.sequence.length > 0 && !key.ctrl && !key.meta && key.name.length === 1;
      if (!isPrintable) {
        // Non-printable keys not handled above → dismiss suggestions
        setSlashVisible(false);
      }
      // Let the key through to the textarea for printable chars (will trigger onContentChange)
      return;
    }

    if (key.name === 'escape') {
      if (imageAttachments.length > 0 && !modelPickerOpen && !sessionPickerOpen) {
        setImageAttachments([]);
        return;
      }
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

    // Backspace on empty input removes last attached image
    if (key.name === 'backspace' && imageAttachments.length > 0 && !inputValue) {
      setImageAttachments((prev) => prev.slice(0, -1));
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

  // Detect image paste from clipboard
  usePaste((event) => {
    const mimeType = event.metadata?.mimeType;
    if (!mimeType || !mimeType.startsWith('image/')) return;

    const visionSupported = activeModel?.supportsVision === true;
    if (!visionSupported) {
      // Silently ignore — model doesn't support vision
      return;
    }

    // Convert Uint8Array to base64 string
    // Terminal paste for images typically sends base64-encoded data
    const text = new TextDecoder().decode(event.bytes).trim();
    // Validate that it looks like base64
    const base64Regex = /^[A-Za-z0-9+/=]+$/;
    const base64Data = base64Regex.test(text) ? text : Buffer.from(event.bytes).toString('base64');

    const attachment: ImageAttachment = {
      id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      base64: base64Data,
      mediaType: mimeType,
      sizeBytes: event.bytes.length,
    };

    setImageAttachments((prev) => [...prev, attachment]);
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
      setImageAttachments([]);
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
        setImageAttachments([]);
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

    if (submitPrompt(value, imageAttachments.length > 0 ? imageAttachments : undefined)) {
      clearInput();
      setImageAttachments([]);
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
      <SlashCommandSuggestion
        suggestions={slashSuggestions}
        selectedIndex={slashSelectedIndex}
        visible={slashVisible}
      />
      {imageAttachments.length > 0 ? (
        <box
          style={{
            width: '100%',
            minHeight: 1,
            flexDirection: 'row',
            flexShrink: 0,
            paddingLeft: 3,
            paddingRight: 1,
          }}
        >
          <text
            content={`📎 ${imageAttachments.length} image${imageAttachments.length > 1 ? 's' : ''} attached`}
            style={{ fg: assistantMarkerFg }}
          />
          {imageAttachments.map((img) => {
            const sizeStr = img.sizeBytes >= 1024 * 1024
              ? `${(img.sizeBytes / (1024 * 1024)).toFixed(1)}MB`
              : img.sizeBytes >= 1024
                ? `${(img.sizeBytes / 1024).toFixed(1)}KB`
                : `${img.sizeBytes}B`;
            return (
              <text
                key={img.id}
                content={`  ${img.mediaType} (${sizeStr})`}
                style={{ fg: mutedFg }}
              />
            );
          })}
          <text
            content="  [Backspace dg input kosong = hapus]"
            style={{ fg: mutedFg }}
          />
        </box>
      ) : null}
      {!activeModel?.supportsVision && imageAttachments.length > 0 ? (
        <box
          style={{
            width: '100%',
            height: 1,
            flexDirection: 'row',
            flexShrink: 0,
            paddingLeft: 3,
            paddingRight: 1,
          }}
        >
          <text
            content="⚠️  Model ini tidak mendukung vision. Gambar akan diabaikan."
            style={{ fg: '#FFD700' }}
          />
        </box>
      ) : null}
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
          onContentChange={() => {
            const text = textareaRef.current?.plainText ?? '';
            const suggestions = filterSlashCommands(text, status);
            if (suggestions.length > 0) {
              setSlashSuggestions(suggestions);
              setSlashSelectedIndex(0);
              setSlashVisible(true);
            } else {
              setSlashVisible(false);
              setSlashSuggestions([]);
            }
            setInputValue(text);
          }}
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
        {contextDisplay ? (
          <text
            content={`  ${contextDisplay.bar} ${formatTokenCount(contextDisplay.remaining)} ctx`}
            style={{
              fg:
                contextDisplay.ratio > 0.8 ? redFg
                : contextDisplay.ratio > 0.5 ? '#FFD700'
                : greenFg,
            }}
          />
        ) : null}
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
