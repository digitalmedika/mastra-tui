import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAgentChat } from '../hooks/useAgentChat'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { useSessions } from '../hooks/useSessions'
import { setMastraUrl, resetMastraClient } from '../lib/mastra-client'
import { fetchModels, getCachedModels, getFirstModelId, getModelDisplayName, type CatalogModel } from '../lib/model-store'
import Sidebar from './Sidebar'
import ChatView from './ChatView'
import TaskListPanel from './TaskListPanel'
import StatusBar from './StatusBar'
import AuthScreen from './AuthScreen'
import PaymentDialog from './PaymentDialog'
import ApprovalDialog from './ApprovalDialog'
import type { Session } from '../lib/types'

const electron = (window as any).electronAPI
const AUTH_SERVER_URL = 'https://api.loccle.com'

export default function App() {
  const [authChecked, setAuthChecked] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [mastraReady, setMastraReady] = useState(false)
  const [mastraStarting, setMastraStarting] = useState(false)
  const [mastraError, setMastraError] = useState('')
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>(() => getCachedModels())
  const [activeModelId, setActiveModelId] = useState<string | null>(() => getFirstModelId())
  const catalogModelsRef = useRef<CatalogModel[]>(getCachedModels())

  const [paymentOverlayOpen, setPaymentOverlayOpen] = useState(false)
  const [paymentData, setPaymentData] = useState<any>(null)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)

  const { workspaces, activeWorkspace, addWorkspace, removeWorkspace, setActiveWorkspace } = useWorkspaces()
  const { sessions, currentSession, createSession, selectSession, deleteSession, updateSessionTitle, allSessions } = useSessions(activeWorkspace?.id, mastraReady)
  const chat = useAgentChat(currentSession?.id, mastraReady)
  const modelDisplayName = getModelDisplayName(activeModelId, catalogModels)

  // Check auth and verify session on mount
  useEffect(() => {
    const stored = localStorage.getItem('loccle-session')
    if (!stored) {
      setAuthChecked(true)
      return
    }

    try {
      const session = JSON.parse(stored)
      if (session?.token) {
        fetch(`${AUTH_SERVER_URL}/api/session/me`, {
          headers: { Authorization: `Bearer ${session.token}` },
        })
          .then((res) => {
            if (!res.ok) throw new Error('Session invalid')
            void electron?.setAuthSession?.({ token: session.token })
            setIsAuthenticated(true)
            void chat.refreshBalance()
          })
          .catch((err) => {
            console.error('[Auth] Session verification failed, logging out:', err)
            localStorage.removeItem('loccle-session')
            setIsAuthenticated(false)
          })
          .finally(() => {
            setAuthChecked(true)
          })
      } else {
        setAuthChecked(true)
      }
    } catch {
      setAuthChecked(true)
    }
  }, [chat.refreshBalance])

  const handleLogin = useCallback((token: string) => {
    localStorage.setItem('loccle-session', JSON.stringify({ token, loginAt: Date.now() }))
    void electron?.setAuthSession?.({ token })
    setIsAuthenticated(true)
    void chat.refreshBalance()
  }, [chat.refreshBalance])

  const handleLogout = useCallback(() => {
    localStorage.removeItem('loccle-session')
    void electron?.clearAuthSession?.()
    setIsAuthenticated(false)
    setMastraReady(false)
    if (electron?.stopMastra) {
      electron.stopMastra()
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return

    let cancelled = false

    const loadModels = async () => {
      const models = await fetchModels()
      if (cancelled) return

      catalogModelsRef.current = models
      setCatalogModels(models)
      setActiveModelId((current) => current ?? getFirstModelId(models))
    }

    void loadModels()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated])

  // Start Mastra when active workspace changes
  useEffect(() => {
    if (!activeWorkspace || !isAuthenticated) return

    let cancelled = false

    const start = async () => {
      setMastraStarting(true)
      setMastraReady(false)
      setMastraError('')

      try {
        if (electron?.startMastra) {
          const result = await electron.startMastra(activeWorkspace.path)
          if (cancelled) return

          if (result.ok && result.url) {
            setMastraUrl(result.url)
            resetMastraClient()
            const backendModelId = typeof result.modelId === 'string' && result.modelId.trim()
              ? result.modelId
              : null
            setActiveModelId(backendModelId ?? getFirstModelId(catalogModelsRef.current))
            setMastraReady(true)
          } else {
            setMastraError(result.error || 'Failed to start Loccle server')
          }
        } else {
          // Browser fallback — assume Loccle is already running
          setMastraUrl('http://localhost:4112')
          setActiveModelId((current) => current ?? getFirstModelId(catalogModelsRef.current))
          setMastraReady(true)
        }
      } catch (err: any) {
        if (!cancelled) {
          setMastraError(err.message || 'Failed to start Loccle')
        }
      } finally {
        if (!cancelled) setMastraStarting(false)
      }
    }

    start()
    return () => {
      cancelled = true
    }
  }, [activeWorkspace?.id, isAuthenticated])

  // Keep the Mastra server alive across workspace switches; each request carries
  // its workspace path in requestContext, so active streams can continue.
  const handleSelectWorkspace = useCallback(async (id: string) => {
    if (activeWorkspace?.id === id) return
    setMastraReady(false)
    setActiveWorkspace(id)
  }, [activeWorkspace?.id, setActiveWorkspace])

  const handleRemoveWorkspace = useCallback(async (id: string) => {
    if (activeWorkspace?.id === id) {
      setMastraReady(false)
    }
    removeWorkspace(id)
  }, [activeWorkspace, removeWorkspace])

  const handleSelectSession = useCallback(async (id: string, workspaceId: string) => {
    if (activeWorkspace?.id !== workspaceId) {
      await handleSelectWorkspace(workspaceId)
    }
    selectSession(id)
  }, [activeWorkspace?.id, handleSelectWorkspace, selectSession])

  const handleCreateSession = useCallback(async (workspaceId: string, title?: string) => {
    if (activeWorkspace?.id !== workspaceId) {
      await handleSelectWorkspace(workspaceId)
    }
    return createSession(workspaceId, title)
  }, [activeWorkspace?.id, handleSelectWorkspace, createSession])

  // Top-Up / Payment Selection
  const handlePaymentSelect = useCallback(async (amountIdr: number) => {
    const stored = localStorage.getItem('loccle-session')
    if (!stored) throw new Error('No active session')
    const session = JSON.parse(stored)
    if (!session?.token) throw new Error('No active token')

    const res = await fetch(`${AUTH_SERVER_URL}/api/payment/top-up`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ amountIdr }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error((body as any).error_description || (body as any).error || (body as any).message || `HTTP ${res.status}`)
    }

    const result = await res.json()
    setPaymentData(result.data)

    const url = result.data.redirectUrl || result.data.qrCodeUrl
    if (url) {
      if (electron?.openExternal) {
        electron.openExternal(url)
      } else {
        window.open(url, '_blank')
      }
    }
  }, [])

  // Poll transaction status when payment overlay is active
  useEffect(() => {
    if (!paymentOverlayOpen || !paymentData?.orderId) return

    let cancelled = false
    let timeout: NodeJS.Timeout | undefined

    const poll = async () => {
      const stored = localStorage.getItem('loccle-session')
      if (!stored) return
      try {
        const session = JSON.parse(stored)
        if (!session?.token) return

        const statusRes = await fetch(`${AUTH_SERVER_URL}/api/payment/status/${encodeURIComponent(paymentData.orderId)}`, {
          headers: { Authorization: `Bearer ${session.token}` },
        })
        const statusData = await statusRes.json().catch(() => ({}))
        const status = statusData.data?.status

        const latestBalance = await chat.refreshBalance()

        if (cancelled) return

        if (status === 'failed') {
          console.error('[Payment] Transaction failed or expired')
          return
        }

        const balanceNum = Number(latestBalance)
        if (status === 'success' || (latestBalance !== null && Number.isFinite(balanceNum) && balanceNum > 0)) {
          setPaymentOverlayOpen(false)
          setPaymentData(null)
          if (pendingPrompt && chat.status !== 'streaming' && chat.status !== 'awaiting-approval') {
            chat.submitPrompt(pendingPrompt, currentSession)
            setPendingPrompt(null)
          }
          return
        }
      } catch (err) {
        console.error('[Payment] Error polling payment status:', err)
      }

      if (!cancelled) {
        timeout = setTimeout(poll, 2000)
      }
    }

    timeout = setTimeout(poll, 1000)

    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
    }
  }, [paymentOverlayOpen, paymentData, pendingPrompt, chat.status, currentSession, chat.refreshBalance, chat.submitPrompt])

  // Intercept submitPrompt for balance checks
  const handleSubmitPrompt = useCallback((prompt: string, session?: Session) => {
    const balanceNum = Number(chat.balance)
    if (chat.balance !== null && Number.isFinite(balanceNum) && balanceNum <= 0) {
      setPendingPrompt(prompt)
      setPaymentOverlayOpen(true)
      setPaymentData(null)
      return
    }
    chat.submitPrompt(prompt, session)

    // Auto-rename default session based on first prompt
    const title = session?.title
    if (session && (title === 'Default Session' || !title)) {
      const firstLine = prompt.trim().split('\n')[0].trim()
      const newTitle = firstLine.length <= 50 ? firstLine : firstLine.slice(0, 47) + '...'
      updateSessionTitle(session.id, newTitle)
    }
  }, [chat.balance, chat.submitPrompt, updateSessionTitle])

  // Global keydown handler for tool approvals
  useEffect(() => {
    if (chat.status !== 'awaiting-approval') return

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      if (key === 'a' || key === 'y') {
        e.preventDefault()
        chat.respondToApproval(true)
      } else if (key === 'd' || key === 'n' || key === 'escape') {
        e.preventDefault()
        chat.respondToApproval(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [chat.status, chat.respondToApproval])

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

  const pendingApprovalEvent = [...chat.toolEvents].reverse().find(
    (te) => te.type === 'approval' && te.status === 'pending'
  )

  return (
    <div className="app-layout">
      <Sidebar
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        allSessions={allSessions}
        currentSession={currentSession}
        onAddWorkspace={addWorkspace}
        onRemoveWorkspace={handleRemoveWorkspace}
        onSelectWorkspace={handleSelectWorkspace}
        onCreateSession={handleCreateSession}
        onSelectSession={handleSelectSession}
        onDeleteSession={deleteSession}
        onLogout={handleLogout}
      />

      <ChatView
        messages={chat.messages}
        toolEvents={chat.toolEvents}
        status={chat.status}
        isStreaming={chat.isStreaming}
        onSubmit={handleSubmitPrompt}
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
        modelDisplayName={modelDisplayName}
        mastraReady={mastraReady}
        status={chat.globalStatus}
        activeStreamCount={chat.activeStreamCount}
        balance={chat.balance}
      />

      {paymentOverlayOpen && (
        <PaymentDialog
          onClose={() => setPaymentOverlayOpen(false)}
          onTopUp={handlePaymentSelect}
        />
      )}

      {chat.status === 'awaiting-approval' && pendingApprovalEvent && (
        <ApprovalDialog
          toolName={pendingApprovalEvent.summary}
          path={pendingApprovalEvent.path}
          selectedIndex={0}
          onApprove={() => chat.respondToApproval(true)}
          onDeny={() => chat.respondToApproval(false)}
        />
      )}
    </div>
  )
}
