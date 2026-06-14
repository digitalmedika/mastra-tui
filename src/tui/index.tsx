import { SyntaxStyle, TextAttributes, createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard, useTerminalDimensions } from '@opentui/react';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openAICompatibleAgent } from '../mastra/agents/openai-compatible-agent';

type StreamTextEvent = {
  id: number;
  type: 'text';
  text: string;
};

type StreamAssistantEvent = {
  id: number;
  type: 'assistant';
  text: string;
};

type RunEvent = {
  id: number;
  type: 'run';
  label: 'RUN';
  prompt: string;
  agent: string;
  status: 'waiting' | 'streaming' | 'done' | 'error';
};

type EditPreviewLine = {
  lineNumber?: number;
  marker: ' ' | '+' | '-';
  text: string;
};

type EditEvent = {
  id: number;
  type: 'edit';
  label: 'EDIT';
  path: string;
  additions: number;
  removals: number;
  hiddenLines: number;
  lines: EditPreviewLine[];
  diff: string;
  filetype: string;
  diffHeight: number;
};

type ReadEvent = {
  id: number;
  type: 'read';
  label: 'READ';
  path: string;
  lines: number;
};

type ExploreChildEvent = {
  id: number;
  label: 'READ' | 'GREP' | 'LIST' | 'SHELL';
  path: string;
};

type ExploreEvent = {
  id: number;
  type: 'explore';
  label: 'EXPLORE';
  title: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  elapsedSeconds: number;
  tokenEstimate: number;
  children: ExploreChildEvent[];
};

type ShellEvent = {
  id: number;
  type: 'shell';
  label: 'SHELL';
  command: string;
  directory: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  elapsedSeconds: number;
};

type TaskListEvent = {
  id: number;
  type: 'task-list';
  label: 'TASK';
  summary: string;
  status: 'running' | 'done' | 'error';
};

type ToolCardEvent = EditEvent | ReadEvent | ExploreEvent | ShellEvent | TaskListEvent;

type StreamEvent = StreamTextEvent | StreamAssistantEvent | RunEvent | ToolCardEvent;

type StreamStatus = 'idle' | 'streaming' | 'finished' | 'error';

type StreamRequest = {
  id: number;
  prompt: string;
};

type TaskItem = {
  index: number;
  text: string;
  done: boolean;
  current: boolean;
};

type ToolPayload = {
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
};

const markdownSyntaxStyle = SyntaxStyle.create();
const workspacePath = process.env.VIBE_CODING_WORKSPACE_PATH ?? '/Users/billymontolalu/Documents/project/central';
const configuredMaxSteps = Number(process.env.VIBE_CODING_MAX_STEPS);
const agentMaxSteps = Number.isFinite(configuredMaxSteps) && configuredMaxSteps > 0 ? configuredMaxSteps : 60;
const mutedFg = '#7e8494';
const textFg = '#e8edf7';
const pathFg = '#f2f5ff';
const purpleBg = '#5a3fc8';
const greenFg = '#2fd26f';
const greenBg = '#00583c';
const redFg = '#f87171';
const redBg = '#4a1d24';
const exploreBg = '#7547ff';
const branchFg = '#9aa3b8';
const shellBg = '#2374ab';
const taskBg = '#2c8f5b';
const runBg = '#6d5dfc';
const assistantMarkerFg = '#c8a7ff';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const getStringField = (record: Record<string, unknown> | undefined, keys: string[]) => {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return undefined;
};

const toContentLines = (content: string) => {
  const lines = content.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
};

const countLines = (content: string | undefined) => {
  if (!content) {
    return 0;
  }
  return toContentLines(content).length;
};

