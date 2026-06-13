import { SyntaxStyle, TextAttributes, createCliRenderer } from '@opentui/core';
import { createRoot, useKeyboard } from '@opentui/react';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openAICompatibleAgent } from '../mastra/agents/openai-compatible-agent';

type StreamTextEvent = {
  id: number;
  type: 'text';
  text: string;
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

type StreamEvent = StreamTextEvent | EditEvent;

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
const mutedFg = '#7e8494';
const textFg = '#e8edf7';
const pathFg = '#f2f5ff';
const purpleBg = '#5a3fc8';
const greenFg = '#2fd26f';
const greenBg = '#00583c';
const redFg = '#f87171';
const redBg = '#4a1d24';

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

const resolveWorkspaceFile = (filePath: string) => {
  return isAbsolute(filePath) ? filePath : join(workspacePath, filePath);
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
  const oldLength = Math.max(1, lines.filter((line) => line.marker !== '+').length || removals);
  const newLength = Math.max(1, lines.filter((line) => line.marker !== '-').length || additions);
  const body = lines.map((line) => `${line.marker}${line.text}`).join('\n');

  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${firstLineNumber},${oldLength} +${firstLineNumber},${newLength} @@`,
    body,
    '',
  ].join('\n');
};

const isEditTool = (toolName: string | undefined) => {
  return toolName === 'mastra_workspace_edit_file' || toolName === 'mastra_workspace_write_file';
};

const createEditEvent = (id: number, payload: ToolPayload, fallbackPayload?: ToolPayload): EditEvent | undefined => {
  const toolName = payload.toolName ?? fallbackPayload?.toolName;
  if (!isEditTool(toolName)) {
    return undefined;
  }

  const args = isRecord(payload.args) ? payload.args : isRecord(fallbackPayload?.args) ? fallbackPayload.args : undefined;
  const filePath = getStringField(args, ['path', 'filePath', 'filepath', 'file', 'targetPath', 'target']);

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
    diffHeight: Math.min(14, Math.max(7, visibleLines.length + 5)),
  };
};

const buildStreamBlocks = (events: StreamEvent[]) => {
  const blocks: Array<{ id: number; type: 'text'; content: string } | EditEvent> = [];
  let textBlock: { id: number; lines: string[] } | undefined;

  for (const event of events) {
    if (event.type === 'text') {
      if (!textBlock) {
        textBlock = { id: event.id, lines: [] };
      }
      textBlock.lines.push(event.text);
      continue;
    }

    if (textBlock) {
      blocks.push({ id: textBlock.id, type: 'text', content: textBlock.lines.join('\n') });
      textBlock = undefined;
    }
    blocks.push(event);
  }

  if (textBlock) {
    blocks.push({ id: textBlock.id, type: 'text', content: textBlock.lines.join('\n') });
  }

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
    const activeToolLines = new Map<number, string>();
    const activeToolLineByCallId = new Map<string, number>();
    const pendingToolLineByName = new Map<string, number>();
    const spinnerFrames = ['[.  ]', '[.. ]', '[...]'];
    let spinnerFrameIndex = 0;

    setStatus('streaming');

    const appendLine = (text: string) => {
      const lineId = nextLineIdRef.current;
      nextLineIdRef.current += 1;
      setEvents((current) => [...current, { id: lineId, type: 'text', text }]);
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

    const replaceLineWithEdit = (lineId: number, editEvent: EditEvent) => {
      activeToolLines.delete(lineId);
      setEvents((current) => current.map((event) => (event.id === lineId ? { ...editEvent, id: lineId } : event)));
    };

    const appendEdit = (editEvent: EditEvent) => {
      setEvents((current) => [...current, editEvent]);
    };

    const progressText = (description: string) => {
      return `${spinnerFrames[spinnerFrameIndex]} ${description}`;
    };

    const startProgressLine = (description: string) => {
      activeResponseLineId = null;
      appendLine('');
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
          activeResponseLineId = appendLine('');
        }

        const targetLineId = activeResponseLineId;

        setEvents((current) => {
          return current.map((event) =>
            event.id === targetLineId && event.type === 'text' ? { ...event, text: `${event.text}${part}` } : event,
          );
        });
      }
    };

    const run = async () => {
      if (request.id > 0) {
        appendLine('');
      }

      appendLine(`prompt: ${request.prompt}`);
      appendLine('menjalankan agent: openai-compatible-agent');
      appendLine('menunggu streaming response...');

      try {
        const response = await openAICompatibleAgent.stream(request.prompt, {
          maxSteps: 25,
          memory: {
            resource: 'tui-user',
            thread: 'tui-session',
          },
        });

        appendLine('');
        appendLine('assistant:');

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
              activeToolLineByCallId.set(chunk.payload.toolCallId, lineId);
            }

            if (chunk.payload.toolName) {
              pendingToolLineByName.delete(chunk.payload.toolName);
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
            const editEvent = createEditEvent(
              lineId ?? nextLineIdRef.current,
              chunk.payload,
              fallbackPayload,
            );

            if (editEvent && lineId !== undefined) {
              replaceLineWithEdit(lineId, editEvent);
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            } else if (editEvent) {
              nextLineIdRef.current += 1;
              appendEdit(editEvent);
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

            if (lineId === undefined) {
              appendLogLine(`[!] ${description}`);
            } else {
              finishProgressLine(lineId, '[!]', description);
              activeToolLineByCallId.delete(chunk.payload.toolCallId ?? '');
            }
          }
        }

        if (cancelled) return;
        appendLine('');
        appendLine('streaming response selesai');
        setStatus('finished');
      } catch (error) {
        if (cancelled) return;
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

  return { events, tasks, status, submitPrompt };
}

function plural(value: number, singular: string, pluralText: string) {
  return `${value} ${value === 1 ? singular : pluralText}`;
}

function EditEventView({ event }: { event: EditEvent }) {
  const removalSummary = event.removals > 0 ? `, ${plural(event.removals, 'removal', 'removals')}` : '';

  return (
    <box style={{ width: '100%', flexDirection: 'column', marginTop: 1, marginBottom: 1 }}>
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <text
          content={` ${event.label} `}
          style={{ fg: '#ffffff', bg: purpleBg, attributes: TextAttributes.BOLD }}
        />
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
        ) : (
          <EditEventView key={block.id} event={block} />
        ),
      )}
    </box>
  );
}

function App({ onExit }: { onExit: () => void }) {
  const { events, tasks, status, submitPrompt } = useAgentStream();
  const [inputValue, setInputValue] = useState('');
  const hasTasks = tasks.length > 0;
  const allTasksDone = hasTasks && tasks.every((task) => task.done);
  const footerText =
    status === 'idle'
      ? 'ketik instruksi lalu enter | esc keluar'
      : status === 'streaming'
      ? 'streaming | scroll: panah/page up/page down | esc keluar'
      : status === 'error'
        ? 'error | enter kirim | esc keluar'
        : allTasksDone
          ? 'task selesai | enter kirim | esc keluar'
          : 'stream berhenti, task belum selesai | enter kirim | esc keluar';
  const paddedFooterText = footerText.padEnd(160, ' ');

  useKeyboard((key) => {
    if (key.name === 'escape') {
      onExit();
    }
  });

  const handleSubmit = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }

    if (submitPrompt(value)) {
      setInputValue('');
    }
  };

  return (
    <box style={{ width: '100%', height: '100%', flexDirection: 'column' }}>
      {tasks.length > 0 ? (
        <box style={{ width: '100%', flexDirection: 'column', flexShrink: 0 }}>
          <text content="task list:" />
          {tasks.map((task) => (
            <text
              key={task.index}
              content={`${task.done ? '[x]' : '[ ]'} ${task.index}. ${task.text}${task.current ? ' (sedang dikerjakan)' : ''}`}
            />
          ))}
          <text content="" />
        </box>
      ) : null}
      <scrollbox
        focused
        stickyScroll
        stickyStart="bottom"
        scrollY
        style={{ width: '100%', flexGrow: 1 }}
      >
        <StreamView events={events} status={status} />
      </scrollbox>
      <box style={{ width: '100%', flexShrink: 0 }}>
        <text content={paddedFooterText} />
      </box>
      <box style={{ width: '100%', flexDirection: 'row', flexShrink: 0 }}>
        <text content="> " />
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
