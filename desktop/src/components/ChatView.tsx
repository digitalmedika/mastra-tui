import React, { useState, useRef, useEffect } from 'react'
import type { Message, ToolEvent, Session } from '../lib/types'
import type { Workspace } from '../lib/workspace-store'
import MessageCard from './MessageCard'
import ToolEventCard from './ToolEventCard'
import StreamingBubble from './StreamingBubble'
import ApprovalDialog from './ApprovalDialog'

interface ChatViewProps {
  messages: Message[]
  toolEvents: ToolEvent[]
  status: string
  isStreaming: boolean
  onSubmit: (prompt: string, session?: Session) => void
  onCancel: () => void
  onClear: () => void
  currentSession: Session
  currentWorkspace: Workspace | null
  mastraReady: boolean
  mastraStarting?: boolean
  mastraError?: string
}

export default function ChatView({
  messages,
  toolEvents,
  status,
  isStreaming,
  onSubmit,
  onCancel,
  onClear,
  currentSession,
  currentWorkspace,
  mastraReady,
  mastraStarting,
  mastraError,
}: ChatViewProps) {
  const [inputValue, setInputValue] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, toolEvents, isStreaming])

  const handleSubmit = () => {
    const trimmed = inputValue.trim()
    if (!trimmed || isStreaming || status === 'awaiting-approval') return

    if (trimmed === '/clear') {
      setInputValue('')
      onClear()
      return
    }

    onSubmit(trimmed, currentSession)
    setInputValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const placeholder = !currentWorkspace
    ? 'Add a workspace first...'
    : !mastraReady
    ? mastraStarting
      ? 'Starting Loccle server...'
      : mastraError
        ? `Error: ${mastraError}`
        : 'Waiting for Loccle...'
    : isStreaming
    ? 'AI is responding...'
    : status === 'awaiting-approval'
    ? 'Use the approval dialog above...'
    : `Ask anything in ${currentWorkspace.name}... (Shift+Enter for new line)`

  const inputDisabled = !mastraReady || isStreaming || status === 'awaiting-approval'
  const latestAssistantIndex = toolEvents.length > 0
    ? messages.map((msg) => msg.role).lastIndexOf('assistant')
    : -1
  const renderedToolEvents = toolEvents.map((te) => (
    <ToolEventCard key={te.id} event={te} />
  ))

  return (
    <div className="chatview">
      <div className="chatview-messages">
        {messages.length === 0 && toolEvents.length === 0 && (
          <div className="chatview-empty">
            <div className="empty-icon">✦</div>
            <h2>Loccle Desktop</h2>
            {!currentWorkspace ? (
              <p>Add a workspace from the sidebar to get started</p>
            ) : mastraStarting ? (
              <p>Starting Loccle server for <strong>{currentWorkspace.name}</strong>...</p>
            ) : mastraError ? (
              <p className="message-error" style={{ textAlign: 'center' }}>{mastraError}</p>
            ) : mastraReady ? (
              <p>Ready in <strong>{currentWorkspace.name}</strong></p>
            ) : (
              <p>Waiting for Loccle to start...</p>
            )}
            <p className="empty-hint">Ask me to read, edit, or explore your code</p>
          </div>
        )}

        {messages.map((msg, index) => (
          <React.Fragment key={msg.id}>
            {index === latestAssistantIndex && renderedToolEvents}
            <MessageCard message={msg} />
          </React.Fragment>
        ))}

        {latestAssistantIndex === -1 && renderedToolEvents}

        {/* Streaming indicator */}
        {isStreaming && <StreamingBubble />}

        <div ref={messagesEndRef} />
      </div>

      <div className="chatview-input-area">
        <div className="chatview-input-row">
          <textarea
            className="chatview-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={inputDisabled}
            rows={1}
          />
          {isStreaming ? (
            <button className="btn btn-danger" onClick={onCancel}>
              Stop
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={inputDisabled || !inputValue.trim()}
            >
              Send
            </button>
          )}
        </div>

        <div className="chatview-input-hints">
          <span className="hint">/clear</span>
          <span className="hint-sep">·</span>
          <span className="hint">/new</span>
          <span className="hint-sep">·</span>
          <span className="hint">/model</span>
          <span className="hint-sep">·</span>
          <span className="hint">/allow &lt;path&gt;</span>
        </div>
      </div>
    </div>
  )
}
