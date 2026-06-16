import { useState, useCallback, useRef, useEffect } from 'react'
import { getAgent, getMastraUrl } from '../lib/mastra-client'
import { getActiveWorkspace } from '../lib/workspace-store'
import type { Message, TaskItem, ToolEvent, StreamState, Session } from '../lib/types'

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cleanTaskText(text: string) {
  return text.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}

function summarizeTool(toolName: string, args: any): string {
  const p = getStringArg(args, ['path', 'filePath', 'filepath', 'file'])
  const cmd = getStringArg(args, ['cmd', 'command', 'script'])
  const dir = getStringArg(args, ['directory', 'dir', 'cwd']) ?? '.'

  switch (toolName) {
    case 'mastra_workspace_read_file': return `Reading ${p ?? '(path)'}`
    case 'readManyFiles': {
      const paths = Array.isArray(args?.paths) ? args.paths.length : '?'
      return `Reading ${paths} files`
    }
    case 'mastra_workspace_write_file': return `Writing ${p ?? '(path)'}`
    case 'mastra_workspace_edit_file': return `Editing ${p ?? '(path)'}`
    case 'mastra_workspace_list_files': return `Listing ${dir}`
    case 'mastra_workspace_grep': return `Searching ${args?.pattern ?? ''}`
    case 'mastra_workspace_shell': case 'mastra_workspace_execute_command':
      return `Running: ${cmd ?? '(command)'}`
    case 'tuiTaskList': {
      if (args?.action === 'set') return `Checklist (${args?.tasks?.length ?? 0} tasks)`
      return `Checklist update`
    }
    default: return `${toolName}`
  }
}

function getStringArg(args: any, keys: string[]): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  for (const key of keys) {
    if (typeof args[key] === 'string' && args[key].trim()) return args[key]
  }
  return undefined
}

function toolLabel(toolName: string): string {
  switch (toolName) {
    case 'tuiTaskList': return 'TASK'
    case 'mastra_workspace_read_file': case 'readManyFiles': return 'READ'
    case 'mastra_workspace_write_file': return 'WRITE'
    case 'mastra_workspace_edit_file': return 'EDIT'
    case 'mastra_workspace_list_files': return 'LIST'
    case 'mastra_workspace_grep': return 'GREP'
    case 'mastra_workspace_shell': case 'mastra_workspace_execute_command': return 'SHELL'
    default: return 'TOOL'
  }
}

function buildTaskContext(tasks: TaskItem[]): string | undefined {
  if (tasks.length === 0) return undefined
  const lines = tasks.map((t) => {
    const status = t.done ? 'completed' : t.current ? 'in_progress' : 'pending'
    return `- ${t.index}. [${status}] ${t.text}`
  })
  return `Current TUI checklist:\n${lines.join('\n')}`
}

