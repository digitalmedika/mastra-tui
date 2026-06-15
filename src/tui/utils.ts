import type { SelectOption } from '@opentui/core';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { workspacePath } from './constants';
import type { EditPreviewLine, TokenUsage, ToolPayload, TuiSession } from './types';

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

export const getStringField = (record: Record<string, unknown> | undefined, keys: string[]) => {
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

export const toContentLines = (content: string) => {
  const lines = content.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
};

export const countLines = (content: string | undefined) => {
  if (!content) {
    return 0;
  }
  return toContentLines(content).length;
};

export const formatLineCount = (lineCount: number) => {
  return `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}`;
};

export const estimateTokens = (parts: string[]) => {
  const characters = parts.reduce((total, part) => total + part.length, 0);
  return Math.max(1, Math.round(characters / 4));
};

export const formatTokenCount = (tokens: number) => {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }

  return String(tokens);
};

const getNumberField = (record: Record<string, unknown> | undefined, keys: string[]) => {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
};

const getRecordField = (record: Record<string, unknown> | undefined, keys: string[]) => {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) {
      return value;
    }
  }

  return undefined;
};

const sumDefined = (...values: Array<number | undefined>) => {
  const defined = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return defined.length > 0 ? defined.reduce((total, value) => total + value, 0) : undefined;
};

export const normalizeTokenUsage = (usage: unknown, providerMetadata?: unknown): TokenUsage | undefined => {
  if (!isRecord(usage)) {
    return undefined;
  }

  // Try to get data from raw object if it exists
  const rawData = getRecordField(usage, ['raw']);

  const inputDetails =
    getRecordField(usage, ['inputTokenDetails', 'inputTokensDetails', 'inputDetails', 'promptTokenDetails', 'promptTokensDetails']) ??
    getRecordField(usage, ['input']);
  const outputDetails =
    getRecordField(usage, ['outputTokenDetails', 'outputTokensDetails', 'outputDetails', 'completionTokenDetails', 'completionTokensDetails']) ??
    getRecordField(usage, ['output']);

  // Try to extract from raw data first, then fall back to standard fields
  const inputTokens =
    getNumberField(rawData, ['prompt_tokens', 'promptTokens', 'inputTokens', 'input_tokens']) ??
    getNumberField(usage, ['inputTokens', 'promptTokens', 'input_tokens', 'prompt_tokens']) ??
    sumDefined(
      getNumberField(inputDetails, ['text', 'textTokens']),
      getNumberField(inputDetails, ['audio', 'audioTokens']),
      getNumberField(inputDetails, ['image', 'imageTokens']),
      getNumberField(inputDetails, ['cacheRead', 'cacheReadTokens', 'cachedInputTokens']),
      getNumberField(inputDetails, ['cacheWrite', 'cacheWriteTokens']),
    );
  const outputTokens =
    getNumberField(rawData, ['completion_tokens', 'completionTokens', 'outputTokens', 'output_tokens']) ??
    getNumberField(usage, ['outputTokens', 'completionTokens', 'output_tokens', 'completion_tokens']) ??
    sumDefined(
      getNumberField(outputDetails, ['text', 'textTokens']),
      getNumberField(outputDetails, ['reasoning', 'reasoningTokens']),
      getNumberField(outputDetails, ['audio', 'audioTokens']),
      getNumberField(outputDetails, ['image', 'imageTokens']),
    );
  const totalTokens =
    getNumberField(rawData, ['total_tokens', 'totalTokens']) ??
    getNumberField(usage, ['totalTokens', 'total_tokens']) ??
    sumDefined(inputTokens, outputTokens);

  const providerRecord = isRecord(providerMetadata) ? providerMetadata : undefined;
  const providerInputDetails =
    getRecordField(providerRecord, ['inputTokenDetails', 'inputTokensDetails', 'inputDetails', 'usage']) ??
    getRecordField(getRecordField(providerRecord, ['anthropic', 'openai', 'google']), ['inputTokenDetails', 'inputTokensDetails', 'inputDetails', 'usage']);

  const cachedInputTokens =
    getNumberField(usage, ['cachedInputTokens', 'cached_input_tokens']) ??
    getNumberField(inputDetails, ['cachedInputTokens', 'cached', 'cachedTokens']) ??
    getNumberField(providerInputDetails, ['cachedInputTokens', 'cached_input_tokens', 'cached', 'cachedTokens']);
  const cacheReadTokens =
    getNumberField(usage, ['cacheReadTokens', 'cache_read_tokens']) ??
    getNumberField(inputDetails, ['cacheRead', 'cacheReadTokens', 'cache_read', 'cache_read_tokens']) ??
    getNumberField(providerInputDetails, ['cacheRead', 'cacheReadTokens', 'cache_read', 'cache_read_tokens']) ??
    cachedInputTokens;
  const cacheWriteTokens =
    getNumberField(usage, ['cacheWriteTokens', 'cache_write_tokens']) ??
    getNumberField(inputDetails, ['cacheWrite', 'cacheWriteTokens', 'cache_write', 'cache_write_tokens']) ??
    getNumberField(providerInputDetails, ['cacheWrite', 'cacheWriteTokens', 'cache_write', 'cache_write_tokens']);

  if ([inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, cachedInputTokens].every((value) => value === undefined)) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cachedInputTokens,
  };
};

