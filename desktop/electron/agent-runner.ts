import type { WebContents } from 'electron'
import { RequestContext } from '@mastra/core/request-context'
import { openAICompatibleAgent } from '../../src/mastra/agents/openai-compatible-agent'
import {
  allowedExternalWorkspacePathsKey,
  isPathWithinAllowedRoots,
  workspacePathKey,
} from '../../src/workspace'

const configuredMaxSteps = Number(process.env.VIBE_CODING_MAX_STEPS)
const agentMaxSteps = Number.isFinite(configuredMaxSteps) && configuredMaxSteps > 0 ? configuredMaxSteps : 40

const pathArgKeys = ['path', 'filePath', 'filepath', 'file', 'targetPath', 'target', 'directory', 'dir', 'cwd', 'basePath']

export interface StartAgentStreamPayload {
  sessionId: string
  assistantMsgId: string
  prompt: string
  workspaceId?: string
  workspacePath: string
  allowedPaths?: string[]
  taskContext?: string
}

export interface RespondAgentApprovalPayload {
  sessionId: string
  approved: boolean
}

interface PendingApproval {
  runId: string
  toolCallId: string
  approvalPath?: string
}

interface AgentStreamState extends StartAgentStreamPayload {
  webContents: WebContents
  allowedPaths: string[]
  cancelled: boolean
  pendingApproval?: PendingApproval
}

const activeStreams = new Map<string, AgentStreamState>()

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

function getStringArg(args: unknown, keys: string[]): string | undefined {
  if (!args || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key]
  }
  return undefined
}

function getToolPathForApproval(args: unknown) {
  const pathValue = getStringArg(args, pathArgKeys)
  if (!pathValue) return undefined
  if (!pathValue.startsWith('/') && !pathValue.startsWith('~/') && pathValue !== '~' && !/^[a-zA-Z]:/.test(pathValue)) {
    return undefined
  }
  return normalizePath(pathValue)
}

function createRequestContext(state: AgentStreamState) {
  return new RequestContext([
    [workspacePathKey, state.workspacePath],
    [allowedExternalWorkspacePathsKey, state.allowedPaths],
  ])
}

function shouldRequireToolApproval(state: AgentStreamState, args: unknown) {
  const approvalPath = getToolPathForApproval(args)
  if (!approvalPath) return false

  const allowedRoots = [state.workspacePath, ...state.allowedPaths].filter(Boolean)
  return !isPathWithinAllowedRoots(approvalPath, allowedRoots)
}

function sendAgentEvent(state: AgentStreamState, event: Record<string, unknown>) {
  if (state.webContents.isDestroyed()) return
  state.webContents.send('agent:stream-event', {
    sessionId: state.sessionId,
    assistantMsgId: state.assistantMsgId,
    ...event,
  })
}

function buildStreamOptions(state: AgentStreamState) {
  return {
    maxSteps: agentMaxSteps,
    memory: {
      thread: state.sessionId,
      resource: state.workspaceId || 'desktop-user',
    },
    ...(state.taskContext ? { system: state.taskContext } : {}),
    requestContext: createRequestContext(state),
    requireToolApproval: ({ args }: { toolName?: string; args?: unknown }) => shouldRequireToolApproval(state, args),
  }
}

async function consumeAgentStream(state: AgentStreamState, response: any): Promise<'done' | 'awaiting-approval' | 'cancelled'> {
  for await (const chunk of response.fullStream) {
    if (state.cancelled) return 'cancelled'

    if (chunk?.type === 'tool-call-approval') {
      const runId = response.runId || chunk.runId || chunk.payload?.runId
      const toolCallId = chunk.payload?.toolCallId
      if (!runId || !toolCallId) {
        throw new Error('Tool approval requested without runId/toolCallId')
      }

      state.pendingApproval = {
        runId,
        toolCallId,
        approvalPath: getToolPathForApproval(chunk.payload?.args),
      }
      sendAgentEvent(state, { type: 'chunk', chunk: { ...chunk, runId } })
      return 'awaiting-approval'
    }

    sendAgentEvent(state, { type: 'chunk', chunk })
  }

  return state.cancelled ? 'cancelled' : 'done'
}

function finishIfDone(state: AgentStreamState, result: 'done' | 'awaiting-approval' | 'cancelled') {
  if (result === 'awaiting-approval') return
  activeStreams.delete(state.sessionId)
  sendAgentEvent(state, { type: result === 'cancelled' ? 'cancelled' : 'done' })
}

export function startAgentStream(payload: StartAgentStreamPayload, webContents: WebContents) {
  const existing = activeStreams.get(payload.sessionId)
  if (existing) {
    existing.cancelled = true
    activeStreams.delete(payload.sessionId)
  }

  const state: AgentStreamState = {
    ...payload,
    webContents,
    allowedPaths: payload.allowedPaths ?? [],
    cancelled: false,
  }
  activeStreams.set(payload.sessionId, state)

  void (async () => {
    try {
      const response = await openAICompatibleAgent.stream(payload.prompt, buildStreamOptions(state))
      const result = await consumeAgentStream(state, response)
      finishIfDone(state, result)
    } catch (err) {
      activeStreams.delete(state.sessionId)
      sendAgentEvent(state, {
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })()
}

export function respondAgentApproval(payload: RespondAgentApprovalPayload) {
  const state = activeStreams.get(payload.sessionId)
  if (!state?.pendingApproval) {
    return { ok: false, error: 'No pending tool approval for this session' }
  }

  const pending = state.pendingApproval
  state.pendingApproval = undefined
  state.cancelled = false

  if (payload.approved && pending.approvalPath) {
    const normalized = cleanPath(pending.approvalPath)
    if (!state.allowedPaths.map(cleanPath).includes(normalized)) {
      state.allowedPaths = [...state.allowedPaths, pending.approvalPath]
    }
  }

  void (async () => {
    try {
      const response = payload.approved
        ? await openAICompatibleAgent.approveToolCall({
          runId: pending.runId,
          toolCallId: pending.toolCallId,
          ...buildStreamOptions(state),
        })
        : await openAICompatibleAgent.declineToolCall({
          runId: pending.runId,
          toolCallId: pending.toolCallId,
          ...buildStreamOptions(state),
        })

      const result = await consumeAgentStream(state, response)
      finishIfDone(state, result)
    } catch (err) {
      activeStreams.delete(state.sessionId)
      sendAgentEvent(state, {
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  })()

  return { ok: true }
}

export function cancelAgentStream(sessionId: string) {
  const state = activeStreams.get(sessionId)
  if (!state) return { ok: true }
  state.cancelled = true
  activeStreams.delete(sessionId)
  sendAgentEvent(state, { type: 'cancelled' })
  return { ok: true }
}
