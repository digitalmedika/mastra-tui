import { useCallback, useEffect, useRef, useState } from 'react';
import { RequestContext } from '@mastra/core/request-context';
import { TASK_STATE_TYPE } from '@mastra/core/tools';
import { mastra } from '../../mastra';
import { getCurrentModelId, openAICompatibleAgent, setModelIdAndRefresh } from '../../mastra/agents/openai-compatible-agent';
import {
  allowExternalWorkspacePath,
  allowedExternalWorkspacePathsKey,
  getAllowedExternalWorkspacePaths,
  isPathWithinAllowedRoots,
  normalizeWorkspacePath,
  workspacePathKey,
} from '../../workspace';
import { agentMaxSteps, defaultSession, defaultSessionId, tuiResourceId, workspacePath } from '../constants';
import { fetchModels, getCachedModels, initModelStore, setSelectedModelId, type CatalogModel } from '../model-store';
import { fetchLatestBackendTokenUsageSince } from '../usage-store';
import {
  createEditEvent,
  createExploreChildEvent,
  createExploreEvent,
  createReadEvent,
  createShellEvent,
  createTaskListEvent,
  isExploreTool,
  isShellTool,
  isTaskListToolName,
} from '../event-factories';
import type { ApprovalEvent, ExploreChildEvent, ExploreEvent, ImageAttachment, RunEvent, ShellEvent, StreamEvent, StreamRequest, StreamStatus, TaskItem, TokenUsage, ToolCardEvent, ToolPayload, TuiSession } from '../types';
import { estimateTokens, getSessionTitle, getStringField, getToolErrorMessage, normalizeTokenUsage } from '../utils';

const extractMemoryMessageText = (content: unknown) => {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .filter((part) => typeof part === 'object' && part !== null && !Array.isArray(part) && part.type === 'text' && typeof part.text === 'string')
      .map((part) => (part as { text: string }).text)
      .join('\n');
  }

  if (!content || typeof content !== 'object' || Array.isArray(content)) return '';

  const record = content as Record<string, unknown>;
  const directText = getStringField(record, ['content', 'text']);
  if (directText) return directText;

  const parts = record.parts;
  if (!Array.isArray(parts)) return '';

  return parts
    .filter((part) => typeof part === 'object' && part !== null && !Array.isArray(part) && part.type === 'text' && typeof part.text === 'string')
    .map((part) => (part as { text: string }).text)
    .join('\n');
};

const asArgsRecord = (args: unknown) => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  return args as Record<string, unknown>;
};

const getArgString = (args: unknown, keys: string[]) => {
  const record = asArgsRecord(args);
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
};

const summarizeArgs = (args: unknown) => {
  const record = asArgsRecord(args);
  if (!record) return '';
  const entries = Object.entries(record)
    .filter(([key]) => !['content', 'newContent', 'oldContent', 'replacement', 'old_string', 'new_string'].includes(key))
    .slice(0, 4)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return entries.length > 0 ? ` (${entries.join(', ')})` : '';
};

const cleanTaskText = (text: string) => text.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();

const taskRecordListFrom = (source: unknown): Record<string, unknown>[] | undefined => {
  if (Array.isArray(source)) {
    return source.map(asArgsRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  }

  const record = asArgsRecord(source);

  // Handle JSON-encoded string results from Mastra tools
  if (!record && typeof source === 'string') {
    try {
      const parsed = JSON.parse(source);
      return taskRecordListFrom(parsed);
    } catch {
      return undefined;
    }
  }

  if (!record) return undefined;
  if (Array.isArray(record.tasks)) {
    return record.tasks.map(asArgsRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  }

  for (const key of ['result', 'output', 'value', 'data', 'payload']) {
    const nested = taskRecordListFrom(record[key]);
    if (nested) return nested;
  }

  const content = record.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      const nested = taskRecordListFrom(part);
      if (nested) return nested;
    }
  }

  // Handle string content that might be JSON
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      const fromParsed = taskRecordListFrom(parsed);
      if (fromParsed) return fromParsed;
    } catch {
      // not JSON, ignore
    }
  }

  return undefined;
};

const extractTaskRecords = (payload: ToolPayload, fallbackPayload?: ToolPayload): Record<string, unknown>[] | undefined => {
  return (
    taskRecordListFrom(payload.result) ??
    taskRecordListFrom(fallbackPayload?.result) ??
    taskRecordListFrom(payload.args) ??
    taskRecordListFrom(fallbackPayload?.args) ??
    taskRecordListFrom(payload)
  );
};

const parseToolInputArgs = (argsText: string): Record<string, unknown> | undefined => {
  try {
    return asArgsRecord(JSON.parse(argsText));
  } catch {
    return undefined;
  }
};

const taskRecordsToItems = (taskRecords: Record<string, unknown>[]): TaskItem[] => {
  return taskRecords
    .map((record, index) => {
      const text =
        (typeof record.content === 'string' ? cleanTaskText(record.content) : '') ||
        (typeof record.activeForm === 'string' ? cleanTaskText(record.activeForm) : '') ||
        (typeof record.title === 'string' ? cleanTaskText(record.title) : '');
      const st = typeof record.status === 'string' ? record.status : 'pending';
      const id = typeof record.id === 'string' ? record.id : typeof record.id === 'number' ? String(record.id) : undefined;
      return { ...(id ? { id } : {}), index: index + 1, text, done: st === 'completed', current: st === 'in_progress' };
    })
    .filter((item): item is TaskItem => Boolean(item && item.text));
};

const findTaskPatchArgs = (payload: ToolPayload, fallbackPayload?: ToolPayload) => {
  return asArgsRecord(payload.args) ?? asArgsRecord(fallbackPayload?.args);
};

const readStoredTaskItems = async (threadId: string): Promise<TaskItem[] | undefined> => {
  const taskStore = await mastra.getStorage()?.getStore('threadState');
  const storedTasks = await taskStore?.getState({ threadId, type: TASK_STATE_TYPE });
  const taskRecords = taskRecordListFrom(storedTasks);
  if (!taskRecords) return undefined;

  const nextTasks = taskRecordsToItems(taskRecords);
  return nextTasks.length > 0 ? nextTasks : undefined;
};

const deleteStoredTaskItems = async (threadId: string) => {
  const taskStore = await mastra.getStorage()?.getStore('threadState');
  await taskStore?.deleteState({ threadId, type: TASK_STATE_TYPE });
};

type ApprovalResume = (approved: boolean) => Promise<boolean>;

const buildTaskContext = (tasks: TaskItem[]) => {
  if (tasks.length === 0) return undefined;

  const completedTasks = tasks.filter((task) => task.done).length;
  const allCompleted = completedTasks === tasks.length;
  const taskLines = tasks
    .map((task) => {
      const status = task.done ? 'completed' : task.current ? 'in_progress' : 'pending';
      return `- ${task.index}. [${status}] ${task.text}`;
    })
    .join('\n');

  if (allCompleted) {
    return `Previous visible TUI checklist state (all completed):
${taskLines}

Treat this as historical context for the same session. Do not continue or re-open this checklist unless the user explicitly asks about it. For a new non-trivial request, create a fresh checklist with task_write.`;
  }

  return `Current visible TUI checklist state (unfinished):
${taskLines}

Treat this checklist as active and authoritative when the user asks about task progress or completion.
Do not say all tasks are complete unless every visible checklist item is completed.
If the user is following up on this work, continue from the unfinished checklist and call task_update or task_complete before claiming progress.
If the user clearly changes to a new unrelated task, replace the checklist with task_write for the new task.`;
};

const pathArgKeys = ['path', 'filePath', 'filepath', 'file', 'targetPath', 'target', 'directory', 'dir', 'cwd', 'basePath'];

