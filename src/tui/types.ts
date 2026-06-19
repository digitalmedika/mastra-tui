export type StreamTextEvent = {
  id: number;
  type: 'text';
  text: string;
};

export type StreamAssistantEvent = {
  id: number;
  type: 'assistant';
  text: string;
};

export type RunEvent = {
  id: number;
  type: 'run';
  label: 'RUN';
  prompt: string;
  agent: string;
  status: 'waiting' | 'streaming' | 'awaiting-approval' | 'done' | 'error';
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  cachedInputTokens?: number;
  estimated?: boolean;
};

export type TokenUsageEvent = {
  id: number;
  type: 'usage';
  label: 'USAGE';
  usage: TokenUsage;
};

export type EditPreviewLine = {
  lineNumber?: number;
  marker: ' ' | '+' | '-';
  text: string;
};

export type EditEvent = {
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

export type ReadEvent = {
  id: number;
  type: 'read';
  label: 'READ';
  path: string;
  lines: number;
  offset?: number;
  limit?: number;
  children?: ReadChildEvent[];
};

export type ReadChildEvent = {
  id: number;
  path: string;
  lines?: number;
  ok?: boolean;
};

export type ExploreChildEvent = {
  id: number;
  label: 'READ' | 'GREP' | 'LIST' | 'SHELL';
  path: string;
};

export type ExploreEvent = {
  id: number;
  type: 'explore';
  label: 'EXPLORE';
  title: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  elapsedSeconds: number;
  tokenEstimate: number;
  children: ExploreChildEvent[];
  errorMessage?: string;
};

export type ShellEvent = {
  id: number;
  type: 'shell';
  label: 'SHELL';
  command: string;
  directory: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  elapsedSeconds: number;
};

export type TaskListEvent = {
  id: number;
  type: 'task-list';
  label: 'TASK' | 'CHECK';
  summary: string;
  status: 'running' | 'done' | 'error';
};

export type ProgressEvent = {
  id: number;
  type: 'progress';
  label: string;
  description: string;
  status?: 'running' | 'done' | 'error';
};

export type ApprovalEvent = {
  id: number;
  type: 'approval';
  label: 'APPROVE';
  toolName: string;
  toolCallId: string;
  path?: string;
  status: 'pending' | 'approved' | 'denied';
};

export type ToolCardEvent = EditEvent | ReadEvent | ExploreEvent | ShellEvent | TaskListEvent;

export type StreamEvent = StreamTextEvent | StreamAssistantEvent | RunEvent | TokenUsageEvent | ToolCardEvent | ProgressEvent | ApprovalEvent;

export type StreamStatus = 'idle' | 'streaming' | 'awaiting-approval' | 'finished' | 'error';

export type ImageAttachment = {
  id: string;
  /** Base64-encoded image data (without the data: URL prefix) */
  base64: string;
  /** IANA media type, e.g. "image/png" */
  mediaType: string;
  /** Size in bytes */
  sizeBytes: number;
};

export type StreamRequest = {
  id: number;
  prompt: string;
  taskContext?: string;
  /** Images attached to this request */
  images?: ImageAttachment[];
};

export type TaskItem = {
  id?: string;
  index: number;
  text: string;
  done: boolean;
  current: boolean;
};

export type ToolPayload = {
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  isError?: boolean;
};

export type TuiSession = {
  id: string;
  title?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  metadata?: Record<string, unknown>;
};