const formatLineCount = (lineCount: number) => {
  return `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
};

const estimateTokens = (parts: string[]) => {
  const characters = parts.reduce((total, part) => total + part.length, 0);
  return Math.max(1, Math.round(characters / 4));
};

const formatTokenCount = (tokens: number) => {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }

  return String(tokens);
};

const compactText = (text: string, maxLength = 90) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
};

const resolveWorkspaceFile = (filePath: string) => {
  return isAbsolute(filePath) ? filePath : join(workspacePath, filePath);
};

const countFileLines = (filePath: string) => {
  const absolutePath = resolveWorkspaceFile(filePath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }

  try {
    return countLines(readFileSync(absolutePath, 'utf8'));
  } catch {
    return undefined;
  }
};

const getPayloadArgs = (payload: ToolPayload, fallbackPayload?: ToolPayload) => {
  return isRecord(payload.args) ? payload.args : isRecord(fallbackPayload?.args) ? fallbackPayload.args : undefined;
};

const getPayloadPath = (payload: ToolPayload, fallbackPayload?: ToolPayload) => {
  const args = getPayloadArgs(payload, fallbackPayload);
  return getStringField(args, ['path', 'filePath', 'filepath', 'file', 'targetPath', 'target']);
};

const getResultText = (result: unknown): string | undefined => {
  if (typeof result === 'string') {
    return result;
  }

  if (!isRecord(result)) {
    return undefined;
  }

  return getStringField(result, ['content', 'text', 'output', 'data', 'result']);
};

const findStartLine = (filePath: string, needle: string | undefined) => {
  if (!needle) {
    return undefined;
  }

  const absolutePath = resolveWorkspaceFile(filePath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }

  try {
    const content = readFileSync(absolutePath, 'utf8');
    const index = content.indexOf(needle);
    if (index < 0) {
      return undefined;
    }

    return content.slice(0, index).split('\n').length;
  } catch {
    return undefined;
  }
};

const clampPreviewLines = (lines: EditPreviewLine[], maxVisibleLines = 9) => {
  if (lines.length <= maxVisibleLines) {
    return { visibleLines: lines, hiddenLines: 0 };
  }

  return {
    visibleLines: lines.slice(0, maxVisibleLines),
    hiddenLines: lines.length - maxVisibleLines,
  };
};

const buildEditPreviewLines = (oldText: string, newText: string, startLine: number | undefined) => {
  const oldLines = toContentLines(oldText);
  const newLines = toContentLines(newText);
  let prefixLength = 0;

  while (
    prefixLength < oldLines.length &&
    prefixLength < newLines.length &&
    oldLines[prefixLength] === newLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < oldLines.length - prefixLength &&
    suffixLength < newLines.length - prefixLength &&
    oldLines[oldLines.length - 1 - suffixLength] === newLines[newLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const beforeStart = Math.max(0, prefixLength - 2);
  const changedOldEnd = oldLines.length - suffixLength;
  const changedNewEnd = newLines.length - suffixLength;
  const afterEnd = Math.min(newLines.length, changedNewEnd + 2);
  const lineNumberFor = (index: number) => (startLine === undefined ? undefined : startLine + index);
  const preview: EditPreviewLine[] = [];

  for (let index = beforeStart; index < prefixLength; index += 1) {
    preview.push({ lineNumber: lineNumberFor(index), marker: ' ', text: newLines[index] ?? '' });
  }

  for (let index = prefixLength; index < changedOldEnd; index += 1) {
    preview.push({ lineNumber: lineNumberFor(index), marker: '-', text: oldLines[index] ?? '' });
  }

  for (let index = prefixLength; index < changedNewEnd; index += 1) {
    preview.push({ lineNumber: lineNumberFor(index), marker: '+', text: newLines[index] ?? '' });
  }

  for (let index = changedNewEnd; index < afterEnd; index += 1) {
    preview.push({ lineNumber: lineNumberFor(index), marker: ' ', text: newLines[index] ?? '' });
  }

  return preview.length > 0
    ? preview
    : newLines.slice(0, 4).map((text, index) => ({ lineNumber: lineNumberFor(index), marker: ' ' as const, text }));
};

const buildWritePreviewLines = (content: string, startLine = 1) => {
  return toContentLines(content).map((text, index) => ({
    lineNumber: startLine + index,
    marker: '+' as const,
    text,
  }));
};

const filetypeFromPath = (filePath: string) => {
  const extension = filePath.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'rs':
      return 'rust';
    case 'py':
      return 'python';
    case 'json':
      return 'json';
    case 'md':
    case 'mdx':
      return 'markdown';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    default:
      return extension ?? 'text';
  }
};

const createUnifiedDiff = (filePath: string, lines: EditPreviewLine[], additions: number, removals: number) => {
  const firstLineNumber = lines.find((line) => line.lineNumber !== undefined)?.lineNumber ?? 1;
  const oldVisibleLength = lines.filter((line) => line.marker !== '+').length;
  const newVisibleLength = lines.filter((line) => line.marker !== '-').length;
  const isAddOnlyHunk = oldVisibleLength === 0 && newVisibleLength > 0 && removals === 0;
  const oldStart = isAddOnlyHunk ? 0 : firstLineNumber;
  const oldLength = isAddOnlyHunk ? 0 : Math.max(1, oldVisibleLength || removals);
  const newLength = Math.max(1, newVisibleLength || additions);
  const body = lines.map((line) => `${line.marker}${line.text}`).join('\n');

  return [
    `diff --git a/${filePath} b/${filePath}`,
    isAddOnlyHunk ? '--- /dev/null' : `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${oldLength} +${firstLineNumber},${newLength} @@`,
    body,
    '',
  ].join('\n');
};

const isEditTool = (toolName: string | undefined) => {
  return toolName === 'mastra_workspace_edit_file' || toolName === 'mastra_workspace_write_file';
};

const isReadTool = (toolName: string | undefined) => {
  return toolName === 'mastra_workspace_read_file';
};

const isExploreTool = (toolName: string | undefined) => {
  return (
    toolName === 'mastra_workspace_list_files' ||
    toolName === 'mastra_workspace_grep' ||
    toolName === 'mastra_workspace_search'
  );
};

const isShellTool = (toolName: string | undefined) => {
  return toolName === 'mastra_workspace_shell' || toolName === 'mastra_workspace_execute_command';
};

const isTaskListToolName = (toolName: string | undefined) => {
  return toolName === 'tui_task_list' || toolName === 'tuiTaskListTool';
};

const createShellEvent = (
  id: number,
  payload: ToolPayload,
  fallbackPayload: ToolPayload | undefined,
  startedAt: number,
  status: ShellEvent['status'],
): ShellEvent | undefined => {
  const toolName = payload.toolName ?? fallbackPayload?.toolName;
  if (!isShellTool(toolName)) {
    return undefined;
  }

  const args = getPayloadArgs(payload, fallbackPayload);
  const command = getStringField(args, ['cmd', 'command', 'script']) ?? '(command tidak tersedia)';
  const directory = getStringField(args, ['directory', 'dir', 'cwd', 'basePath']) ?? '.';

  return {
    id,
    type: 'shell',
    label: 'SHELL',
    command: compactText(command, 120),
    directory,
    status,
    startedAt,
    elapsedSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
  };
};

const summarizeTaskList = (payload: ToolPayload, fallbackPayload?: ToolPayload) => {
  const args = getPayloadArgs(payload, fallbackPayload);

  if (args?.action === 'set' && Array.isArray(args.tasks)) {
    return `memperbarui checklist (${args.tasks.length} task)`;
  }

  if (args?.action === 'update') {
    return `memperbarui checklist task ${String(args.taskId ?? '?')} -> ${String(args.status ?? '?')}`;
  }

  return 'memperbarui checklist';
};

const createTaskListEvent = (
  id: number,
  payload: ToolPayload,
  fallbackPayload: ToolPayload | undefined,
  status: TaskListEvent['status'],
): TaskListEvent | undefined => {
  const toolName = payload.toolName ?? fallbackPayload?.toolName;
  if (!isTaskListToolName(toolName)) {
    return undefined;
  }

  return {
    id,
    type: 'task-list',
    label: 'TASK',
    summary: summarizeTaskList(payload, fallbackPayload),
    status,
  };
};

const createReadEvent = (id: number, payload: ToolPayload, fallbackPayload?: ToolPayload): ReadEvent | undefined => {
  const toolName = payload.toolName ?? fallbackPayload?.toolName;
  if (!isReadTool(toolName)) {
    return undefined;
  }

  const filePath = getPayloadPath(payload, fallbackPayload);
  if (!filePath) {
    return undefined;
  }

  const resultLines = countLines(getResultText(payload.result));
  const localLines = countFileLines(filePath);
  const lineCount = localLines ?? resultLines;

  return {
    id,
    type: 'read',
    label: 'READ',
    path: filePath,
    lines: lineCount,
  };
};

const createExploreChildEvent = (
  id: number,
  payload: ToolPayload,
  fallbackPayload?: ToolPayload,
): ExploreChildEvent | undefined => {
  const toolName = payload.toolName ?? fallbackPayload?.toolName;
  const args = getPayloadArgs(payload, fallbackPayload);

  if (isReadTool(toolName)) {
    const filePath = getPayloadPath(payload, fallbackPayload);
    return filePath ? { id, label: 'READ', path: filePath } : undefined;
  }

  if (toolName === 'mastra_workspace_grep') {
    const pattern = getStringField(args, ['pattern', 'query']) ?? 'pattern';
    const filePath = getPayloadPath(payload, fallbackPayload) ?? '.';
    return { id, label: 'GREP', path: `${pattern} in ${filePath}` };
  }

  if (toolName === 'mastra_workspace_list_files') {
    const filePath = getPayloadPath(payload, fallbackPayload) ?? '.';
    return { id, label: 'LIST', path: filePath };
  }

  if (isShellTool(toolName)) {
    const command = getStringField(args, ['cmd', 'command', 'script']) ?? '(command tidak tersedia)';
    return { id, label: 'SHELL', path: compactText(command, 90) };
  }

  return undefined;
};

const createExploreEvent = (
  id: number,
  prompt: string,
  payload: ToolPayload,
  fallbackPayload: ToolPayload | undefined,
  startedAt: number,
  assistantText: string,
): ExploreEvent | undefined => {
  const toolName = payload.toolName ?? fallbackPayload?.toolName;
  if (!isExploreTool(toolName)) {
    return undefined;
  }

  const args = getPayloadArgs(payload, fallbackPayload);
  const query = getStringField(args, ['query', 'pattern']);
  const title = compactText(prompt || query || 'Explore workspace');
  const child = createExploreChildEvent(id, payload, fallbackPayload);

  return {
    id,
    type: 'explore',
    label: 'EXPLORE',
    title,
    status: 'running',
    startedAt,
    elapsedSeconds: 0,
    tokenEstimate: estimateTokens([prompt, assistantText, JSON.stringify(args ?? {})]),
    children: child ? [child] : [],
  };
};

const createEditEvent = (id: number, payload: ToolPayload, fallbackPayload?: ToolPayload): EditEvent | undefined => {
  const toolName = payload.toolName ?? fallbackPayload?.toolName;
  if (!isEditTool(toolName)) {
    return undefined;
  }

  const args = getPayloadArgs(payload, fallbackPayload);
  const filePath = getPayloadPath(payload, fallbackPayload);

  if (!filePath) {
    return undefined;
  }

  const oldText = typeof args?.old_string === 'string' ? args.old_string : undefined;
  const newText = typeof args?.new_string === 'string' ? args.new_string : undefined;
  const content = typeof args?.content === 'string' ? args.content : undefined;
  const startLine = findStartLine(filePath, newText ?? content) ?? (content ? 1 : undefined);
  const additions = toolName === 'mastra_workspace_write_file' ? countLines(content) : countLines(newText);
  const removals = toolName === 'mastra_workspace_write_file' ? 0 : countLines(oldText);
  const previewLines =
    oldText !== undefined && newText !== undefined
      ? buildEditPreviewLines(oldText, newText, startLine)
      : buildWritePreviewLines(content ?? '', startLine ?? 1);
  const { visibleLines, hiddenLines } = clampPreviewLines(previewLines);

  return {
    id,
    type: 'edit',
    label: 'EDIT',
    path: filePath,
    additions,
    removals,
    hiddenLines,
    lines: visibleLines,
    diff: createUnifiedDiff(filePath, visibleLines, additions, removals),
    filetype: filetypeFromPath(filePath),
    diffHeight: Math.min(10, Math.max(3, visibleLines.length + 1)),
  };
};

const buildStreamBlocks = (events: StreamEvent[]) => {
  const blocks: Array<
    | { id: number; type: 'text'; content: string }
    | { id: number; type: 'assistant'; content: string }
    | RunEvent
    | ToolCardEvent
  > = [];
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

    flushTextBlock();
    flushAssistantBlock();
    blocks.push(event);
  }

  flushTextBlock();
  flushAssistantBlock();

  return blocks;
};

function useAgentStream() {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [request, setRequest] = useState<StreamRequest | null>(null);
  const nextLineIdRef = useRef(0);

  useEffect(() => {
    if (!request) {
      return;
    }

    let cancelled = false;
    let activeResponseLineId: number | null = null;
    let assistantText = '';
    let currentTaskIndex: number | null = null;
    let hasStructuredTaskList = false;
    const toolDescriptions = new Map<string, string>();
    const toolPayloads = new Map<string, ToolPayload>();
    const toolStartedAt = new Map<string, number>();
    const activeToolLines = new Map<number, string>();
    const activeToolLineByCallId = new Map<string, number>();
    const pendingToolLineByName = new Map<string, number>();
    const spinnerFrames = ['[.  ]', '[.. ]', '[...]'];
    let spinnerFrameIndex = 0;
    let activeExploreEventId: number | null = null;

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

    const appendRunEvent = (prompt: string) => {
      const eventId = nextLineIdRef.current;
      nextLineIdRef.current += 1;
      setEvents((current) => [
        ...current,
        {
          id: eventId,
          type: 'run',
          label: 'RUN',
          prompt,
          agent: 'openai-compatible-agent',
          status: 'waiting',
        },
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
          if (event.id !== exploreEventId || event.type !== 'explore') {
            return event;
          }

          if (event.children.some((item) => item.label === child.label && item.path === child.path)) {
            return event;
          }

          return { ...event, children: [...event.children, child] };
        }),
      );
    };

    const updateRunningExploreEvents = (status?: ExploreEvent['status']) => {
      const now = Date.now();
      setEvents((current) =>
        current.map((event) => {
          if (event.type !== 'explore' || event.status !== 'running') {
            return event;
          }

          return {
            ...event,
            status: status ?? event.status,
            elapsedSeconds: Math.max(0, Math.round((now - event.startedAt) / 1000)),
            tokenEstimate: estimateTokens([request.prompt, assistantText]),
          };
        }),
      );
    };

    const progressText = (description: string) => {
      return `${spinnerFrames[spinnerFrameIndex]} ${description}`;
    };

    const startProgressLine = (description: string) => {
      activeResponseLineId = null;
      const lineId = appendLine(progressText(description));
      activeToolLines.set(lineId, description);
      return lineId;
    };

    const updateProgressLine = (lineId: number, description: string) => {
      activeToolLines.set(lineId, description);
      updateLine(lineId, progressText(description));
    };

    const finishProgressLine = (lineId: number, marker: '[x]' | '[!]', description: string) => {
      activeToolLines.delete(lineId);
      updateLine(lineId, `${marker} ${description}`);
    };

    const spinnerInterval = setInterval(() => {
      if (activeToolLines.size === 0) {
        return;
      }

      spinnerFrameIndex = (spinnerFrameIndex + 1) % spinnerFrames.length;
      setEvents((current) =>
        current.map((event) => {
          if (event.type === 'explore' && event.status === 'running') {
            return {
              ...event,
              elapsedSeconds: Math.max(0, Math.round((Date.now() - event.startedAt) / 1000)),
              tokenEstimate: estimateTokens([request.prompt, assistantText]),
            };
          }

          if (event.type === 'shell' && event.status === 'running') {
            return {
              ...event,
              elapsedSeconds: Math.max(0, Math.round((Date.now() - event.startedAt) / 1000)),
            };
          }

          if (event.type !== 'text') {
            return event;
          }

          const description = activeToolLines.get(event.id);
          return description ? { ...event, text: progressText(description) } : event;
        }),
      );
    }, 250);

    const cleanTaskText = (text: string) => {
      return text
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const extractTasks = () => {
      if (hasStructuredTaskList) {
        return;
      }

      const blocks: TaskItem[][] = [];
      let currentBlock: TaskItem[] = [];

      for (const line of assistantText.split('\n')) {
        const match = line.match(/^\s*(\d{1,2})\.\s+(.+)$/);

        if (!match) {
          if (currentBlock.length > 0) {
            blocks.push(currentBlock);
            currentBlock = [];
          }
          continue;
        }

        const index = Number(match[1]);
        const text = cleanTaskText(match[2] ?? '');

        if (!text) {
          continue;
        }

        currentBlock.push({
          index,
          text,
          done: false,
          current: false,
        });
      }

      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
      }

      const nextTasks = [...blocks].reverse().find((block) => block.length >= 2);

      if (!nextTasks || nextTasks.length === 0) {
        return;
      }

      setTasks((current) => {
        return nextTasks.map((task) => {
          const previous = current.find((item) => item.index === task.index);
          return previous ? { ...task, done: previous.done, current: previous.current } : task;
        });
      });
    };

    const updateTaskProgressFromText = () => {
      if (hasStructuredTaskList) {
        return;
      }

      const lowerText = assistantText.toLowerCase();

      setTasks((current) => {
        const nextTask = current.find((task) => {
          if (task.done || task.current) {
            return false;
          }

          const keywords = task.text
            .toLowerCase()
            .replace(/[`"'().,+/:-]/g, ' ')
            .split(/\s+/)
            .filter((word) => word.length >= 4 && !['create', 'add', 'file', 'with', 'yang', 'task'].includes(word));

          const matchedKeywords = keywords.filter((word) => lowerText.includes(word));
          return matchedKeywords.length >= Math.min(2, Math.max(1, keywords.length));
        });

        if (!nextTask || nextTask.index === currentTaskIndex) {
          return current;
        }

        currentTaskIndex = nextTask.index;
        return current.map((task) => ({
          ...task,
          done: task.done,
          current: task.index === nextTask.index,
        }));
      });
    };

    const asArgsRecord = (args: unknown) => {
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return undefined;
      }

      return args as Record<string, unknown>;
    };

    const getArgString = (args: unknown, keys: string[]) => {
      const record = asArgsRecord(args);
      if (!record) {
        return undefined;
      }

      for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
          return value;
        }
      }

      return undefined;
    };

    const summarizeArgs = (args: unknown) => {
      const record = asArgsRecord(args);
      if (!record) {
        return '';
      }

      const entries = Object.entries(record)
        .filter(([key]) => !['content', 'newContent', 'oldContent', 'replacement', 'old_string', 'new_string'].includes(key))
        .slice(0, 4)
        .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);

      return entries.length > 0 ? ` (${entries.join(', ')})` : '';
    };

    const isTaskListTool = (toolName: string | undefined) => {
      return toolName === 'tui_task_list' || toolName === 'tuiTaskListTool';
    };

    const applyTaskListTool = (payload: ToolPayload) => {
      const args = asArgsRecord(payload.args);
      if (!args || !isTaskListTool(payload.toolName)) {
        return;
      }

      hasStructuredTaskList = true;

      if (args.action === 'set' && Array.isArray(args.tasks)) {
        const nextTasks = args.tasks
          .map((item) => asArgsRecord(item))
          .filter((item): item is Record<string, unknown> => Boolean(item))
          .map((item) => {
            const index = typeof item.id === 'number' ? item.id : Number(item.id);
            const text = typeof item.title === 'string' ? cleanTaskText(item.title) : '';
            const status = typeof item.status === 'string' ? item.status : 'pending';

            return {
              index,
              text,
              done: status === 'completed',
              current: status === 'in_progress',
            };
          })
          .filter((item) => Number.isFinite(item.index) && item.text)
          .sort((a, b) => a.index - b.index);

        setTasks(nextTasks);
        currentTaskIndex = nextTasks.find((task) => task.current)?.index ?? null;
        return;
      }

      if (args.action === 'update') {
        const taskIndex = typeof args.taskId === 'number' ? args.taskId : Number(args.taskId);
        const status = typeof args.status === 'string' ? args.status : undefined;

        if (!Number.isFinite(taskIndex) || !status) {
          return;
        }

        if (status === 'in_progress') {
          currentTaskIndex = taskIndex;
        } else if (currentTaskIndex === taskIndex) {
          currentTaskIndex = null;
        }

        setTasks((current) =>
          current.map((task) =>
            task.index === taskIndex
              ? {
                  ...task,
                  done: status === 'completed',
                  current: status === 'in_progress',
                }
              : task,
          ),
        );
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
        case 'tui_task_list': {
          const record = asArgsRecord(args);
          if (record?.action === 'set' && Array.isArray(record.tasks)) {
            return `memperbarui checklist (${record.tasks.length} task)`;
          }
          if (record?.action === 'update') {
            return `memperbarui checklist task ${String(record.taskId ?? '?')} -> ${String(record.status ?? '?')}`;
          }
          return `memperbarui checklist`;
        }
        case 'tuiTaskListTool': {
          const record = asArgsRecord(args);
          if (record?.action === 'set' && Array.isArray(record.tasks)) {
            return `memperbarui checklist (${record.tasks.length} task)`;
          }
          if (record?.action === 'update') {
            return `memperbarui checklist task ${String(record.taskId ?? '?')} -> ${String(record.status ?? '?')}`;
          }
          return `memperbarui checklist`;
        }
        case 'mastra_workspace_read_file':
          return `membaca file ${(path ?? summarizeArgs(args)) || '(path tidak tersedia)'}`;
        case 'mastra_workspace_write_file':
          return `menulis file ${(path ?? summarizeArgs(args)) || '(path tidak tersedia)'}`;
        case 'mastra_workspace_edit_file':
          return `mengedit file ${(path ?? summarizeArgs(args)) || '(path tidak tersedia)'}`;
        case 'mastra_workspace_list_files':
          return `mencari file di direktori ${directory}${summarizeArgs(args)}`;
        case 'mastra_workspace_delete':
          return `menghapus ${(path ?? summarizeArgs(args)) || '(path tidak tersedia)'}`;
        case 'mastra_workspace_file_stat':
          return `cek metadata ${(path ?? summarizeArgs(args)) || '(path tidak tersedia)'}`;
        case 'mastra_workspace_mkdir':
          return `membuat direktori ${(path ?? summarizeArgs(args)) || '(path tidak tersedia)'}`;
        case 'mastra_workspace_grep':
          return `mencari teks ${pattern ? `"${pattern}"` : '(pattern tidak tersedia)'} di ${path ?? '.'}${summarizeArgs(args)}`;
        case 'mastra_workspace_shell':
        case 'mastra_workspace_execute_command':
          return `menjalankan shell ${(command ?? summarizeArgs(args)) || '(command tidak tersedia)'}${directory ? ` di ${directory}` : ''}`;
        default:
          return `${toolName}${summarizeArgs(args)}`;
      }
    };

    const appendDelta = (delta: string) => {
      assistantText += delta;
      extractTasks();
      updateTaskProgressFromText();

      const parts = delta.split('\n');

      for (const [index, part] of parts.entries()) {
        if (index > 0 || activeResponseLineId === null) {
          activeResponseLineId = appendAssistantLine('');
        }

        const targetLineId = activeResponseLineId;

        setEvents((current) => {
          return current.map((event) =>
            event.id === targetLineId && event.type === 'assistant'
              ? { ...event, text: `${event.text}${part}` }
              : event,
          );
        });
      }
    };

    const run = async () => {
      if (request.id > 0) {
        appendLine('');
      }

      const runEventId = appendRunEvent(request.prompt);

      try {
        const response = await openAICompatibleAgent.stream(request.prompt, {
          maxSteps: agentMaxSteps,
          memory: {
            resource: 'tui-user',
            thread: 'tui-session',
          },
        });
        updateRunEvent(runEventId, 'streaming');

        for await (const chunk of response.fullStream) {
          if (cancelled) return;

          if (chunk.type === 'text-delta') {
            appendDelta(chunk.payload.text);
          }

          if (chunk.type === 'tool-call') {
            applyTaskListTool(chunk.payload);
            const description = describeTool(chunk.payload);
            let lineId =
              (chunk.payload.toolCallId ? activeToolLineByCallId.get(chunk.payload.toolCallId) : undefined) ??
              (chunk.payload.toolName ? pendingToolLineByName.get(chunk.payload.toolName) : undefined);

            if (lineId === undefined) {
              lineId = startProgressLine(description);
            } else {
              updateProgressLine(lineId, description);
            }

            if (chunk.payload.toolCallId) {
              toolDescriptions.set(chunk.payload.toolCallId, description);
              toolPayloads.set(chunk.payload.toolCallId, chunk.payload);
              toolStartedAt.set(chunk.payload.toolCallId, Date.now());
              activeToolLineByCallId.set(chunk.payload.toolCallId, lineId);
            }

            if (chunk.payload.toolName) {
              pendingToolLineByName.delete(chunk.payload.toolName);
            }

            const exploreEvent = createExploreEvent(
              lineId,
              request.prompt,
              chunk.payload,
              undefined,
              chunk.payload.toolCallId ? (toolStartedAt.get(chunk.payload.toolCallId) ?? Date.now()) : Date.now(),
              assistantText,
            );
            const shellEvent = createShellEvent(
              lineId,
              chunk.payload,
              undefined,
              chunk.payload.toolCallId ? (toolStartedAt.get(chunk.payload.toolCallId) ?? Date.now()) : Date.now(),
              'running',
            );
            const taskListEvent = createTaskListEvent(lineId, chunk.payload, undefined, 'running');

            if (exploreEvent) {
              activeExploreEventId = lineId;
              replaceLineWithToolEvent(lineId, exploreEvent);
            } else if (shellEvent) {
              replaceLineWithToolEvent(lineId, shellEvent);
            } else if (taskListEvent) {
              replaceLineWithToolEvent(lineId, taskListEvent);
            }
          }

          if (chunk.type === 'tool-call-input-streaming-start') {
            const description = isTaskListTool(chunk.payload.toolName)
              ? 'menyiapkan checklist'
              : `menyiapkan argumen ${chunk.payload.toolName ?? 'unknown'}`;
            const lineId = startProgressLine(description);

            if (chunk.payload.toolName) {
              pendingToolLineByName.set(chunk.payload.toolName, lineId);
            }
          }

          if (chunk.type === 'tool-result') {
            const description =
              (chunk.payload.toolCallId && toolDescriptions.get(chunk.payload.toolCallId)) || describeTool(chunk.payload);
            const lineId =
              (chunk.payload.toolCallId && activeToolLineByCallId.get(chunk.payload.toolCallId)) || undefined;
            const fallbackPayload = chunk.payload.toolCallId ? toolPayloads.get(chunk.payload.toolCallId) : undefined;
            const toolName = chunk.payload.toolName ?? fallbackPayload?.toolName;
            const editEvent = createEditEvent(
              lineId ?? nextLineIdRef.current,
              chunk.payload,
              fallbackPayload,
            );
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
              'done',
            );
            const taskListEvent = createTaskListEvent(
              lineId ?? nextLineIdRef.current,
              chunk.payload,
              fallbackPayload,
              'done',
            );

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
              if (child) {
                addExploreChild(activeExploreEventId, child);
              }
              if (lineId !== undefined) {
                removeEvent(lineId);
                activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
              }
            } else if (readEvent && lineId !== undefined) {
              replaceLineWithToolEvent(lineId, readEvent);
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            } else if (readEvent) {
              nextLineIdRef.current += 1;
              appendToolEvent(readEvent);
            } else if (exploreEvent && lineId !== undefined) {
              activeExploreEventId = lineId;
              replaceLineWithToolEvent(lineId, exploreEvent);
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            } else if (exploreEvent) {
              activeExploreEventId = exploreEvent.id;
              nextLineIdRef.current += 1;
              appendToolEvent(exploreEvent);
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
            } else if (activeExploreEventId !== null && isExploreTool(toolName)) {
              const child = createExploreChildEvent(lineId ?? nextLineIdRef.current, chunk.payload, fallbackPayload);
              if (child) {
                addExploreChild(activeExploreEventId, child);
              }
              if (lineId !== undefined) {
                removeEvent(lineId);
                activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
              }
            } else if (lineId === undefined) {
              appendLogLine(`[x] ${description}`);
            } else {
              finishProgressLine(lineId, '[x]', description);
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            }
          }

          if (chunk.type === 'tool-error') {
            const description =
              (chunk.payload.toolCallId && toolDescriptions.get(chunk.payload.toolCallId)) || describeTool(chunk.payload);
            const lineId =
              (chunk.payload.toolCallId && activeToolLineByCallId.get(chunk.payload.toolCallId)) || undefined;
            const fallbackPayload = chunk.payload.toolCallId ? toolPayloads.get(chunk.payload.toolCallId) : undefined;
            const toolName = chunk.payload.toolName ?? fallbackPayload?.toolName;

            if (isExploreTool(toolName)) {
              updateRunningExploreEvents('error');
              activeExploreEventId = null;
            }

            const shellEvent = createShellEvent(
              lineId ?? nextLineIdRef.current,
              chunk.payload,
              fallbackPayload,
              chunk.payload.toolCallId ? (toolStartedAt.get(chunk.payload.toolCallId) ?? Date.now()) : Date.now(),
              'error',
            );
            const taskListEvent = createTaskListEvent(
              lineId ?? nextLineIdRef.current,
              chunk.payload,
              fallbackPayload,
              'error',
            );

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
            } else if (lineId === undefined) {
              appendLogLine(`[!] ${description}`);
            } else {
              finishProgressLine(lineId, '[!]', description);
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            }
          }
        }

        if (cancelled) return;
        updateRunningExploreEvents('done');
        activeExploreEventId = null;
        updateRunEvent(runEventId, 'done');
        setStatus('finished');
      } catch (error) {
        if (cancelled) return;
        updateRunEvent(runEventId, 'error');
        const message = error instanceof Error ? error.message : String(error);
        appendLine(`error: ${message}`);
        setStatus('error');
      }
    };

    void run();

    return () => {
      cancelled = true;
      clearInterval(spinnerInterval);
    };
  }, [request]);

  const submitPrompt = useCallback(
    (nextPrompt: string) => {
      const trimmedPrompt = nextPrompt.trim();

      if (!trimmedPrompt || status === 'streaming') {
        return false;
      }

      setRequest((current) => ({
        id: (current?.id ?? -1) + 1,
        prompt: trimmedPrompt,
      }));

      return true;
    },
    [status],
  );

  const clearMemory = useCallback(async () => {
    try {
      const memory = await openAICompatibleAgent.getMemory();
      if (memory) {
        await memory.deleteThread('tui-session');
      }
    } catch {
      // silently ignore — memory may not be initialized
    }

    setEvents([]);
    setTasks([]);
    setStatus('idle');
    setRequest(null);
    nextLineIdRef.current = 0;
  }, []);

  return { events, tasks, status, submitPrompt, clearMemory };
}

