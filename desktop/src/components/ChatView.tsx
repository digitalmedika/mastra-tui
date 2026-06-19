import React, { useState, useRef, useEffect, useCallback } from 'react'
import type { Message, ToolEvent, Session, ImageAttachment } from '../lib/types'
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
  onSubmit: (prompt: string, session?: Session, images?: ImageAttachment[]) => void
  onCancel: () => void
  onClear: () => void
  currentSession: Session
  currentWorkspace: Workspace | null
  mastraReady: boolean
  mastraStarting?: boolean
  mastraError?: string
  supportsVision?: boolean
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
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
  supportsVision = true,
}: ChatViewProps) {
  const [inputValue, setInputValue] = useState('')
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, toolEvents, isStreaming])

  // Image paste handler
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData || !supportsVision) return

      const items = e.clipboardData.items
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item.type.startsWith('image/')) continue

        e.preventDefault()

        const blob = item.getAsFile()
        if (!blob) continue

        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          // dataUrl format: "data:image/png;base64,XXXX"
          const base64Match = dataUrl.match(/^data:.+;base64,(.+)$/)
          const base64 = base64Match ? base64Match[1] : dataUrl

          const attachment: ImageAttachment = {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            base64,
            mediaType: item.type,
            sizeBytes: blob.size,
          }

          setImageAttachments((prev) => [...prev, attachment])
        }
        reader.readAsDataURL(blob)
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [supportsVision])

  const clearAttachments = useCallback(() => {
    setImageAttachments([])
  }, [])

  const removeLastAttachment = useCallback(() => {
    setImageAttachments((prev) => prev.slice(0, -1))
  }, [])

  const handleSubmit = () => {
    const trimmed = inputValue.trim()
    if (!trimmed || isStreaming || status === 'awaiting-approval') return

    if (trimmed === '/clear') {
      setInputValue('')
      setImageAttachments([])
      onClear()
      return
    }

    onSubmit(trimmed, currentSession, imageAttachments.length > 0 ? imageAttachments : undefined)
    setInputValue('')
    setImageAttachments([])
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    // Escape clears image attachments
    if (e.key === 'Escape' && imageAttachments.length > 0) {
      e.preventDefault()
      setImageAttachments([])
      return
    }
    // Backspace on empty input removes last attachment
    if (e.key === 'Backspace' && imageAttachments.length > 0 && !inputValue) {
      e.preventDefault()
      setImageAttachments((prev) => prev.slice(0, -1))
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

      {/* Image attachments display */}
      {imageAttachments.length > 0 && (
        <div className="chatview-attachments">
          <span className="attachments-label">
            📎 {imageAttachments.length} image{imageAttachments.length > 1 ? 's' : ''} attached
          </span>
          {imageAttachments.map((img) => (
            <span key={img.id} className="attachment-badge">
              {img.mediaType} ({formatSize(img.sizeBytes)})
              <button
                className="attachment-remove"
                onClick={() => setImageAttachments((prev) => prev.filter((a) => a.id !== img.id))}
                title="Remove"
              >
                ×
              </button>
            </span>
          ))}
          <span className="attachment-hint">Press Escape to clear all · Backspace on empty input to remove last</span>
        </div>
      )}

      {/* Vision warning */}
      {!supportsVision && imageAttachments.length > 0 && (
        <div className="chatview-vision-warning">
          ⚠️ This model does not support vision. Images will be ignored.
        </div>
      )}

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
