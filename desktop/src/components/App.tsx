import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAgentChat } from '../hooks/useAgentChat'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { useSessions } from '../hooks/useSessions'
import { setMastraUrl, resetMastraClient } from '../lib/mastra-client'
import Sidebar from './Sidebar'
import ChatView from './ChatView'
import TaskListPanel from './TaskListPanel'
import StatusBar from './StatusBar'
import AuthScreen from './AuthScreen'
import type { TokenUsage } from '../lib/types'

const electron = (window as any).electronAPI

export default function App() {
  const [authChecked, setAuthChecked] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [mastraReady, setMastraReady] = useState(false)
  const [mastraStarting, setMastraStarting] = useState(false)
  const [mastraError, setMastraError] = useState('')

  const { workspaces, activeWorkspace, addWorkspace, removeWorkspace, setActiveWorkspace } = useWorkspaces()
  const { sessions, currentSession, createSession, selectSession, deleteSession } = useSessions(activeWorkspace?.id)
  const chat = useAgentChat()

  // Check auth on mount
  useEffect(() => {
    const stored = localStorage.getItem('loccle-session')
    if (stored) {
      try {
        const session = JSON.parse(stored)
        if (session?.token) {
          setIsAuthenticated(true)
        }
      } catch {}
    }
    setAuthChecked(true)
  }, [])

  const handleLogin = useCallback((token: string) => {
    localStorage.setItem('loccle-session', JSON.stringify({ token, loginAt: Date.now() }))
    setIsAuthenticated(true)
  }, [])

  const handleLogout = useCallback(() => {
    localStorage.removeItem('loccle-session')
    setIsAuthenticated(false)
    // Stop Mastra on logout
    electron?.stopMastra?.()
    setMastraReady(false)
  }, [])

  // Start Mastra when active workspace changes
  useEffect(() => {
    if (!activeWorkspace || !isAuthenticated) return

    let cancelled = false

    const start = async () => {
      setMastraStarting(true)
      setMastraError('')

      try {
        if (electron?.startMastra) {
          const result = await electron.startMastra(activeWorkspace.path)
          if (cancelled) return

          if (result.ok && result.url) {
            setMastraUrl(result.url)
            resetMastraClient()
            setMastraReady(true)
          } else {
            setMastraError(result.error || 'Failed to start Mastra server')
          }
        } else {
          // Browser fallback — assume Mastra is already running
          setMastraUrl('http://localhost:4112')
          setMastraReady(true)
        }
      } catch (err: any) {
        if (!cancelled) {
          setMastraError(err.message || 'Failed to start Mastra')
        }
      } finally {
        if (!cancelled) setMastraStarting(false)
      }
    }

    start()
    return () => { cancelled = true }
  }, [activeWorkspace?.id, isAuthenticated])

  // Stop Mastra when switching away or removing active workspace
  const handleSelectWorkspace = useCallback(async (id: string) => {
    // Stop current Mastra before switching
    if (mastraReady && electron?.stopMastra) {
      await electron.stopMastra()
    }
    setMastraReady(false)
    setActiveWorkspace(id)
  }, [mastraReady, setActiveWorkspace])

  const handleRemoveWorkspace = useCallback(async (id: string) => {
    if (activeWorkspace?.id === id && electron?.stopMastra) {
      await electron.stopMastra()
      setMastraReady(false)
    }
    removeWorkspace(id)
  }, [activeWorkspace, removeWorkspace])

  if (!authChecked) {
    return (
      <div className="app-loading">
        <div className="loading-spinner" />
        <p>Loading Loccle Desktop...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <AuthScreen onLogin={handleLogin} />
  }

  return (
    <div className="app-layout">
      <Sidebar
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        sessions={sessions}
        currentSession={currentSession}
        onAddWorkspace={addWorkspace}
        onRemoveWorkspace={handleRemoveWorkspace}
        onSelectWorkspace={handleSelectWorkspace}
        onCreateSession={createSession}
        onSelectSession={selectSession}
        onDeleteSession={deleteSession}
      />

      <ChatView
        messages={chat.messages}
        toolEvents={chat.toolEvents}
        status={chat.status}
        isStreaming={chat.isStreaming}
        onSubmit={chat.submitPrompt}
        onCancel={chat.cancelStream}
        onClear={chat.clearChat}
        currentSession={currentSession}
        currentWorkspace={activeWorkspace}
        mastraReady={mastraReady}
        mastraStarting={mastraStarting}
        mastraError={mastraError}
      />

      <TaskListPanel tasks={chat.tasks} />

      <StatusBar
        workspaceName={activeWorkspace?.name ?? 'No workspace'}
        modelDisplayName="gpt-4o-mini"
        mastraReady={mastraReady}
        status={chat.status}
      />
    </div>
  )
}