function plural(value: number, singular: string, pluralText: string) {
  return `${value} ${value === 1 ? singular : pluralText}`;
}

function Badge({ label, bg = purpleBg }: { label: string; bg?: string }) {
  return (
    <text
      content={` ${label} `}
      style={{ fg: '#ffffff', bg, attributes: TextAttributes.BOLD }}
    />
  );
}

function TaskListPanel({
  tasks,
  sidePanel,
  terminalWidth,
}: {
  tasks: TaskItem[];
  sidePanel: boolean;
  terminalWidth: number;
}) {
  const completedTasks = tasks.filter((task) => task.done).length;
  const panelWidth = sidePanel ? Math.min(56, Math.max(42, Math.floor(terminalWidth * 0.3))) : terminalWidth;
  const taskTextMaxLength = sidePanel ? Math.max(20, panelWidth - 14) : Math.max(48, terminalWidth - 8);

  return (
    <box
      style={{
        width: sidePanel ? panelWidth : '100%',
        height: sidePanel ? '100%' : undefined,
        flexDirection: 'column',
        flexShrink: 0,
        border: sidePanel,
        paddingLeft: sidePanel ? 1 : 0,
        paddingRight: sidePanel ? 1 : 0,
      }}
    >
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label="TASK LIST" bg={taskBg} />
        <text content={`  ${completedTasks}/${tasks.length}`} style={{ fg: mutedFg }} />
      </box>
      {tasks.map((task) => {
        const suffix = task.current ? ' (sedang dikerjakan)' : '';
        const availableTextLength = Math.max(16, taskTextMaxLength - suffix.length);
        const content = `${task.done ? '[x]' : '[ ]'} ${task.index}. ${compactText(task.text, availableTextLength)}${suffix}`;

        return (
          <text
            key={task.index}
            content={content}
            style={{
              fg: task.done ? mutedFg : textFg,
              attributes: task.current ? TextAttributes.BOLD : undefined,
            }}
          />
        );
      })}
    </box>
  );
}

