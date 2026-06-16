import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { workspacePath } from './constants';
import type {
  EditEvent,
  ExploreChildEvent,
  ExploreEvent,
  ReadEvent,
  ShellEvent,
  TaskListEvent,
  ToolPayload,
} from './types';
import {
  buildEditPreviewLines,
  buildWritePreviewLines,
  clampPreviewLines,
  compactText,
  countFileLines,
  countLines,
  createUnifiedDiff,
  estimateTokens,
  filetypeFromPath,
  getPayloadArgs,
  getPayloadPath,
  getResultText,
  getStringField,
} from './utils';

export const isEditTool = (toolName: string | undefined) => {
  return toolName === 'mastra_workspace_edit_file' || toolName === 'mastra_workspace_write_file';
};

export const isReadTool = (toolName: string | undefined) => {
  return toolName === 'mastra_workspace_read_file';
};

export const isExploreTool = (toolName: string | undefined) => {
  return (
    toolName === 'mastra_workspace_list_files' ||
    toolName === 'mastra_workspace_grep' ||
    toolName === 'mastra_workspace_search'
  );
};

export const isShellTool = (toolName: string | undefined) => {
  return toolName === 'mastra_workspace_shell' || toolName === 'mastra_workspace_execute_command';
};

export const isTaskListToolName = (toolName: string | undefined) => {
  return toolName === 'tuiTaskList';
};

const findStartLine = (filePath: string, needle: string | undefined) => {
  if (!needle) {
    return undefined;
  }

  const absolutePath = isAbsolute(filePath) ? filePath : join(workspacePath, filePath);
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

export const createShellEvent = (
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
  const command = getStringField(args, ['cmd', 'command', 'script']) ?? '(command unavailable)';
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

export const summarizeTaskList = (payload: ToolPayload, fallbackPayload?: ToolPayload) => {
  const args = getPayloadArgs(payload, fallbackPayload);

  if (args?.action === 'set' && Array.isArray(args.tasks)) {
    return `updating checklist (${args.tasks.length} tasks)`;
  }

  if (args?.action === 'update') {
    return `updating checklist task ${String(args.taskId ?? '?')} -> ${String(args.status ?? '?')}`;
  }

  return 'updating checklist';
};

export const createTaskListEvent = (
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

export const createReadEvent = (id: number, payload: ToolPayload, fallbackPayload?: ToolPayload): ReadEvent | undefined => {
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

export const createExploreChildEvent = (
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
    const command = getStringField(args, ['cmd', 'command', 'script']) ?? '(command unavailable)';
    return { id, label: 'SHELL', path: compactText(command, 90) };
  }

  return undefined;
};

export const createExploreEvent = (
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
  const resultText = getResultText(payload.result) ?? getResultText(fallbackPayload?.result);
  return {
    id,
    type: 'explore',
    label: 'EXPLORE',
    title,
    status: 'running',
    startedAt,
    elapsedSeconds: 0,
    tokenEstimate: estimateTokens([JSON.stringify(args ?? {}), resultText ?? '']),
    children: child ? [child] : [],
  };
};

export const createEditEvent = (id: number, payload: ToolPayload, fallbackPayload?: ToolPayload): EditEvent | undefined => {
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