export function useAgentChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [status, setStatus] = useState<StreamState['status']>('idle')
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const streamingMessageRef = useRef<string>('')
  const currentSessionRef = useRef<Session | null>(null)

  const submitPrompt = useCallback(async (prompt: string, session?: Session) => {
    if (!prompt.trim() || isStreaming) return

    const userMsg: Message = { id: generateId(), role: 'user', content: prompt.trim() }
    setMessages((prev) => [...prev, userMsg])
    setToolEvents([])
    setStatus('streaming')
    setIsStreaming(true)

    const assistantMsg: Message = {
      id: generateId(),
      role: 'assistant',
      content: '',
      status: 'streaming',
    }
    setMessages((prev) => [...prev, assistantMsg])

    streamingMessageRef.current = ''
    if (session) currentSessionRef.current = session

    const abortController = new AbortController()
    abortRef.current = abortController

    const workspace = getActiveWorkspace()
    const taskContext = buildTaskContext(tasks)

    try {
      const agent = getAgent()
      const streamResponse = await agent.stream(prompt.trim(), {
        memory: session ? {
          thread: session.id,
          resource: 'desktop-user',
        } : undefined,
        ...(workspace ? {
          // Pass workspace info via external context (handled by custom route or headers)
        } as any : {}),
      })

      await streamResponse.processDataStream({
        onChunk: async (chunk: any) => {
          if (abortController.signal.aborted) return

          if (chunk.type === 'text-delta') {
            const text = chunk.payload?.text ?? chunk.text ?? ''
            streamingMessageRef.current += text
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: streamingMessageRef.current }
                  : m,
              ),
            )
          }

          if (chunk.type === 'tool-call') {
            const name = chunk.payload?.toolName ?? chunk.payload?.toolName ?? 'unknown'
            const args = chunk.payload?.args ?? {}
            const toolEvent: ToolEvent = {
              id: chunk.payload?.toolCallId ?? generateId(),
              type: nameToEventType(name),
              label: toolLabel(name),
              status: 'running',
              summary: summarizeTool(name, args),
              path: getStringArg(args, ['path', 'filePath']),
              startedAt: Date.now(),
            }
            setToolEvents((prev) => [...prev, toolEvent])

            // Handle task list tool
            if (name === 'tuiTaskList') {
              handleTaskListChunk(args)
            }
          }

          if (chunk.type === 'tool-result') {
            const callId = chunk.payload?.toolCallId
            const isError = chunk.payload?.isError === true
            setToolEvents((prev) =>
              prev.map((te) =>
                te.id === callId
                  ? { ...te, status: isError ? 'error' : 'done' }
                  : te,
              ),
            )
          }

          if (chunk.type === 'tool-error') {
            const callId = chunk.payload?.toolCallId
            setToolEvents((prev) =>
              prev.map((te) =>
                te.id === callId ? { ...te, status: 'error' } : te,
              ),
            )
          }

          if (chunk.type === 'tool-call-approval') {
            setStatus('awaiting-approval')
          }

          if (chunk.type === 'finish' || chunk.type === 'step-finish') {
            const usage = chunk.payload?.usage ?? chunk.payload?.totalUsage
            if (usage) {
              const usageEvent: ToolEvent = {
                id: generateId(),
                type: 'usage',
                label: 'USAGE',
                status: 'done',
                summary: `${usage.totalTokens ?? usage.promptTokens + usage.completionTokens ?? '?'} tokens`,
                usage: {
                  inputTokens: usage.promptTokens ?? usage.inputTokens,
                  outputTokens: usage.completionTokens ?? usage.outputTokens,
                  totalTokens: usage.totalTokens,
                },
              }
              setToolEvents((prev) => [...prev, usageEvent])
            }
          }
        },
      })

      setStatus('finished')
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, status: 'complete' }
            : m,
        ),
      )
    } catch (err: any) {
      if (err.name === 'AbortError') return
      console.error('[useAgentChat] Stream error:', err)
      setStatus('error')
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, status: 'error', content: streamingMessageRef.current || 'Error: request failed' }
            : m,
        ),
      )
    } finally {
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [isStreaming, tasks])

  const handleTaskListChunk = useCallback((args: any) => {
    if (args?.action === 'set' && Array.isArray(args.tasks)) {
      const next = args.tasks
        .filter((t: any) => t && typeof t.id === 'number' && typeof t.title === 'string')
        .map((t: any) => ({
          index: t.id,
          text: cleanTaskText(t.title),
          done: t.status === 'completed',
          current: t.status === 'in_progress',
        }))
        .sort((a: TaskItem, b: TaskItem) => a.index - b.index)
      setTasks(next)
    }

    if (args?.action === 'update') {
      const idx = typeof args.taskId === 'number' ? args.taskId : Number(args.taskId)
      const st = args.status
      if (!Number.isFinite(idx) || !st) return
      setTasks((prev) =>
        prev.map((t) =>
          t.index === idx
            ? { ...t, done: st === 'completed', current: st === 'in_progress' }
            : t,
        ),
      )
    }
  }, [])

  const respondToApproval = useCallback(async (approved: boolean) => {
    // Approval flow is handled by MastraClient
    // This is a placeholder — full implementation requires tracking runId + toolCallId
    console.log('[useAgentChat] Approval:', approved ? 'approved' : 'denied')
  }, [])

  const cancelStream = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
    setStatus('idle')
  }, [])

  const clearChat = useCallback(() => {
    setMessages([])
    setToolEvents([])
    setTasks([])
    setStatus('idle')
  }, [])

  return {
    messages,
    tasks,
    toolEvents,
    status,
    isStreaming,
    submitPrompt,
    respondToApproval,
    cancelStream,
    clearChat,
  }
}

function nameToEventType(toolName: string): ToolEvent['type'] {
  switch (toolName) {
    case 'mastra_workspace_edit_file': case 'mastra_workspace_write_file': return 'edit'
    case 'mastra_workspace_read_file': case 'readManyFiles': return 'read'
    case 'mastra_workspace_list_files': case 'mastra_workspace_grep': return 'explore'
    case 'mastra_workspace_shell': case 'mastra_workspace_execute_command': return 'shell'
    case 'tuiTaskList': return 'task-list'
    default: return 'run'
  }
}
