import { useState, useCallback, useRef, useEffect } from 'react'
import { getAgent, getMastraUrl, getMastraClient } from '../lib/mastra-client'
import { getActiveWorkspace } from '../lib/workspace-store'
import type { Message, TaskItem, ToolEvent, StreamState, Session } from '../lib/types'

const electron = (window as any).electronAPI
const workspacePathContextKey = 'mastra-tui.workspacePath'
const allowedExternalWorkspacePathsKey = 'mastra-tui.allowedExternalWorkspacePaths'
const AUTH_SERVER_URL = 'https://api.loccle.com'
const configuredMaxSteps = Number(import.meta.env.VITE_VIBE_CODING_MAX_STEPS)
const agentMaxSteps = Number.isFinite(configuredMaxSteps) && configuredMaxSteps > 0 ? configuredMaxSteps : 40

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cleanTaskText(text: string) {
  return text.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim()
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}

function cleanPath(p: string) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

function normalizePath(p: string) {
  const clean = p.replace(/\\/g, '/').trim()
  const parts = clean.split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      stack.pop()
    } else {
      stack.push(part)
    }
  }
  const prefix = clean.startsWith('/') ? '/' : ''
  return prefix + stack.join('/')
}

function isPathWithinRoot(inputPath: string, rootPath: string): boolean {
  const cleanInput = cleanPath(inputPath).toLowerCase()
  const cleanRoot = cleanPath(rootPath).toLowerCase()
  if (cleanInput === cleanRoot) return true
  return cleanInput.startsWith(cleanRoot + '/')
}

function isPathWithinAllowedRoots(inputPath: string, rootPaths: string[]): boolean {
  return rootPaths.some(root => isPathWithinRoot(inputPath, root))
}

const pathArgKeys = ['path', 'filePath', 'filepath', 'file', 'targetPath', 'target', 'directory', 'dir', 'cwd', 'basePath']

function getToolPathForApproval(args: any) {
  const pathValue = getStringArg(args, pathArgKeys)
  if (!pathValue) return undefined
  if (!pathValue.startsWith('/') && !pathValue.startsWith('~/') && pathValue !== '~' && !/^[a-zA-Z]:/.test(pathValue)) {
    return undefined
  }
  return normalizePath(pathValue)
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

const extractMemoryMessageText = (content: unknown): string => {
  if (typeof content === 'string') {
    const trimmed = content.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return extractMemoryMessageText(JSON.parse(trimmed))
      } catch {
        return content
      }
    }
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => extractMemoryMessageText(part))
      .filter(Boolean)
      .join('\n')
  }

  if (!content || typeof content !== 'object' || Array.isArray(content)) return ''

  const record = content as Record<string, unknown>
  const directText = record.content as string ?? record.text as string ?? ''
  if (directText && typeof directText === 'string') return directText

  const parts = record.parts
  if (!Array.isArray(parts)) return ''

  return parts
    .filter((part) => typeof part === 'object' && part !== null && !Array.isArray(part) && (part as Record<string, unknown>).type === 'text')
    .map((part) => extractMemoryMessageText(part))
    .filter(Boolean)
    .join('\n')
}

