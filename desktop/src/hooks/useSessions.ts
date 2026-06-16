import { useState, useCallback } from 'react'
import type { Session } from '../lib/types'

const DEFAULT_SESSION: Session = {
  id: 'default-session',
  title: 'Default Session',
}

export function useSessions(_resourceId?: string) {
  const [sessions, setSessions] = useState<Session[]>([DEFAULT_SESSION])
  const [currentSession, setCurrentSession] = useState<Session>(DEFAULT_SESSION)

  const createSession = useCallback((title?: string) => {
    const session: Session = {
      id: `session-${Date.now().toString(36)}`,
      title: title?.trim() || `Session ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
    }
    setSessions((prev) => [session, ...prev])
    setCurrentSession(session)
    return session
  }, [])

  const selectSession = useCallback((id: string) => {
    setSessions((prev) => {
      const session = prev.find((s) => s.id === id)
      if (session) setCurrentSession(session)
      return prev
    })
  }, [])

  const deleteSession = useCallback((id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      if (currentSession.id === id) {
        setCurrentSession(next[0] || DEFAULT_SESSION)
      }
      return next
    })
  }, [currentSession.id])

  return {
    sessions,
    currentSession,
    createSession,
    selectSession,
    deleteSession,
  }
}