export const compactText = (text: string, maxLength = 90) => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

export const formatSessionDate = (value: Date | string | undefined) => {
  if (!value) {
    return 'time unavailable';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'time unavailable';
  }

  return date.toLocaleString();
};

export const getSessionTitle = (session: TuiSession) => {
  const title = session.title?.trim();
  if (title) {
    return title;
  }

  return session.id === 'tui-session' ? 'Default session' : session.id;
};

export const createNewSessionTitle = () => {
  return `Session ${new Date().toLocaleString()}`;
};

export const createNewSessionId = () => {
  return `tui-session-${Date.now().toString(36)}`;
};

export const toSessionOption = (session: TuiSession): SelectOption => {
  const updatedLabel = formatSessionDate(session.updatedAt ?? session.createdAt);
  return {
    name: compactText(getSessionTitle(session), 48),
    description: compactText(`${session.id} - ${updatedLabel}`, 90),
    value: session.id,
  };
};

export const resolveWorkspaceFile = (filePath: string) => {
  return isAbsolute(filePath) ? filePath : join(workspacePath, filePath);
};

export const countFileLines = (filePath: string) => {
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

export const getPayloadArgs = (payload: ToolPayload, fallbackPayload?: ToolPayload) => {
  return isRecord(payload.args) ? payload.args : isRecord(fallbackPayload?.args) ? fallbackPayload.args : undefined;
};

export const getPayloadPath = (payload: ToolPayload, fallbackPayload?: ToolPayload) => {
  const args = getPayloadArgs(payload, fallbackPayload);
  return getStringField(args, ['path', 'filePath', 'filepath', 'file', 'targetPath', 'target']);
};

export const getResultText = (result: unknown): string | undefined => {
  if (typeof result === 'string') {
    return result;
  }

  if (!isRecord(result)) {
    return undefined;
  }

  return getStringField(result, ['content', 'text', 'output', 'data', 'result']);
};

const extractErrorText = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const direct = getStringField(value, ['message', 'error', 'detail', 'details', 'description']);
  if (direct) {
    return direct;
  }

  const nested = extractErrorText(value.error) ?? extractErrorText(value.cause) ?? extractErrorText(value.result);
  if (nested) {
    return nested;
  }

  const name = getStringField(value, ['name', 'code']);
  return name ? name.trim() : undefined;
};

export const getToolErrorMessage = (payload: ToolPayload, fallbackPayload?: ToolPayload) => {
  return (
    extractErrorText(payload.error) ??
    extractErrorText(payload.result) ??
    extractErrorText(payload) ??
    extractErrorText(fallbackPayload?.error) ??
    extractErrorText(fallbackPayload?.result) ??
    extractErrorText(fallbackPayload)
  );
};

export const clampPreviewLines = (lines: EditPreviewLine[], maxVisibleLines = 9) => {
  if (lines.length <= maxVisibleLines) {
    return { visibleLines: lines, hiddenLines: 0 };
  }

  return {
    visibleLines: lines.slice(0, maxVisibleLines),
    hiddenLines: lines.length - maxVisibleLines,
  };
};

export const buildEditPreviewLines = (oldText: string, newText: string, startLine: number | undefined) => {
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

export const buildWritePreviewLines = (content: string, startLine = 1) => {
  return toContentLines(content).map((text, index) => ({
    lineNumber: startLine + index,
    marker: '+' as const,
    text,
  }));
};

export const filetypeFromPath = (filePath: string) => {
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

export const createUnifiedDiff = (filePath: string, lines: EditPreviewLine[], additions: number, removals: number) => {
  const firstLineNumber = lines.find((line) => line.lineNumber !== undefined)?.lineNumber ?? 1;
  const oldVisibleLength = lines.filter((line) => line.marker !== '+').length;
  const newVisibleLength = lines.filter((line) => line.marker !== '-').length;
  const isAddOnlyHunk = oldVisibleLength === 0 && newVisibleLength > 0 && removals === 0;
  const oldStart = isAddOnlyHunk ? 0 : firstLineNumber;
  const oldLength = isAddOnlyHunk ? 0 : oldVisibleLength;
  const newLength = newVisibleLength;
  const body = lines.map((line) => `${line.marker}${line.text}`).join('\n');

  return [
    `diff --git a/${filePath} b/${filePath}`,
    isAddOnlyHunk ? '--- /dev/null' : `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${oldLength} +${firstLineNumber},${newLength} @@`,
    body,
  ].join('\n');
};

export const plural = (value: number, singular: string, pluralText: string) => {
  return `${value} ${value === 1 ? singular : pluralText}`;
};