const getToolPathForApproval = (args: unknown) => {
  const pathValue = getArgString(args, pathArgKeys);
  if (!pathValue?.startsWith('/') && !pathValue?.startsWith('~/') && pathValue !== '~') {
    return undefined;
  }

  return normalizeWorkspacePath(pathValue);
};

export function useAgentStream() {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [request, setRequest] = useState<StreamRequest | null>(null);
  const nextLineIdRef = useRef(0);
  const approvalResumeRef = useRef<ApprovalResume | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [currentSession, setCurrentSession] = useState<TuiSession>(defaultSession);
  const [sessions, setSessions] = useState<TuiSession[]>([defaultSession]);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [selectedModelId, setSelectedModelIdState] = useState<string>(() => getCurrentModelId());
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Initialize model store on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const modelId = await initModelStore();
      if (cancelled) return;
      setSelectedModelIdState(modelId);
      setModels(getCachedModels());
      setModelsLoaded(true);
      // If the initial model from the store differs from what the agent has, refresh the agent
      if (modelId !== getCurrentModelId()) {
        setModelIdAndRefresh(modelId);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const memory = await openAICompatibleAgent.getMemory();
      if (!memory) {
        const fallback = [currentSession];
        setSessions(fallback);
        return fallback;
      }

      const result = await memory.listThreads({
        filter: { resourceId: tuiResourceId },
        perPage: false,
        orderBy: { field: 'updatedAt', direction: 'DESC' },
      });
      const loadedSessions = (result?.threads ?? []).map((thread) => ({
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        metadata: thread.metadata,
      }));
      const hasCurrentSession = loadedSessions.some((session) => session.id === currentSession.id);
      const nextSessions = hasCurrentSession ? loadedSessions : [currentSession, ...loadedSessions];

      setSessions(nextSessions);
      return nextSessions;
    } catch (error) {
      console.error('[Sessions] Failed to refresh sessions:', error);
      const fallback = [currentSession];
      setSessions(fallback);
      return fallback;
    }
  }, [currentSession]);

  // Load chat history when the active session changes.
  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      setHistoryLoaded(false);
      setRequest(null);
      setTasks([]);
      setStatus('idle');
      setEvents([]);
      nextLineIdRef.current = 0;

      try {
        const memory = await openAICompatibleAgent.getMemory();
        if (!memory) {
          if (!cancelled) setHistoryLoaded(true);
          return;
        }

        const result = await memory.recall({
          threadId: currentSession.id,
          resourceId: tuiResourceId,
          perPage: false,
        });

        if (cancelled) return;
        if (!result?.messages?.length) {
          setHistoryLoaded(true);
          return;
        }

        const historyEvents: StreamEvent[] = [];
        let lineId = 0;

        for (const msg of result.messages) {
          const textContent = extractMemoryMessageText(msg.content);
          if (!textContent.trim()) continue;

          if (msg.role === 'user') {
            historyEvents.push({ id: lineId++, type: 'text', text: `> ${textContent}` });
          } else if (msg.role === 'assistant') {
            historyEvents.push({ id: lineId++, type: 'assistant', text: textContent });
          }
        }

        if (historyEvents.length > 0) {
          historyEvents.unshift({
            id: lineId++,
            type: 'text',
            text: `Chat history dimuat dari ${getSessionTitle(currentSession)}\n`,
          });
          setEvents(historyEvents);
          nextLineIdRef.current = lineId;
        }

        setHistoryLoaded(true);
      } catch (error) {
        console.error('[History] Failed to load history:', error);
        setHistoryLoaded(true);
      }
    };

    void loadHistory();
    return () => { cancelled = true; };
  }, [currentSession]);

  useEffect(() => {
    if (!historyLoaded || !request) return;

    let cancelled = false;
    let activeResponseLineId: number | null = null;
    let assistantText = '';
    let currentTaskIndex: number | null = null;
    let hasStructuredTaskList = false;
    const toolDescriptions = new Map<string, string>();
    const toolPayloads = new Map<string, ToolPayload>();
    const toolStartedAt = new Map<string, number>();
    const streamingToolNames = new Map<string, string>();
    const streamingToolInput = new Map<string, string>();
    const activeToolLines = new Map<number, string>();
    const activeToolLineByCallId = new Map<string, number>();
    const pendingToolLineByName = new Map<string, number>();
    const spinnerFrames = ['|', '/', '-', '\\'];
    let spinnerFrameIndex = 0;
    let activeExploreEventId: number | null = null;
    let finalTokenUsage: TokenUsage | undefined;

    // ----- inlined helpers that close over mutable refs -----

    const getToolLabel = (toolName: string | undefined): string => {
      switch (toolName) {
        case 'task_write': return 'TASK';
        case 'task_update': return 'TASK';
        case 'task_complete': return 'TASK';
        case 'task_check': return 'CHECK';
        case 'mastra_workspace_read_file': return 'READ';
        case 'readManyFiles': return 'READ';
        case 'mastra_workspace_write_file': return 'WRITE';
        case 'mastra_workspace_edit_file': return 'EDIT';
        case 'mastra_workspace_list_files': return 'LIST';
        case 'mastra_workspace_delete': return 'DELETE';
        case 'mastra_workspace_file_stat': return 'STAT';
        case 'mastra_workspace_mkdir': return 'MKDIR';
        case 'mastra_workspace_grep': return 'GREP';
        case 'mastra_workspace_shell':
        case 'mastra_workspace_execute_command': return 'SHELL';
        default: return 'TOOL';
      }
    };

    const describeTool = (payload: ToolPayload) => {
      const toolName = payload.toolName ?? 'unknown';
      const args = payload.args;
      const path = getArgString(args, ['path', 'filePath', 'filepath', 'file', 'targetPath', 'target']);
      const directory = getArgString(args, ['directory', 'dir', 'cwd', 'basePath']) ?? path ?? '.';
      const command = getArgString(args, ['cmd', 'command', 'script']);
      const pattern = getArgString(args, ['pattern', 'query', 'search']);

      switch (toolName) {
        case 'task_write': {
          const record = asArgsRecord(args);
          const tasks = Array.isArray(record?.tasks) ? record.tasks : [];
          return `updating checklist (${tasks.length} tasks)`;
        }
        case 'task_update': {
          const record = asArgsRecord(args);
          return `updating checklist task ${String(record?.id ?? '?')}`;
        }
        case 'task_complete': {
          const record = asArgsRecord(args);
          return `completing checklist task ${String(record?.id ?? '?')}`;
        }
        case 'task_check': {
          return 'checking checklist completion';
        }
        case 'mastra_workspace_read_file': return `reading file ${(path ?? summarizeArgs(args)) || '(path unavailable)'}`;
        case 'readManyFiles': {
          const record = asArgsRecord(args);
          const paths = Array.isArray(record?.paths) ? record.paths.filter((item) => typeof item === 'string') : [];
          return `reading ${paths.length || 'multiple'} files`;
        }
        case 'mastra_workspace_write_file': return `writing file ${(path ?? summarizeArgs(args)) || '(path unavailable)'}`;
        case 'mastra_workspace_edit_file': return `editing file ${(path ?? summarizeArgs(args)) || '(path unavailable)'}`;
        case 'mastra_workspace_list_files': return `listing files in ${directory}${summarizeArgs(args)}`;
        case 'mastra_workspace_delete': return `deleting ${(path ?? summarizeArgs(args)) || '(path unavailable)'}`;
        case 'mastra_workspace_file_stat': return `checking metadata ${(path ?? summarizeArgs(args)) || '(path unavailable)'}`;
        case 'mastra_workspace_mkdir': return `creating directory ${(path ?? summarizeArgs(args)) || '(path unavailable)'}`;
        case 'mastra_workspace_grep': return `searching text ${pattern ? `"${pattern}"` : '(pattern unavailable)'} in ${path ?? '.'}${summarizeArgs(args)}`;
        case 'mastra_workspace_shell':
        case 'mastra_workspace_execute_command': return `running shell ${(command ?? summarizeArgs(args)) || '(command unavailable)'}${directory ? ` in ${directory}` : ''}`;
        default: return `${toolName}${summarizeArgs(args)}`;
      }
    };

    const applyTaskListTool = (payload: ToolPayload, fallbackPayload?: ToolPayload) => {
      const toolName = payload.toolName ?? fallbackPayload?.toolName;
      if (!isTaskListToolName(toolName)) return;

      hasStructuredTaskList = true;

      const taskRecords = extractTaskRecords(payload, fallbackPayload);
      if (taskRecords) {
        const nextTasks = taskRecordsToItems(taskRecords);
        if (nextTasks.length > 0) {
          setTasks(nextTasks);
          currentTaskIndex = nextTasks.find((task) => task.current)?.index ?? null;
          return;
        }
      }

      if (toolName !== 'task_update' && toolName !== 'task_complete') return;
      const args = findTaskPatchArgs(payload, fallbackPayload);
      const id = typeof args?.id === 'string' ? args.id : typeof args?.id === 'number' ? String(args.id) : undefined;
      if (!id) return;

      setTasks((current) => {
        let changed = false;

        const next = current.map((task) => {
          const matches =
            task.id === id ||
            String(task.index) === id ||
            // Also try matching by index when the id parses as an integer
            String(task.index) === String(parseInt(id, 10));

          if (!matches) {
            return toolName === 'task_update' && args?.status === 'in_progress' ? { ...task, current: false } : task;
          }

          changed = true;
          const status = toolName === 'task_complete' ? 'completed' : typeof args?.status === 'string' ? args.status : undefined;
          const text = typeof args?.content === 'string' ? cleanTaskText(args.content) : task.text;
          return {
            ...task,
            text,
            done: status === 'completed' ? true : status === 'pending' || status === 'in_progress' ? false : task.done,
            current: status === 'in_progress' ? true : status === 'completed' || status === 'pending' ? false : task.current,
          };
        });

        // If still no match, try fallback heuristics (works even when tasks have mismatched IDs)
        if (!changed && toolName === 'task_complete') {
          // Find the current in_progress task and complete it
          const inProgressIndex = current.findIndex((task) => task.current);
          if (inProgressIndex >= 0) {
            const nextTasks = current.map((task, i) =>
              i === inProgressIndex ? { ...task, done: true, current: false } : task,
            );
            changed = true;
            currentTaskIndex = nextTasks.find((task) => task.current)?.index ?? null;
            return nextTasks;
          }
          // If no in_progress task, complete the first pending task
          const pendingIndex = current.findIndex((task) => !task.done && !task.current);
          if (pendingIndex >= 0) {
            const nextTasks = current.map((task, i) =>
              i === pendingIndex ? { ...task, done: true, current: false } : task,
            );
            changed = true;
            currentTaskIndex = nextTasks.find((task) => task.current)?.index ?? null;
            return nextTasks;
          }
        }

        if (!changed && toolName === 'task_update' && args?.status === 'in_progress') {
          // Find the first pending task and mark it in_progress
          const pendingIndex = current.findIndex((task) => !task.done && !task.current);
          if (pendingIndex >= 0) {
            const nextTasks = current.map((task, i) =>
              i === pendingIndex
                ? { ...task, current: true, done: false }
                : { ...task, current: false },
            );
            changed = true;
            currentTaskIndex = nextTasks.find((task) => task.current)?.index ?? null;
            return nextTasks;
          }
        }

        if (!changed) return current;
        currentTaskIndex = next.find((task) => task.current)?.index ?? null;
        return next;
      });
      return;
    };

    const applyHarnessEvent = (event: unknown) => {
      let record = asArgsRecord(event);

      // Handle JSON-encoded string events
      if (!record && typeof event === 'string') {
        try {
          record = asArgsRecord(JSON.parse(event));
        } catch {
          return;
        }
      }

      if (record?.type !== 'task_updated') return;
      const taskRecords = Array.isArray(record.tasks)
        ? record.tasks.map(asArgsRecord).filter((item): item is Record<string, unknown> => Boolean(item))
        : [];
      hasStructuredTaskList = true;
      const nextTasks = taskRecordsToItems(taskRecords);
      if (nextTasks.length === 0) return;
      setTasks(nextTasks);
      currentTaskIndex = nextTasks.find((task) => task.current)?.index ?? null;
    };

    const rememberStreamingToolInputStart = (payload: ToolPayload) => {
      if (!payload.toolCallId || !payload.toolName) return;
      streamingToolNames.set(payload.toolCallId, payload.toolName);
      streamingToolInput.set(payload.toolCallId, '');
    };

    const appendStreamingToolInput = (payload: ToolPayload & { argsTextDelta?: unknown }) => {
      if (!payload.toolCallId || typeof payload.argsTextDelta !== 'string') return;
      streamingToolInput.set(payload.toolCallId, `${streamingToolInput.get(payload.toolCallId) ?? ''}${payload.argsTextDelta}`);
    };

    const finalizeStreamingToolInput = (payload: ToolPayload) => {
      if (!payload.toolCallId) return;
      const toolName = streamingToolNames.get(payload.toolCallId);
      const argsText = streamingToolInput.get(payload.toolCallId);
      streamingToolInput.delete(payload.toolCallId);
      streamingToolNames.delete(payload.toolCallId);
      if (!toolName || !argsText) return;

      const args = parseToolInputArgs(argsText);
      if (!args) return;

      const toolPayload = { ...payload, toolName, args };
      toolPayloads.set(payload.toolCallId, toolPayload);
      applyTaskListTool(toolPayload);
    };

    const mergeTokenUsage = (base: TokenUsage | undefined, next: TokenUsage | undefined): TokenUsage | undefined => {
      if (!base) return next;
      if (!next) return base;
      return {
        inputTokens: next.inputTokens ?? base.inputTokens,
        outputTokens: next.outputTokens ?? base.outputTokens,
        totalTokens: next.totalTokens ?? base.totalTokens,
        cacheReadTokens: next.cacheReadTokens ?? base.cacheReadTokens,
        cacheWriteTokens: next.cacheWriteTokens ?? base.cacheWriteTokens,
        cachedInputTokens: next.cachedInputTokens ?? base.cachedInputTokens,
        estimated: next.estimated ?? base.estimated,
      };
    };

    const hasVisibleTokenUsage = (usage: TokenUsage | undefined) => {
      if (!usage) return false;
      return (
        (usage.inputTokens !== undefined && usage.inputTokens > 0) ||
        (usage.outputTokens !== undefined && usage.outputTokens > 0) ||
        (usage.totalTokens !== undefined && usage.totalTokens > 0) ||
        (usage.cacheReadTokens !== undefined && usage.cacheReadTokens > 0) ||
        (usage.cacheWriteTokens !== undefined && usage.cacheWriteTokens > 0)
      );
    };

    const buildEstimatedTokenUsage = (): TokenUsage | undefined => {
      if (!assistantText.trim()) return undefined;
      const inputTokens = estimateTokens([request.prompt]);
      const outputTokens = estimateTokens([assistantText]);
      return {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimated: true,
      };
    };

    const createRequestContext = () => new RequestContext([
      [workspacePathKey, workspacePath],
      [allowedExternalWorkspacePathsKey, getAllowedExternalWorkspacePaths(currentSession.id)],
      ['harness', {
        threadId: currentSession.id,
        resourceId: tuiResourceId,
        emitEvent: applyHarnessEvent,
      }],
    ]);

    const reconcileStoredTasks = async () => {
      try {
        const nextTasks = await readStoredTaskItems(currentSession.id);
        if (!nextTasks) return;
        hasStructuredTaskList = true;
        setTasks(nextTasks);
        currentTaskIndex = nextTasks.find((task) => task.current)?.index ?? null;
      } catch {
        // Best-effort final sync; live stream events still drive the visible state.
      }
    };

    const shouldRequireToolApproval = ({ args }: { toolName?: string; args?: unknown }) => {
      const approvalPath = getToolPathForApproval(args);
      if (!approvalPath) return false;

      const allowedRoots = [workspacePath, ...getAllowedExternalWorkspacePaths(currentSession.id)];
      return !isPathWithinAllowedRoots(approvalPath, allowedRoots);
    };

    const extractTokenUsage = (source: Record<string, unknown> | undefined) => {
      if (!source) return undefined;

      const directUsage = normalizeTokenUsage(source.usage, source.providerMetadata ?? source.experimental_providerMetadata);
      if (directUsage) return directUsage;

      const totalUsage = normalizeTokenUsage(source.totalUsage, source.providerMetadata ?? source.experimental_providerMetadata);
      if (totalUsage) return totalUsage;

      const outputRecord = asArgsRecord(source.output);
      const outputUsage = normalizeTokenUsage(outputRecord?.usage, source.providerMetadata ?? source.experimental_providerMetadata);
      if (outputUsage) return outputUsage;

      const stepResultRecord = asArgsRecord(source.stepResult);
      return normalizeTokenUsage(stepResultRecord?.usage ?? stepResultRecord?.totalUsage, source.providerMetadata ?? source.experimental_providerMetadata);
    };

    const captureTokenUsage = (chunk: unknown) => {
      const chunkRecord = asArgsRecord(chunk);
      const payloadRecord = asArgsRecord(chunkRecord?.payload);
      const type = payloadRecord?.type ?? chunkRecord?.type;
      if (type !== 'finish' && type !== 'step-finish') return;

      const usage = extractTokenUsage(payloadRecord) ?? extractTokenUsage(chunkRecord);
      finalTokenUsage = mergeTokenUsage(finalTokenUsage, usage);
    };

    // ----- UI closure helpers -----

    setStatus('streaming');

    const appendLine = (text: string) => {
      const lineId = nextLineIdRef.current;
      nextLineIdRef.current += 1;
      setEvents((current) => [...current, { id: lineId, type: 'text', text }]);
      return lineId;
    };

    const appendAssistantLine = (text: string) => {
      const lineId = nextLineIdRef.current;
      nextLineIdRef.current += 1;
      setEvents((current) => [...current, { id: lineId, type: 'assistant', text }]);
      return lineId;
    };

    const appendLogLine = (text: string) => {
      activeResponseLineId = null;
      appendLine('');
      appendLine(text);
    };

    const updateLine = (lineId: number, text: string) => {
      setEvents((current) =>
        current.map((event) => (event.id === lineId && event.type === 'text' ? { ...event, text } : event)),
      );
    };

    const replaceLineWithToolEvent = (lineId: number, toolEvent: ToolCardEvent) => {
      activeToolLines.delete(lineId);
      setEvents((current) => current.map((event) => (event.id === lineId ? { ...toolEvent, id: lineId } : event)));
    };

    const appendToolEvent = (toolEvent: ToolCardEvent) => {
      setEvents((current) => [...current, toolEvent]);
    };

    const appendTokenUsageEvent = (usage: TokenUsage) => {
      activeResponseLineId = null;
      const eventId = nextLineIdRef.current;
      nextLineIdRef.current += 1;
      setEvents((current) => [...current, { id: eventId, type: 'usage', label: 'USAGE', usage }]);
    };

    const appendApprovalEvent = (toolName: string, toolCallId: string, approvalPath: string | undefined) => {
      activeResponseLineId = null;
      const eventId = nextLineIdRef.current;
      nextLineIdRef.current += 1;
      const approvalEvent: ApprovalEvent = {
        id: eventId,
        type: 'approval',
        label: 'APPROVE',
        toolName,
        toolCallId,
        path: approvalPath,
        status: 'pending',
      };
      setEvents((current) => [...current, approvalEvent]);
      return approvalEvent;
    };

    const updateApprovalEvent = (eventId: number, status: ApprovalEvent['status']) => {
      setEvents((current) =>
        current.map((event) => (event.id === eventId && event.type === 'approval' ? { ...event, status } : event)),
      );
    };

    const appendRunEvent = (prompt: string) => {
      const eventId = nextLineIdRef.current;
      nextLineIdRef.current += 1;
      setEvents((current) => [
        ...current,
        { id: eventId, type: 'run', label: 'RUN', prompt, agent: 'openai-compatible-agent', status: 'waiting' },
      ]);
      return eventId;
    };

    const updateRunEvent = (eventId: number, status: RunEvent['status']) => {
      setEvents((current) =>
        current.map((event) => (event.id === eventId && event.type === 'run' ? { ...event, status } : event)),
      );
    };

    const removeEvent = (eventId: number) => {
      activeToolLines.delete(eventId);
      setEvents((current) => current.filter((event) => event.id !== eventId));
    };

    const addExploreChild = (exploreEventId: number, child: ExploreChildEvent) => {
      setEvents((current) =>
        current.map((event) => {
          if (event.id !== exploreEventId || event.type !== 'explore') return event;
          if (event.children.some((item) => item.label === child.label && item.path === child.path)) return event;
          return { ...event, children: [...event.children, child] };
        }),
      );
    };

    const getExploreRuntime = (startedAt: number) => {
      const now = Date.now();
      return {
        elapsedSeconds: Math.max(0, Math.round((now - startedAt) / 1000)),
      };
    };

    const updateRunningExploreEvents = (
      status?: ExploreEvent['status'],
      exceptEventId?: number,
      errorMessage?: string,
    ) => {
      setEvents((current) =>
        current.map((event) => {
          if (event.type !== 'explore' || event.status !== 'running') return event;
          if (event.id === exceptEventId) return event;
          return {
            ...event,
            status: status ?? event.status,
            ...getExploreRuntime(event.startedAt),
            errorMessage: status === 'error' ? errorMessage ?? event.errorMessage : undefined,
          };
        }),
      );
    };

    const finishExploreEvent = (
      event: ExploreEvent,
      status: ExploreEvent['status'] = 'done',
      errorMessage?: string,
    ): ExploreEvent => ({
      ...event,
      status,
      ...getExploreRuntime(event.startedAt),
      errorMessage: status === 'error' ? errorMessage ?? event.errorMessage : undefined,
    });

    const appendProgressEvent = (label: string, description: string) => {
      activeResponseLineId = null;
      const lineId = nextLineIdRef.current;
      nextLineIdRef.current += 1;
      setEvents((current) => [...current, { id: lineId, type: 'progress', label, description, status: 'running' }]);
      activeToolLines.set(lineId, label);
      return lineId;
    };

    const updateProgressEvent = (lineId: number, label: string, description: string, status: 'running' | 'done' | 'error' = 'running') => {
      if (status === 'running') {
        activeToolLines.set(lineId, label);
      } else {
        activeToolLines.delete(lineId);
      }
      setEvents((current) =>
        current.map((event) => (event.id === lineId && event.type === 'progress' ? { ...event, label, description, status } : event)),
      );
    };

    const removeProgressEvent = (lineId: number) => {
      activeToolLines.delete(lineId);
      setEvents((current) => current.filter((event) => event.id !== lineId));
    };

    const finishProgressLine = (lineId: number, marker: '[x]' | '[!]', description: string) => {
      activeToolLines.delete(lineId);
      updateLine(lineId, `${marker} ${description}`);
    };

    const spinnerInterval = setInterval(() => {
      spinnerFrameIndex = (spinnerFrameIndex + 1) % spinnerFrames.length;
      
      const hasActiveTools = activeToolLines.size > 0;
      
      setEvents((current) =>
        current.map((event) => {
          if (event.type === 'explore' && event.status === 'running' && hasActiveTools) {
            return {
              ...event,
              elapsedSeconds: Math.max(0, Math.round((Date.now() - event.startedAt) / 1000)),
            };
          }
          if (event.type === 'shell' && event.status === 'running' && hasActiveTools) {
            return { ...event, elapsedSeconds: Math.max(0, Math.round((Date.now() - event.startedAt) / 1000)) };
          }
          return event;
        }),
      );
    }, 250);

    const extractTasks = () => {
      if (hasStructuredTaskList) return;

      const blocks: TaskItem[][] = [];
      let currentBlock: TaskItem[] = [];

      for (const line of assistantText.split('\n')) {
        const match = line.match(/^\s*(\d{1,2})\.\s+(.+)$/);
        if (!match) {
          if (currentBlock.length > 0) { blocks.push(currentBlock); currentBlock = []; }
          continue;
        }
        const index = Number(match[1]);
        const text = cleanTaskText(match[2] ?? '');
        if (!text) continue;
        currentBlock.push({ index, text, done: false, current: false });
      }
      if (currentBlock.length > 0) blocks.push(currentBlock);

      const nextTasks = [...blocks].reverse().find((block) => block.length >= 2);
      if (!nextTasks?.length) return;

      setTasks((current) =>
        nextTasks.map((task) => {
          const previous = current.find((item) => item.index === task.index);
          return previous ? { ...task, done: previous.done, current: previous.current } : task;
        }),
      );
    };

    const updateTaskProgressFromText = () => {
      if (hasStructuredTaskList) return;

      const lowerText = assistantText.toLowerCase();
      setTasks((current) => {
        const nextTask = current.find((task) => {
          if (task.done || task.current) return false;
          const keywords = task.text
            .toLowerCase()
            .replace(/[`"'().,+/:-]/g, ' ')
            .split(/\s+/)
            .filter((word) => word.length >= 4 && !['create', 'add', 'file', 'with', 'yang', 'task'].includes(word));
          const matchedKeywords = keywords.filter((word) => lowerText.includes(word));
          return matchedKeywords.length >= Math.min(2, Math.max(1, keywords.length));
        });
        if (!nextTask || nextTask.index === currentTaskIndex) return current;
        currentTaskIndex = nextTask.index;
        return current.map((task) => ({ ...task, done: task.done, current: task.index === nextTask.index }));
      });
    };

    const appendDelta = (delta: string) => {
      assistantText += delta;
      extractTasks();
      updateTaskProgressFromText();

      const parts = delta.split('\n');
      for (const [index, part] of parts.entries()) {
        if (index > 0 || activeResponseLineId === null) activeResponseLineId = appendAssistantLine('');
        const targetLineId = activeResponseLineId;
        setEvents((current) =>
          current.map((event) =>
            event.id === targetLineId && event.type === 'assistant' ? { ...event, text: `${event.text}${part}` } : event,
          ),
        );
      }
    };

    const consumeContinuationResponse = async (
      response: Awaited<ReturnType<typeof openAICompatibleAgent.stream>>,
      runStartedAt: number,
      runEventId: number,
    ) => {
      for await (const chunk of response.fullStream) {
        if (cancelled) return;
        captureTokenUsage(chunk);

        if (chunk.type === 'text-delta') {
          appendDelta(chunk.payload.text);
        }

        if (chunk.type === 'tool-call') {
          applyTaskListTool(chunk.payload);
          const label = getToolLabel(chunk.payload.toolName);
          const description = describeTool(chunk.payload);
          const lineId = appendProgressEvent(label, description);

          if (chunk.payload.toolCallId) {
            toolDescriptions.set(chunk.payload.toolCallId, description);
            toolPayloads.set(chunk.payload.toolCallId, chunk.payload);
            toolStartedAt.set(chunk.payload.toolCallId, Date.now());
            activeToolLineByCallId.set(chunk.payload.toolCallId, lineId);
          }

          const exploreEvent = createExploreEvent(lineId, request.prompt, chunk.payload, undefined, Date.now(), assistantText);
          const shellEvent = createShellEvent(lineId, chunk.payload, undefined, Date.now(), 'running');
          const taskListEvent = createTaskListEvent(lineId, chunk.payload, undefined, 'running');

          if (exploreEvent) {
            updateRunningExploreEvents('done', lineId);
            activeExploreEventId = lineId;
            replaceLineWithToolEvent(lineId, exploreEvent);
          } else if (shellEvent) {
            replaceLineWithToolEvent(lineId, shellEvent);
          } else if (taskListEvent) {
            replaceLineWithToolEvent(lineId, taskListEvent);
          }
        }

        if (chunk.type === 'tool-call-input-streaming-start') {
          rememberStreamingToolInputStart(chunk.payload);
          const label = getToolLabel(chunk.payload.toolName);
          const lineId = appendProgressEvent(label, '');
          if (chunk.payload.toolName) pendingToolLineByName.set(chunk.payload.toolName, lineId);
        }

        if (chunk.type === 'tool-call-delta') {
          appendStreamingToolInput(chunk.payload);
        }

        if (chunk.type === 'tool-call-input-streaming-end') {
          finalizeStreamingToolInput(chunk.payload);
        }

        if (chunk.type === 'tool-result') {
          const description = (chunk.payload.toolCallId && toolDescriptions.get(chunk.payload.toolCallId)) || describeTool(chunk.payload);
          const lineId = (chunk.payload.toolCallId && activeToolLineByCallId.get(chunk.payload.toolCallId)) || undefined;
          const fallbackPayload = chunk.payload.toolCallId ? toolPayloads.get(chunk.payload.toolCallId) : undefined;
          applyTaskListTool(chunk.payload, fallbackPayload);
          const toolName = chunk.payload.toolName ?? fallbackPayload?.toolName;
          const isErrorResult = chunk.payload.isError === true;
          const toolErrorMessage = getToolErrorMessage(chunk.payload, fallbackPayload);
          const readEvent = createReadEvent(lineId ?? nextLineIdRef.current, chunk.payload, fallbackPayload);
          const exploreEvent = createExploreEvent(
            lineId ?? nextLineIdRef.current,
            request.prompt,
            chunk.payload,
            fallbackPayload,
            chunk.payload.toolCallId ? (toolStartedAt.get(chunk.payload.toolCallId) ?? Date.now()) : Date.now(),
            assistantText,
          );
          const shellEvent = createShellEvent(
            lineId ?? nextLineIdRef.current,
            chunk.payload,
            fallbackPayload,
            chunk.payload.toolCallId ? (toolStartedAt.get(chunk.payload.toolCallId) ?? Date.now()) : Date.now(),
            isErrorResult ? 'error' : 'done',
          );
          const taskListEvent = createTaskListEvent(lineId ?? nextLineIdRef.current, chunk.payload, fallbackPayload, isErrorResult ? 'error' : 'done');

          if (readEvent && activeExploreEventId !== null) {
            const child = createExploreChildEvent(readEvent.id, chunk.payload, fallbackPayload);
            if (child) addExploreChild(activeExploreEventId, child);
            if (lineId !== undefined) { removeProgressEvent(lineId); activeToolLineByCallId.delete(chunk.payload.toolCallId ?? ''); }
          } else if (readEvent && lineId !== undefined) {
            replaceLineWithToolEvent(lineId, readEvent);
            activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
          } else if (readEvent) {
            nextLineIdRef.current += 1;
            appendToolEvent(readEvent);
          } else if (exploreEvent && lineId !== undefined) {
            activeExploreEventId = null;
            replaceLineWithToolEvent(lineId, finishExploreEvent(exploreEvent, isErrorResult ? 'error' : 'done', toolErrorMessage));
            activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
          } else if (exploreEvent) {
            activeExploreEventId = null;
            nextLineIdRef.current += 1;
            appendToolEvent(finishExploreEvent(exploreEvent, isErrorResult ? 'error' : 'done', toolErrorMessage));
          } else if (shellEvent && lineId !== undefined) {
            replaceLineWithToolEvent(lineId, shellEvent);
            activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
          } else if (shellEvent) {
            nextLineIdRef.current += 1;
            appendToolEvent(shellEvent);
          } else if (taskListEvent && lineId !== undefined) {
            replaceLineWithToolEvent(lineId, taskListEvent);
            activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
          } else if (taskListEvent) {
            nextLineIdRef.current += 1;
            appendToolEvent(taskListEvent);
          } else if (lineId !== undefined) {
            updateProgressEvent(
              lineId,
              getToolLabel(toolName),
              isErrorResult && toolErrorMessage ? `${description}: ${toolErrorMessage}` : description,
              isErrorResult ? 'error' : 'done',
            );
            activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
          }
        }

        if (chunk.type === 'tool-error') {
          const description = (chunk.payload.toolCallId && toolDescriptions.get(chunk.payload.toolCallId)) || describeTool(chunk.payload);
          const lineId = (chunk.payload.toolCallId && activeToolLineByCallId.get(chunk.payload.toolCallId)) || undefined;
          const fallbackPayload = chunk.payload.toolCallId ? toolPayloads.get(chunk.payload.toolCallId) : undefined;
          const toolName = chunk.payload.toolName ?? fallbackPayload?.toolName;
          const toolErrorMessage = getToolErrorMessage(chunk.payload, fallbackPayload);
          if (lineId !== undefined) {
            updateProgressEvent(lineId, getToolLabel(toolName), toolErrorMessage ? `${description}: ${toolErrorMessage}` : description, 'error');
            activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
          }
        }
      }

      if (cancelled) return;
      const responseUsage = await Promise.allSettled([response.usage, response.providerMetadata]).then(
        ([usageResult, metadataResult]) =>
          normalizeTokenUsage(
            usageResult.status === 'fulfilled' ? usageResult.value : undefined,
            metadataResult.status === 'fulfilled' ? metadataResult.value : undefined,
          ),
      );
      finalTokenUsage = mergeTokenUsage(finalTokenUsage, responseUsage);
      updateRunningExploreEvents('done');
      activeExploreEventId = null;
      updateRunEvent(runEventId, 'done');
      await reconcileStoredTasks();
      if (cancelled) return;

      const backendUsage = await fetchLatestBackendTokenUsageSince(runStartedAt);
      const usageToDisplay =
        hasVisibleTokenUsage(backendUsage) ? backendUsage :
        hasVisibleTokenUsage(finalTokenUsage) ? finalTokenUsage :
        buildEstimatedTokenUsage();
      if (usageToDisplay) {
        appendTokenUsageEvent(usageToDisplay);
      }

      setStatus('finished');
      void refreshSessions();
    };

    // ----- main stream loop -----

    const buildPromptMessage = (): string | { role: 'user'; content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mediaType?: string }> } => {
      if (!request.images || request.images.length === 0) return request.prompt;

      return {
        role: 'user',
        content: [
          { type: 'text', text: request.prompt },
          ...request.images.map((img) => ({
            type: 'image' as const,
            image: img.base64,
            mediaType: img.mediaType,
          })),
        ],
      };
    };

    const run = async () => {
      if (request.id > 0) appendLine('');
      const runStartedAt = Date.now();
      const imageHint = request.images?.length ? ` [${request.images.length} image${request.images.length > 1 ? 's' : ''}]` : '';
      const runEventId = appendRunEvent(request.prompt + imageHint);
      const requestContext = createRequestContext();

      try {
        const promptMessage = buildPromptMessage();
        const response = await openAICompatibleAgent.stream(promptMessage, {
          maxSteps: agentMaxSteps,
          memory: { resource: tuiResourceId, thread: currentSession.id },
          ...(request.taskContext ? { system: request.taskContext } : {}),
          requestContext,
          requireToolApproval: shouldRequireToolApproval,
        });
        updateRunEvent(runEventId, 'streaming');

        for await (const chunk of response.fullStream) {
          if (cancelled) return;
          captureTokenUsage(chunk);

          if (chunk.type === 'tool-call-approval') {
            const approvalPath = getToolPathForApproval(chunk.payload.args);
            const approvalEvent = appendApprovalEvent(chunk.payload.toolName, chunk.payload.toolCallId, approvalPath);
            setStatus('awaiting-approval');
            updateRunEvent(runEventId, 'awaiting-approval');
            approvalResumeRef.current = async (approved: boolean) => {
              approvalResumeRef.current = null;
              updateApprovalEvent(approvalEvent.id, approved ? 'approved' : 'denied');
              setStatus('streaming');
              updateRunEvent(runEventId, 'streaming');

              try {
                if (approved && approvalPath) {
                  allowExternalWorkspacePath(currentSession.id, approvalPath);
                }

                const resumeContext = createRequestContext();
                const resumedResponse = approved
                  ? await openAICompatibleAgent.approveToolCall({
                    runId: response.runId,
                    toolCallId: chunk.payload.toolCallId,
                    maxSteps: agentMaxSteps,
                    memory: { resource: tuiResourceId, thread: currentSession.id },
                    ...(request.taskContext ? { system: request.taskContext } : {}),
                    requestContext: resumeContext,
                    requireToolApproval: shouldRequireToolApproval,
                  })
                  : await openAICompatibleAgent.declineToolCall({
                    runId: response.runId,
                    toolCallId: chunk.payload.toolCallId,
                    maxSteps: agentMaxSteps,
                    memory: { resource: tuiResourceId, thread: currentSession.id },
                    ...(request.taskContext ? { system: request.taskContext } : {}),
                    requestContext: resumeContext,
                    requireToolApproval: shouldRequireToolApproval,
                  });

                await consumeContinuationResponse(resumedResponse, runStartedAt, runEventId);
                return true;
              } catch (error) {
                updateRunningExploreEvents('error');
                activeExploreEventId = null;
                updateRunEvent(runEventId, 'error');
                appendLine(`error: ${error instanceof Error ? error.message : String(error)}`);
                setStatus('error');
                void refreshSessions();
                return false;
              }
            };
            return;
          }

          if (chunk.type === 'text-delta') {
            appendDelta(chunk.payload.text);
          }

          if (chunk.type === 'tool-call') {
            applyTaskListTool(chunk.payload);
            const label = getToolLabel(chunk.payload.toolName);
            const description = describeTool(chunk.payload);
            let lineId =
              (chunk.payload.toolCallId ? activeToolLineByCallId.get(chunk.payload.toolCallId) : undefined) ??
              (chunk.payload.toolName ? pendingToolLineByName.get(chunk.payload.toolName) : undefined);

            if (lineId === undefined) {
              lineId = appendProgressEvent(label, description);
            } else {
              updateProgressEvent(lineId, label, description);
            }

            if (chunk.payload.toolCallId) {
              toolDescriptions.set(chunk.payload.toolCallId, description);
              toolPayloads.set(chunk.payload.toolCallId, chunk.payload);
              toolStartedAt.set(chunk.payload.toolCallId, Date.now());
              activeToolLineByCallId.set(chunk.payload.toolCallId, lineId);
            }
            if (chunk.payload.toolName) pendingToolLineByName.delete(chunk.payload.toolName);

            const exploreEvent = createExploreEvent(
              lineId, request.prompt, chunk.payload, undefined,
              chunk.payload.toolCallId ? (toolStartedAt.get(chunk.payload.toolCallId) ?? Date.now()) : Date.now(),
              assistantText,
            );
            const shellEvent = createShellEvent(
              lineId, chunk.payload, undefined,
              chunk.payload.toolCallId ? (toolStartedAt.get(chunk.payload.toolCallId) ?? Date.now()) : Date.now(),
              'running',
            );
            const taskListEvent = createTaskListEvent(lineId, chunk.payload, undefined, 'running');

            if (exploreEvent) {
              updateRunningExploreEvents('done', lineId);
              activeExploreEventId = lineId;
              replaceLineWithToolEvent(lineId, exploreEvent);
            }
            else if (shellEvent) { replaceLineWithToolEvent(lineId, shellEvent); }
            else if (taskListEvent) { replaceLineWithToolEvent(lineId, taskListEvent); }
          }

          if (chunk.type === 'tool-call-input-streaming-start') {
            rememberStreamingToolInputStart(chunk.payload);
            const label = getToolLabel(chunk.payload.toolName);
            const lineId = appendProgressEvent(label, '');
            if (chunk.payload.toolName) pendingToolLineByName.set(chunk.payload.toolName, lineId);
          }

          if (chunk.type === 'tool-call-delta') {
            appendStreamingToolInput(chunk.payload);
          }

          if (chunk.type === 'tool-call-input-streaming-end') {
            finalizeStreamingToolInput(chunk.payload);
          }

          if (chunk.type === 'tool-result') {
            const description = (chunk.payload.toolCallId && toolDescriptions.get(chunk.payload.toolCallId)) || describeTool(chunk.payload);
            const lineId = (chunk.payload.toolCallId && activeToolLineByCallId.get(chunk.payload.toolCallId)) || undefined;
            const fallbackPayload = chunk.payload.toolCallId ? toolPayloads.get(chunk.payload.toolCallId) : undefined;
            applyTaskListTool(chunk.payload, fallbackPayload);
            const toolName = chunk.payload.toolName ?? fallbackPayload?.toolName;
            const isErrorResult = chunk.payload.isError === true;
            const toolErrorMessage = getToolErrorMessage(chunk.payload, fallbackPayload);
            const editEvent = createEditEvent(lineId ?? nextLineIdRef.current, chunk.payload, fallbackPayload);
            const readEvent = createReadEvent(lineId ?? nextLineIdRef.current, chunk.payload, fallbackPayload);
            const exploreEvent = createExploreEvent(
              lineId ?? nextLineIdRef.current, request.prompt, chunk.payload, fallbackPayload,
              chunk.payload.toolCallId ? (toolStartedAt.get(chunk.payload.toolCallId) ?? Date.now()) : Date.now(),
              assistantText,
            );
            const shellEvent = createShellEvent(
              lineId ?? nextLineIdRef.current, chunk.payload, fallbackPayload,
              chunk.payload.toolCallId ? (toolStartedAt.get(chunk.payload.toolCallId) ?? Date.now()) : Date.now(),
              'done',
            );
            const taskListEvent = createTaskListEvent(lineId ?? nextLineIdRef.current, chunk.payload, fallbackPayload, 'done');

            if (editEvent && lineId !== undefined) {
              activeExploreEventId = null;
              replaceLineWithToolEvent(lineId, editEvent);
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            } else if (editEvent) {
              nextLineIdRef.current += 1;
              activeExploreEventId = null;
              appendToolEvent(editEvent);
            } else if (readEvent && activeExploreEventId !== null) {
              const child = createExploreChildEvent(readEvent.id, chunk.payload, fallbackPayload);
              if (child) addExploreChild(activeExploreEventId, child);
              if (lineId !== undefined) { removeProgressEvent(lineId); activeToolLineByCallId.delete(chunk.payload.toolCallId ?? ''); }
            } else if (readEvent && lineId !== undefined) {
              replaceLineWithToolEvent(lineId, readEvent);
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            } else if (readEvent) {
              nextLineIdRef.current += 1;
              appendToolEvent(readEvent);
            } else if (exploreEvent && lineId !== undefined) {
              activeExploreEventId = null;
              replaceLineWithToolEvent(
                lineId,
                finishExploreEvent(exploreEvent, isErrorResult ? 'error' : 'done', toolErrorMessage),
              );
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            } else if (exploreEvent) {
              activeExploreEventId = null;
              nextLineIdRef.current += 1;
              appendToolEvent(finishExploreEvent(exploreEvent, isErrorResult ? 'error' : 'done', toolErrorMessage));
            } else if (shellEvent && lineId !== undefined) {
              replaceLineWithToolEvent(
                lineId,
                isErrorResult ? { ...shellEvent, status: 'error' } : shellEvent,
              );
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            } else if (shellEvent) {
              nextLineIdRef.current += 1;
              appendToolEvent(isErrorResult ? { ...shellEvent, status: 'error' } : shellEvent);
            } else if (taskListEvent && lineId !== undefined) {
              replaceLineWithToolEvent(
                lineId,
                isErrorResult ? { ...taskListEvent, status: 'error' } : taskListEvent,
              );
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            } else if (taskListEvent) {
              nextLineIdRef.current += 1;
              appendToolEvent(isErrorResult ? { ...taskListEvent, status: 'error' } : taskListEvent);
            } else if (activeExploreEventId !== null && isExploreTool(toolName)) {
              const child = createExploreChildEvent(lineId ?? nextLineIdRef.current, chunk.payload, fallbackPayload);
              if (child) addExploreChild(activeExploreEventId, child);
              if (lineId !== undefined) { removeProgressEvent(lineId); activeToolLineByCallId.delete(chunk.payload.toolCallId ?? ''); }
            } else if (lineId !== undefined) {
              updateProgressEvent(
                lineId,
                getToolLabel(toolName),
                isErrorResult && toolErrorMessage ? `${description}: ${toolErrorMessage}` : description,
                isErrorResult ? 'error' : 'done',
              );
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            }
          }

          if (chunk.type === 'tool-error') {
            const description = (chunk.payload.toolCallId && toolDescriptions.get(chunk.payload.toolCallId)) || describeTool(chunk.payload);
            const lineId = (chunk.payload.toolCallId && activeToolLineByCallId.get(chunk.payload.toolCallId)) || undefined;
            const fallbackPayload = chunk.payload.toolCallId ? toolPayloads.get(chunk.payload.toolCallId) : undefined;
            const toolName = chunk.payload.toolName ?? fallbackPayload?.toolName;
            const toolErrorMessage = getToolErrorMessage(chunk.payload, fallbackPayload);

            if (isExploreTool(toolName)) { updateRunningExploreEvents('error', undefined, toolErrorMessage); activeExploreEventId = null; }

            const shellEvent = createShellEvent(
              lineId ?? nextLineIdRef.current, chunk.payload, fallbackPayload,
              chunk.payload.toolCallId ? (toolStartedAt.get(chunk.payload.toolCallId) ?? Date.now()) : Date.now(),
              'error',
            );
            const taskListEvent = createTaskListEvent(lineId ?? nextLineIdRef.current, chunk.payload, fallbackPayload, 'error');

            if (shellEvent && lineId !== undefined) {
              replaceLineWithToolEvent(lineId, shellEvent);
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            } else if (shellEvent) {
              nextLineIdRef.current += 1;
              appendToolEvent(shellEvent);
            } else if (taskListEvent && lineId !== undefined) {
              replaceLineWithToolEvent(lineId, taskListEvent);
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            } else if (taskListEvent) {
              nextLineIdRef.current += 1;
              appendToolEvent(taskListEvent);
            } else if (lineId !== undefined) {
              updateProgressEvent(
                lineId,
                getToolLabel(toolName),
                toolErrorMessage ? `${description}: ${toolErrorMessage}` : description,
                'error',
              );
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            } else {
              appendProgressEvent(getToolLabel(toolName), description);
              updateProgressEvent(
                nextLineIdRef.current - 1,
                getToolLabel(toolName),
                toolErrorMessage ? `${description}: ${toolErrorMessage}` : description,
                'error',
              );
            }
          }
        }

        if (cancelled) return;
        const responseUsage = await Promise.allSettled([response.usage, response.providerMetadata]).then(
          ([usageResult, metadataResult]) =>
            normalizeTokenUsage(
              usageResult.status === 'fulfilled' ? usageResult.value : undefined,
              metadataResult.status === 'fulfilled' ? metadataResult.value : undefined,
            ),
        );
        finalTokenUsage = mergeTokenUsage(finalTokenUsage, responseUsage);
        updateRunningExploreEvents('done');
        activeExploreEventId = null;
        updateRunEvent(runEventId, 'done');
        await reconcileStoredTasks();
        if (cancelled) return;

        const backendUsage = await fetchLatestBackendTokenUsageSince(runStartedAt);
        const usageToDisplay =
          hasVisibleTokenUsage(backendUsage) ? backendUsage :
          hasVisibleTokenUsage(finalTokenUsage) ? finalTokenUsage :
          buildEstimatedTokenUsage();
        if (usageToDisplay) {
          appendTokenUsageEvent(usageToDisplay);
        }
        
        setStatus('finished');
        void refreshSessions();
      } catch (error) {
        if (cancelled) return;
        updateRunningExploreEvents('error');
        activeExploreEventId = null;
        updateRunEvent(runEventId, 'error');
        appendLine(`error: ${error instanceof Error ? error.message : String(error)}`);
        setStatus('error');
        void refreshSessions();
      }
    };

    void run();

    return () => {
      cancelled = true;
      clearInterval(spinnerInterval);
    };
  }, [currentSession.id, historyLoaded, refreshSessions, request]);

  const submitPrompt = useCallback((nextPrompt: string, images?: ImageAttachment[]) => {
    const trimmedPrompt = nextPrompt.trim();
    if (!trimmedPrompt || status === 'streaming' || status === 'awaiting-approval') return false;
    setRequest((current) => ({
      id: (current?.id ?? -1) + 1,
      prompt: trimmedPrompt,
      taskContext: buildTaskContext(tasks),
      images: images && images.length > 0 ? images : undefined,
    }));
    return true;
  }, [status, tasks]);

  const respondToApproval = useCallback(async (approved: boolean) => {
    if (status !== 'awaiting-approval' || !approvalResumeRef.current) return false;
    return approvalResumeRef.current(approved);
  }, [status]);

  const appendSystemLine = useCallback((text: string) => {
    const lineId = nextLineIdRef.current;
    nextLineIdRef.current += 1;
    setEvents((current) => [...current, { id: lineId, type: 'text', text }]);
  }, []);

  const allowExternalPath = useCallback((inputPath: string) => {
    const trimmedPath = inputPath.trim();
    if (!trimmedPath || status === 'streaming' || status === 'awaiting-approval') return false;

    const allowedPath = allowExternalWorkspacePath(currentSession.id, trimmedPath);
    appendSystemLine(`Allowed external path for this session: ${allowedPath}`);
    return true;
  }, [appendSystemLine, currentSession.id, status]);

  const showAllowedExternalPaths = useCallback(() => {
    if (status === 'streaming' || status === 'awaiting-approval') return false;

    const allowedPaths = getAllowedExternalWorkspacePaths(currentSession.id);
    appendSystemLine(
      allowedPaths.length > 0
        ? `Allowed external paths for this session:\n${allowedPaths.map((item) => `- ${item}`).join('\n')}`
        : 'No external paths allowed for this session yet. Use /allow <path> to add one.',
    );
    return true;
  }, [appendSystemLine, currentSession.id, status]);

  const clearMemory = useCallback(async () => {
    try {
      const memory = await openAICompatibleAgent.getMemory();
      if (memory) await memory.deleteThread(currentSession.id);
      await deleteStoredTaskItems(currentSession.id);
    } catch { /* silently ignore */ }
    setEvents([]);
    setTasks([]);
    setStatus('idle');
    setRequest(null);
    approvalResumeRef.current = null;
    nextLineIdRef.current = 0;
    void refreshSessions();
  }, [currentSession.id, refreshSessions]);

  const createSession = useCallback(async (title?: string) => {
    if (status === 'streaming' || status === 'awaiting-approval') return false;
    try {
      const memory = await openAICompatibleAgent.getMemory();
      if (!memory) return false;

      const nextTitle = title?.trim() || `Session ${new Date().toLocaleString()}`;
      const thread = await memory.createThread({
        resourceId: tuiResourceId,
        threadId: `tui-session-${Date.now().toString(36)}`,
        title: nextTitle,
        metadata: { source: 'mastra-tui' },
      });
      const nextSession: TuiSession = {
        id: thread.id, title: thread.title, createdAt: thread.createdAt, updatedAt: thread.updatedAt, metadata: thread.metadata,
      };

      setSessionPickerOpen(false);
      setSessions((current) => [nextSession, ...current.filter((s) => s.id !== nextSession.id)]);
      setCurrentSession(nextSession);
      return true;
    } catch (error) {
      console.error('[Sessions] Failed to create session:', error);
      return false;
    }
  }, [status]);

  const openSessionPicker = useCallback(async () => {
    if (status === 'streaming' || status === 'awaiting-approval') return false;
    await refreshSessions();
    setSessionPickerOpen(true);
    return true;
  }, [refreshSessions, status]);

  const closeSessionPicker = useCallback(() => { setSessionPickerOpen(false); }, []);
  const selectSession = useCallback(async (sessionId: string) => {
    if (status === 'streaming' || status === 'awaiting-approval') return false;
    const session = sessions.find((item) => item.id === sessionId) ?? { id: sessionId };
    setSessionPickerOpen(false);
    setCurrentSession(session);
    return true;
  }, [sessions, status]);

  const refreshModels = useCallback(async () => {
    const fetched = await fetchModels();
    setModels(fetched);
    return fetched;
  }, []);

  const openModelPicker = useCallback(async () => {
    if (status === 'streaming' || status === 'awaiting-approval') return false;
    setModelPickerOpen(true);
    setModelsLoading(true);
    await refreshModels();
    setModelsLoading(false);
    return true;
  }, [refreshModels, status]);

  const closeModelPicker = useCallback(() => { setModelPickerOpen(false); }, []);

  const selectModel = useCallback(async (modelPublicId: string) => {
    if (status === 'streaming' || status === 'awaiting-approval') return false;
    const model = models.find((m) => m.publicModelId === modelPublicId);
    if (!model) return false;
    const changed = setModelIdAndRefresh(model.publicModelId);
    if (changed) {
      setSelectedModelIdState(model.publicModelId);
      setSelectedModelId(model.publicModelId);
    }
    setModelPickerOpen(false);
    return true;
  }, [models, status]);

  return {
    events, tasks, status, currentSession, sessions, sessionPickerOpen,
    submitPrompt, respondToApproval, allowExternalPath, showAllowedExternalPaths, clearMemory, createSession, openSessionPicker, closeSessionPicker, selectSession,
    models, selectedModelId, modelPickerOpen, modelsLoaded, modelsLoading,
    refreshModels, openModelPicker, closeModelPicker, selectModel,
  };
}