function AssistantMessageView({ content, streaming }: { content: string; streaming: boolean }) {
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

function RunEventView({ event }: { event: RunEvent }) {
  const statusText =
    event.status === 'waiting'
      ? 'Menunggu streaming response'
      : event.status === 'streaming'
        ? 'Streaming response'
        : event.status === 'error'
          ? 'Error'
          : 'Selesai';

  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} bg={runBg} />
        <text content="  " />
        <text content={event.prompt} style={{ fg: pathFg, attributes: TextAttributes.BOLD }} />
      </box>
      <text>
        <span fg={branchFg}>{'└ '}</span>
        <span fg={mutedFg}>{'agent '}</span>
        <span fg={textFg}>{event.agent}</span>
        <span fg={mutedFg}>{` · ${statusText}`}</span>
      </text>
    </box>
  );
}

function ReadEventView({ event }: { event: ReadEvent }) {
  return (
    <box style={{ width: '100%', flexDirection: 'row' }}>
      <Badge label={event.label} />
      <text content="  " />
      <text>
        <span fg={textFg}>{`[${event.path}]`}</span>
        <span fg={mutedFg}>{` ${formatLineCount(event.lines)}`}</span>
      </text>
    </box>
  );
}

function ShellEventView({ event }: { event: ShellEvent }) {
  const statusLabel =
    event.status === 'running'
      ? `Running (${event.elapsedSeconds}s)`
      : event.status === 'error'
        ? `Failed (${event.elapsedSeconds}s)`
        : `Done (${event.elapsedSeconds}s)`;

  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} bg={shellBg} />
        <text content="  " />
        <text content={event.command} style={{ fg: pathFg, attributes: TextAttributes.BOLD }} />
      </box>
      <text>
        <span fg={branchFg}>{'└ '}</span>
        <span fg={event.status === 'error' ? redFg : mutedFg}>{statusLabel}</span>
        <span fg={mutedFg}>{` di ${event.directory}`}</span>
      </text>
    </box>
  );
}

