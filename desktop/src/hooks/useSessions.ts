import { useState, useCallback, useEffect, useRef } from 'react'
import type { Session } from '../lib/types'
import { getMastraClient } from '../lib/mastra-client'

const ACTIVE_SESSION_STORAGE_KEY = 'loccle-active-session-ids'

function getStoredActiveSessionIds(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveStoredActiveSessionId(workspaceId: string, sessionId: string) {
  const map = getStoredActiveSessionIds()
  map[workspaceId] = sessionId
  localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(map))
}

export function useSessions(workspaceId?: string, mastraReady?: boolean) {
  const [allSessions, setAllSessions] = useState<Session[]>([])
  const [activeSessionMap, setActiveSessionMap] = useState<Record<string, string>>(getStoredActiveSessionIds)
  const [isLoading, setIsLoading] = useState(false)

  const mastraReadyRef = useRef(mastraReady)
  useEffect(() => {
    mastraReadyRef.current = mastraReady
  }, [mastraReady])

  const allSessionsRef = useRef(allSessions)
  allSessionsRef.current = allSessions

  const fetchThreads = useCallback(async () => {
    if (!mastraReadyRef.current) return null
    setIsLoading(true)
    try {
      const client = getMastraClient()
      const res = await client.listMemoryThreads({
        perPage: 100,
      })
      if (!mastraReadyRef.current) return null
      if (res && Array.isArray(res.threads)) {
        const loaded: Session[] = res.threads.map((t: any) => ({
          id: t.id,
          title: t.title || t.id,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          workspaceId: t.metadata?.workspaceId || t.resourceId || 'default-workspace',
        }))
        setAllSessions(loaded)
        return loaded
      }
    } catch (err) {
      if (mastraReadyRef.current) {
        console.error('[useSessions] Failed to fetch threads:', err)
      }
    } finally {
      setIsLoading(false)
    }
    return null
  }, [])

  const ensureWorkspaceHasSession = useCallback(async (wId: string, currentAll: Session[]) => {
    const wsSessions = currentAll.filter((s) => s.workspaceId === wId)
    if (wsSessions.length === 0 && mastraReadyRef.current) {
      try {
        const client = getMastraClient()
        const newThread = await client.createMemoryThread({
          agentId: 'openAICompatibleAgent',
          resourceId: wId,
          title: 'Default Session',
          metadata: { workspaceId: wId },
        })
        if (!mastraReadyRef.current) return null
        const defaultSess: Session = {
          id: newThread.id,
          title: newThread.title || 'Default Session',
          createdAt: newThread.createdAt,
          workspaceId: wId,
        }
        const nextAll = [defaultSess, ...currentAll]
        setAllSessions(nextAll)

        const nextMap = { ...getStoredActiveSessionIds(), [wId]: defaultSess.id }
        localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, JSON.stringify(nextMap))
        setActiveSessionMap(nextMap)
        return defaultSess
      } catch (err) {
        if (mastraReadyRef.current) {
          console.error('[useSessions] Failed to create default thread:', err)
        }
      }
    }
    return null;
  }, [])

  // Fetch threads when server is ready or workspaceId changes
  useEffect(() => {
    if (!mastraReady) return

    let cancelled = false
    const load = async () => {
      if (!mastraReadyRef.current) return
      const loaded = await fetchThreads()
      if (cancelled || !workspaceId || !mastraReadyRef.current || loaded === null) return

      const currentActiveId = getStoredActiveSessionIds()[workspaceId]
      const addedDefault = await ensureWorkspaceHasSession(workspaceId, loaded)
      if (cancelled || !mastraReadyRef.current) return

      const wsSessions = (addedDefault ? [addedDefault, ...loaded] : loaded).filter(
        (s) => s.workspaceId === workspaceId,
      )

      const exists = wsSessions.some((s) => s.id === currentActiveId)
      if (!currentActiveId || !exists) {
        const fallbackId = wsSessions[0]?.id
        if (fallbackId) {
          saveStoredActiveSessionId(workspaceId, fallbackId)
          setActiveSessionMap((prev) => ({ ...prev, [workspaceId]: fallbackId }))
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [workspaceId, mastraReady, fetchThreads, ensureWorkspaceHasSession])

  const sessions = allSessions.filter((s) => s.workspaceId === workspaceId)

  const currentSessionId = workspaceId ? activeSessionMap[workspaceId] : undefined
  const currentSession =
    sessions.find((s) => s.id === currentSessionId) ||
    sessions[0] ||
    ({ id: 'default', title: 'Default Session' } as Session)

  const createSession = useCallback(
    async (wId?: string, title?: string) => {
      const targetWId = wId || workspaceId
      if (!targetWId || !mastraReady) return { id: 'default', title: 'Default Session' } as Session

      try {
        const client = getMastraClient()
        const threadTitle = title?.trim() || `Session ${new Date().toLocaleString()}`
        const newThread = await client.createMemoryThread({
          agentId: 'openAICompatibleAgent',
          resourceId: targetWId,
          title: threadTitle,
          metadata: { workspaceId: targetWId },
        })

        const session: Session = {
          id: newThread.id,
          title: threadTitle,
          createdAt: newThread.createdAt,
          workspaceId: targetWId,
        }

        const nextAll = [session, ...allSessionsRef.current]
        setAllSessions(nextAll)

        saveStoredActiveSessionId(targetWId, session.id)
        setActiveSessionMap((prev) => ({ ...prev, [targetWId]: session.id }))

        return session
      } catch (err) {
        console.error('[useSessions] Failed to create session:', err)
        return { id: 'default', title: 'Default Session' } as Session
      }
    },
    [workspaceId, mastraReady],
  )

  const selectSession = useCallback((id: string) => {
    const session = allSessionsRef.current.find((s) => s.id === id)
    if (!session) return

    const wId = session.workspaceId
    if (wId) {
      saveStoredActiveSessionId(wId, id)
      setActiveSessionMap((prev) => ({ ...prev, [wId]: id }))
    }
  }, [])

  const deleteSession = useCallback(
    async (id: string) => {
      const targetSession = allSessionsRef.current.find((s) => s.id === id)
      if (!targetSession || !mastraReady) return

      try {
        const client = getMastraClient()
        await client.deleteThread(id, { agentId: 'openAICompatibleAgent' })

        const wId = targetSession.workspaceId
        const nextAll = allSessionsRef.current.filter((s) => s.id !== id)
        setAllSessions(nextAll)

        if (wId) {
          const currentActiveId = activeSessionMap[wId]
          if (currentActiveId === id) {
            const remaining = nextAll.filter((s) => s.workspaceId === wId)
            if (remaining.length > 0) {
              const nextActiveId = remaining[0].id
              saveStoredActiveSessionId(wId, nextActiveId)
              setActiveSessionMap((prev) => ({ ...prev, [wId]: nextActiveId }))
            } else {
              await ensureWorkspaceHasSession(wId, nextAll)
            }
          }
        }
      } catch (err) {
        console.error('[useSessions] Failed to delete session:', err)
      }
    },
    [activeSessionMap, ensureWorkspaceHasSession, mastraReady],
  )

  return {
    sessions,
    currentSession,
    createSession,
    selectSession,
    deleteSession,
    allSessions,
    isLoading,
  }
}