function toolLabel(toolName: string): string {
  switch (toolName) {
    case 'tuiTaskList': return 'TASK'
    case 'mastra_workspace_read_file': case 'readManyFiles': return 'READ'
    case 'mastra_workspace_write_file': case 'mastra_workspace_edit_file': return 'EDIT'
    case 'mastra_workspace_list_files': case 'mastra_workspace_grep': return 'EXPLORE'
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

interface SessionChatState {
  messages: Message[]
  tasks: TaskItem[]
  toolEvents: ToolEvent[]
  status: 'idle' | 'streaming' | 'awaiting-approval' | 'finished' | 'error'
  isStreaming: boolean
  historyLoaded: boolean
  allowedPaths: string[]
}

export function useAgentChat(currentSessionId?: string, mastraReady?: boolean) {
  const [sessionsChatState, setSessionsChatState] = useState<Record<string, SessionChatState>>({})
  const [balance, setBalance] = useState<string | null>(null)
  const abortControllersRef = useRef<Record<string, AbortController | null>>({})

  const mastraReadyRef = useRef(mastraReady)
  useEffect(() => {
    mastraReadyRef.current = mastraReady
  }, [mastraReady])

  const getSessionChatState = useCallback((id: string): SessionChatState => {
    return sessionsChatState[id] || {
      messages: [],
      tasks: [],
      toolEvents: [],
      status: 'idle',
      isStreaming: false,
      historyLoaded: false,
      allowedPaths: [],
    }
  }, [sessionsChatState])

  const updateSessionChatState = useCallback((id: string, updater: Partial<SessionChatState> | ((prev: SessionChatState) => SessionChatState)) => {
    setSessionsChatState(prev => {
      const current = prev[id] || {
        messages: [],
        tasks: [],
        toolEvents: [],
        status: 'idle',
        isStreaming: false,
        historyLoaded: false,
        allowedPaths: [],
      }
      const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater }
      return {
        ...prev,
        [id]: next
      }
    })
  }, [])

  const refreshBalance = useCallback(async () => {
    const stored = localStorage.getItem('loccle-session')
    if (!stored) return null
    try {
      const session = JSON.parse(stored)
      if (!session?.token) return null
      
      const res = await fetch(`${AUTH_SERVER_URL}/api/credits/me`, {
        headers: { Authorization: `Bearer ${session.token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch balance')
      const body = await res.json()
      const bal = body.data?.balance ?? '0.00'
      setBalance(bal)
      return bal
    } catch (err) {
      console.error('[Balance] Failed to fetch:', err)
      return null
    }
  }, [])

  // Load chat history when currentSessionId changes (isolated per session)
  useEffect(() => {
    if (!currentSessionId || currentSessionId === 'default' || !mastraReady) return

    const state = getSessionChatState(currentSessionId)
    if (state.historyLoaded) return

    let cancelled = false

    const load = async () => {
      if (!mastraReadyRef.current) return
      try {
        const opts = {
          agentId: 'openAICompatibleAgent',
        }
        const res = electron?.listThreadMessages
          ? await electron.listThreadMessages(currentSessionId, opts)
          : await getMastraClient().listThreadMessages(currentSessionId, opts)
        if (cancelled || !mastraReadyRef.current) return

        let formatted: Message[] = []
        if (res && Array.isArray(res.messages)) {
          formatted = res.messages
            .map((msg: any) => {
              const textContent = extractMemoryMessageText(msg.content)
              return {
                id: msg.id || generateId(),
                role: msg.role,
                content: textContent,
                status: 'complete' as const,
              }
            })
            .filter((m: Message) => m.content.trim())
        }

        updateSessionChatState(currentSessionId, {
          messages: formatted,
          historyLoaded: true,
        })
      } catch (err) {
        if (mastraReadyRef.current) {
          console.error('[useAgentChat] Failed to load history:', err)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [currentSessionId, mastraReady, getSessionChatState, updateSessionChatState])

  const handleTaskListChunk = useCallback((sessionId: string, args: any) => {
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
      updateSessionChatState(sessionId, { tasks: next })
    }

    if (args?.action === 'update') {
      const idx = typeof args.taskId === 'number' ? args.taskId : Number(args.taskId)
      const st = args.status
      if (!Number.isFinite(idx) || !st) return
      updateSessionChatState(sessionId, (prev) => ({
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.index === idx
            ? { ...t, done: st === 'completed', current: st === 'in_progress' }
            : t
        )
      }))
    }
  }, [updateSessionChatState])

  const handleStreamChunk = useCallback(async (sessionId: string, chunk: any, assistantMsgId: string) => {
    const abortController = abortControllersRef.current[sessionId]
    if (abortController?.signal.aborted) return

    if (chunk.type === 'text-delta') {
      const text = chunk.payload?.text ?? chunk.text ?? ''
      updateSessionChatState(sessionId, (prev) => {
        const messages = prev.messages.map((m) => {
          if (m.id === assistantMsgId) {
            return { ...m, content: m.content + text }
          }
          return m
        })
        return { ...prev, messages }
      })
    }

    if (chunk.type === 'tool-call') {
      const name = chunk.payload?.toolName ?? 'unknown'
      const args = chunk.payload?.args ?? {}
      const toolCallId = chunk.payload?.toolCallId ?? generateId()
      const toolEvent: ToolEvent = {
        id: toolCallId,
        type: nameToEventType(name),
        label: toolLabel(name),
        status: 'running',
        summary: summarizeTool(name, args),
        path: getStringArg(args, ['path', 'filePath']),
        startedAt: Date.now(),
      }
      updateSessionChatState(sessionId, (prev) => ({
        ...prev,
        toolEvents: [...prev.toolEvents, toolEvent]
      }))

      if (name === 'tuiTaskList') {
        handleTaskListChunk(sessionId, args)
      }
    }

    if (chunk.type === 'tool-result') {
      const callId = chunk.payload?.toolCallId
      const isError = chunk.payload?.isError === true
      updateSessionChatState(sessionId, (prev) => ({
        ...prev,
        toolEvents: prev.toolEvents.map((te) =>
          te.id === callId
            ? { ...te, status: isError ? 'error' as const : 'done' as const }
            : te
        )
      }))
    }

    if (chunk.type === 'tool-error') {
      const callId = chunk.payload?.toolCallId
      updateSessionChatState(sessionId, (prev) => ({
        ...prev,
        toolEvents: prev.toolEvents.map((te) =>
          te.id === callId ? { ...te, status: 'error' as const } : te
        )
      }))
    }

    if (chunk.type === 'tool-call-approval') {
      const toolName = chunk.payload.toolName
      const toolCallId = chunk.payload.toolCallId
      const runId = chunk.runId || chunk.payload.runId
      const args = chunk.payload.args

      const approvalPath = getToolPathForApproval(args)
      const state = getSessionChatState(sessionId)
      const allowedPaths = state.allowedPaths
      const workspace = getActiveWorkspace()
      const workspacePath = workspace?.path || ''

      const allowedRoots = [workspacePath, ...allowedPaths]
      const requiresUserApproval = approvalPath ? !isPathWithinAllowedRoots(approvalPath, allowedRoots) : false

      updateSessionChatState(sessionId, {
        status: 'awaiting-approval',
      })
      const toolEvent: ToolEvent = {
        id: toolCallId,
        type: 'approval',
        label: 'APPROVE',
        status: 'pending',
        summary: `${toolName}`,
        path: approvalPath,
        details: JSON.stringify({ runId, toolCallId, toolName, approvalPath, requiresUserApproval }),
      }
      updateSessionChatState(sessionId, (prev) => ({
        ...prev,
        toolEvents: [...prev.toolEvents, toolEvent]
      }))
    }

    if (chunk.type === 'finish' || chunk.type === 'step-finish') {
      const usage = chunk.payload?.usage ?? chunk.payload?.totalUsage
      if (usage) {
        const inputTokens = usage.promptTokens ?? usage.inputTokens
        const outputTokens = usage.completionTokens ?? usage.outputTokens
        const totalTokens = usage.totalTokens
          ?? (inputTokens != null && outputTokens != null ? inputTokens + outputTokens : undefined)
        const usageEvent: ToolEvent = {
          id: generateId(),
          type: 'usage',
          label: 'USAGE',
          status: 'done',
          summary: `${totalTokens ?? '?'} tokens`,
          usage: {
            inputTokens,
            outputTokens,
            totalTokens,
          },
        }
        updateSessionChatState(sessionId, (prev) => ({
          ...prev,
          toolEvents: [...prev.toolEvents, usageEvent]
        }))
      }
    }
  }, [handleTaskListChunk, getSessionChatState, updateSessionChatState])

  useEffect(() => {
    if (!electron?.onAgentStreamEvent) return

    return electron.onAgentStreamEvent((event: any) => {
      const sessionId = event?.sessionId
      const assistantMsgId = event?.assistantMsgId
      if (!sessionId) return

      if (event.type === 'chunk') {
        void handleStreamChunk(sessionId, event.chunk, assistantMsgId || '')
        return
      }

      if (event.type === 'done' || event.type === 'cancelled') {
        updateSessionChatState(sessionId, (prev) => {
          const messages = prev.messages.map((m) =>
            m.id === assistantMsgId ? { ...m, status: 'complete' as const } : m
          )
          return { ...prev, messages, status: event.type === 'done' ? 'finished' as const : 'idle' as const, isStreaming: false }
        })
        if (event.type === 'done') {
          void refreshBalance()
        }
        return
      }

      if (event.type === 'error') {
        updateSessionChatState(sessionId, (prev) => {
          const messages = prev.messages.map((m) =>
            m.id === assistantMsgId
              ? { ...m, status: 'error' as const, content: m.content || `Error: ${event.error || 'request failed'}` }
              : m
          )
          return { ...prev, messages, status: 'error' as const, isStreaming: false }
        })
      }
    })
  }, [handleStreamChunk, refreshBalance, updateSessionChatState])

  const resumeApproval = useCallback(async (
    sessionId: string,
    runId: string,
    toolCallId: string,
    approved: boolean,
    approvalPath?: string,
    assistantMsgId?: string
  ) => {
    updateSessionChatState(sessionId, {
      status: 'streaming',
    })

    if (approved && approvalPath) {
      updateSessionChatState(sessionId, (prev) => {
        if (!prev.allowedPaths.includes(approvalPath)) {
          return { ...prev, allowedPaths: [...prev.allowedPaths, approvalPath] }
        }
        return prev
      })
    }

    updateSessionChatState(sessionId, (prev) => ({
      ...prev,
      toolEvents: prev.toolEvents.map((te) =>
        te.id === toolCallId
          ? { ...te, status: approved ? 'approved' as const : 'denied' as const }
          : te
      )
    }))

    try {
      if (electron?.respondAgentApproval) {
        const result = await electron.respondAgentApproval({ sessionId, approved })
        if (!result?.ok) {
          throw new Error(result?.error || 'Failed to respond to tool approval')
        }
        return
      }

      const agent = getAgent()
      const resumedResponse = approved
        ? await agent.approveToolCall({ runId, toolCallId })
        : await agent.declineToolCall({ runId, toolCallId })

      await resumedResponse.processDataStream({
        onChunk: async (chunk: any) => {
          await handleStreamChunk(sessionId, chunk, assistantMsgId || '')
        }
      })

      updateSessionChatState(sessionId, (prev) => {
        if (prev.status === 'streaming') {
          const messages = prev.messages.map((m) =>
            m.id === assistantMsgId ? { ...m, status: 'complete' as const } : m
          )
          return { ...prev, messages, status: 'finished' as const, isStreaming: false }
        }
        return prev
      })

      // Refresh balance after stream complete
      void refreshBalance()
    } catch (err) {
      console.error('[useAgentChat] Failed to resume approval:', err)
      updateSessionChatState(sessionId, {
        status: 'error',
      })
    }
  }, [handleStreamChunk, updateSessionChatState, refreshBalance])

  const submitPrompt = useCallback(async (prompt: string, session?: Session) => {
    const targetSession = session || (currentSessionId ? { id: currentSessionId } : null)
    if (!prompt.trim() || !targetSession) return
    const sessionId = targetSession.id

    const state = getSessionChatState(sessionId)
    if (state.isStreaming) return

    const userMsg: Message = { id: generateId(), role: 'user', content: prompt.trim() }
    const assistantMsgId = generateId()
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      status: 'streaming',
    }

    updateSessionChatState(sessionId, (prev) => ({
      ...prev,
      messages: [...prev.messages, userMsg, assistantMsg],
      toolEvents: [],
      status: 'streaming',
      isStreaming: true,
    }))

    const abortController = new AbortController()
    abortControllersRef.current[sessionId] = abortController

    const workspace = getActiveWorkspace()
    const taskContext = buildTaskContext(state.tasks)

    try {
      if (electron?.startAgentStream) {
        const result = await electron.startAgentStream({
          sessionId,
          assistantMsgId,
          prompt: prompt.trim(),
          workspaceId: session?.workspaceId || 'desktop-user',
          workspacePath: workspace?.path || '',
          allowedPaths: state.allowedPaths,
          taskContext,
        })
        if (!result?.ok) {
          throw new Error(result?.error || 'Failed to start agent stream')
        }
        return
      }

      const agent = getAgent()
      const streamResponse = await agent.stream(prompt.trim(), {
        maxSteps: agentMaxSteps,
        memory: {
          thread: sessionId,
          resource: session?.workspaceId || 'desktop-user',
        },
        requireToolApproval: true,
        ...(taskContext ? { system: taskContext } : {}),
        requestContext: {
          [workspacePathContextKey]: workspace?.path || '',
          [allowedExternalWorkspacePathsKey]: state.allowedPaths,
        } as any,
      })

      await streamResponse.processDataStream({
        onChunk: async (chunk: any) => {
          await handleStreamChunk(sessionId, chunk, assistantMsgId)
        },
      })

      updateSessionChatState(sessionId, (prev) => {
        if (prev.status === 'streaming') {
          const messages = prev.messages.map((m) =>
            m.id === assistantMsgId ? { ...m, status: 'complete' as const } : m
          )
          return { ...prev, messages, status: 'finished' as const, isStreaming: false }
        }
        return prev
      })

      // Refresh balance after stream complete
      void refreshBalance()
    } catch (err: any) {
      if (err.name === 'AbortError') return
      console.error('[useAgentChat] Stream error:', err)
      updateSessionChatState(sessionId, (prev) => {
        const messages = prev.messages.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, status: 'error' as const, content: m.content || 'Error: request failed' }
            : m
        )
        return { ...prev, messages, status: 'error' as const, isStreaming: false }
      })
    } finally {
      abortControllersRef.current[sessionId] = null
    }
  }, [currentSessionId, getSessionChatState, updateSessionChatState, handleStreamChunk, refreshBalance])

  const respondToApproval = useCallback(async (approved: boolean) => {
    if (!currentSessionId) return
    const state = getSessionChatState(currentSessionId)
    if (state.status !== 'awaiting-approval') return

    // Find the pending approval event
    const approvalEvent = [...state.toolEvents].reverse().find(te => te.type === 'approval' && te.status === 'pending')
    if (!approvalEvent || !approvalEvent.details) return

    try {
      const { runId, toolCallId, approvalPath } = JSON.parse(approvalEvent.details)
      // Find the last assistant message ID
      const assistantMsg = [...state.messages].reverse().find(m => m.role === 'assistant')
      const assistantMsgId = assistantMsg?.id

      await resumeApproval(currentSessionId, runId, toolCallId, approved, approvalPath, assistantMsgId)
    } catch (err) {
      console.error('[useAgentChat] Failed to parse approval details:', err)
    }
  }, [currentSessionId, getSessionChatState, resumeApproval])

  const cancelStream = useCallback(() => {
    if (!currentSessionId) return
    if (electron?.cancelAgentStream) {
      void electron.cancelAgentStream(currentSessionId)
    }
    const abortController = abortControllersRef.current[currentSessionId]
    if (abortController) {
      abortController.abort()
      abortControllersRef.current[currentSessionId] = null
    }
    updateSessionChatState(currentSessionId, {
      isStreaming: false,
      status: 'idle',
    })
  }, [currentSessionId, updateSessionChatState])

  const clearChat = useCallback(() => {
    if (!currentSessionId) return
    updateSessionChatState(currentSessionId, {
      messages: [],
      toolEvents: [],
      tasks: [],
      status: 'idle',
      isStreaming: false,
    })
  }, [currentSessionId, updateSessionChatState])

  const activeState = getSessionChatState(currentSessionId || '')
  const allStates = Object.values(sessionsChatState)
  const activeStreamCount = allStates.filter((state) => state.isStreaming || state.status === 'streaming').length
  const hasAwaitingApproval = allStates.some((state) => state.status === 'awaiting-approval')
  const globalStatus = hasAwaitingApproval
    ? 'awaiting-approval'
    : activeStreamCount > 0
      ? 'streaming'
      : activeState.status

  return {
    messages: activeState.messages,
    tasks: activeState.tasks,
    toolEvents: activeState.toolEvents,
    status: activeState.status,
    globalStatus,
    isStreaming: activeState.isStreaming,
    activeStreamCount,
    allowedPaths: activeState.allowedPaths,
    balance,
    submitPrompt,
    respondToApproval,
    cancelStream,
    clearChat,
    refreshBalance,
  }
}