function TaskListEventView({ event }: { event: TaskListEvent }) {
  const statusText =
    event.status === 'running' ? 'Running' : event.status === 'error' ? 'Failed' : 'Done';

  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} bg={taskBg} />
        <text content="  " />
        <text content={event.summary} style={{ fg: pathFg, attributes: TextAttributes.BOLD }} />
      </box>
      <text>
        <span fg={branchFg}>{'└ '}</span>
        <span fg={event.status === 'error' ? redFg : mutedFg}>{statusText}</span>
      </text>
    </box>
  );
}

function ExploreEventView({ event }: { event: ExploreEvent }) {
  const statusText =
    event.status === 'running'
      ? `Running (${event.elapsedSeconds}s | ${formatTokenCount(event.tokenEstimate)} tokens).`
      : event.status === 'error'
        ? `Failed (${event.elapsedSeconds}s | ${formatTokenCount(event.tokenEstimate)} tokens).`
        : `Done (${event.elapsedSeconds}s | ${formatTokenCount(event.tokenEstimate)} tokens).`;

  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} bg={exploreBg} />
      </box>
      <text>
        <span fg={branchFg}>{'└ '}</span>
        <span fg={event.status === 'error' ? redFg : mutedFg}>{statusText}</span>
      </text>
      {event.children.map((child) => (
        <text key={`${event.id}-${child.id}-${child.label}-${child.path}`}>
          <span fg={branchFg}>{'└ '}</span>
          <span fg={branchFg}>{child.label}</span>
          <span fg={branchFg}>{` (${child.path})`}</span>
        </text>
      ))}
    </box>
  );
}

