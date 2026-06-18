// Adapted from src/tui/types.ts — types for desktop streaming

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cachedInputTokens?: number
  estimated?: boolean
}

export interface ToolPayload {
  toolCallId?: string
  toolName?: string
  args?: unknown
  result?: unknown
  error?: unknown
  isError?: boolean
}

export interface TaskItem {
  id?: string
  index: number
  text: string
  done: boolean
  current: boolean
}

export interface Session {
  id: string
  title?: string
  createdAt?: string
  updatedAt?: string
  workspaceId?: string
}

// Simplified message type for desktop UI
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolEvent?: ToolEvent
  status?: 'streaming' | 'complete' | 'error'
}

export type ToolEventType = 'run' | 'edit' | 'read' | 'explore' | 'shell' | 'task-list' | 'approval' | 'usage'

export interface ToolEvent {
  id: string
  type: ToolEventType
  label: string
  status: 'waiting' | 'running' | 'done' | 'error' | 'pending' | 'approved' | 'denied'
  summary: string
  details?: string
  path?: string
  children?: ToolEventChild[]
  usage?: TokenUsage
  startedAt?: number
}

export interface ToolEventChild {
  label: string
  path: string
  lines?: number
}

export interface StreamState {
  messages: Message[]
  tasks: TaskItem[]
  status: StreamStatus
}

export type StreamStatus = 'idle' | 'streaming' | 'awaiting-approval' | 'finished' | 'error'