function EditEventView({ event }: { event: EditEvent }) {
  const removalSummary = event.removals > 0 ? `, ${plural(event.removals, 'removal', 'removals')}` : '';

  return (
    <box style={{ width: '100%', flexDirection: 'column' }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label={event.label} />
        <text content="  " />
        <text content={event.path} style={{ fg: pathFg, attributes: TextAttributes.BOLD }} />
      </box>
      <text>
        <span fg={mutedFg}>{'└ Updated '}</span>
        <span fg={pathFg} attributes={TextAttributes.BOLD}>{event.path}</span>
        <span fg={mutedFg}>{' with '}</span>
        <span fg={greenFg}>{plural(event.additions, 'addition', 'additions')}</span>
        <span fg={mutedFg}>{removalSummary}</span>
      </text>
      <box style={{ width: '100%', flexDirection: 'column', marginLeft: 2 }}>
        <diff
          diff={event.diff}
          view="unified"
          filetype={event.filetype}
          showLineNumbers
          wrapMode="none"
          height={event.diffHeight}
          width="100%"
          lineNumberFg={mutedFg}
          addedBg={greenBg}
          removedBg={redBg}
          addedSignColor={greenFg}
          removedSignColor={redFg}
          fg={textFg}
        />
        {event.hiddenLines > 0 ? (
          <text content={`… (${event.hiddenLines} more lines) [ctrl+o to expand]`} style={{ fg: mutedFg }} />
        ) : null}
      </box>
    </box>
  );
}

function StreamView({ events, status }: { events: StreamEvent[]; status: StreamStatus }) {
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

function App({ onExit }: { onExit: () => void }) {
  const { events, tasks, status, submitPrompt, clearMemory } = useAgentStream();
  const [inputValue, setInputValue] = useState('');
  const { width: terminalWidth } = useTerminalDimensions();
  const hasTasks = tasks.length > 0;
  const showSideTasks = hasTasks && terminalWidth >= 132;
  const allTasksDone = hasTasks && tasks.every((task) => task.done);
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
      onExit();
    }
  });

  const handleSubmit = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }

    const trimmedValue = value.trim();

    if (trimmedValue === '/clear' && status !== 'streaming') {
      setInputValue('');
      void clearMemory();
      return;
    }

    if (submitPrompt(value)) {
      setInputValue('');
    }
  };

  return (
    <box style={{ width: '100%', height: '100%', flexDirection: 'column' }}>
      {hasTasks && !showSideTasks ? (
        <TaskListPanel tasks={tasks} sidePanel={false} terminalWidth={terminalWidth} />
      ) : null}
      <box style={{ width: '100%', flexGrow: 1, flexShrink: 1, flexBasis: 0, flexDirection: 'row' }}>
        <scrollbox
          focused
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
        <Badge label={footerState.label} bg={footerState.bg} />
        <text content="  " />
        <text content={footerState.text} style={{ fg: mutedFg }} />
      </box>
      <box style={{ width: '100%', flexDirection: 'row', flexShrink: 0 }}>
        <text content="> " style={{ fg: assistantMarkerFg }} />
        <input
          focused
          value={inputValue}
          placeholder={status === 'streaming' ? 'tunggu streaming selesai...' : 'ketik instruksi lalu enter'}
          onInput={setInputValue}
          onSubmit={handleSubmit}
          style={{ flexGrow: 1 }}
        />
      </box>
    </box>
  );
}

const renderer = await createCliRenderer();
const root = createRoot(renderer);

const exit = () => {
  root.unmount();
  renderer.destroy();
  process.exit(0);
};

root.render(<App onExit={exit} />);
