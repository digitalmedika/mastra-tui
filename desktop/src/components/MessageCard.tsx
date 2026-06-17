import React from 'react'
import type { Message } from '../lib/types'

interface MessageCardProps {
  message: Message
}

function renderMarkdown(text: string) {
  if (!text) return text

  return text
    .split('\n')
    .map((line, i) => {
      // Code blocks
      if (line.startsWith('```')) {
        return <code key={i} className="code-block">{line.replace(/^```\w*/, '').replace(/```$/, '')}</code>
      }
      // Inline code
      const inlineCode = line.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      // Bold
      const bold = inlineCode.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Simple paragraphs
      if (line.trim() === '') return <br key={i} />
      return (
        <div key={i} className="msg-line">
          <span
            className="message-text"
            dangerouslySetInnerHTML={{ __html: bold }}
          />
        </div>
      )
    })
}

export default function MessageCard({ message }: MessageCardProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isStreaming = message.status === 'streaming'

  if (message.role === 'tool') return null

  return (
    <div className={`message-card ${isUser ? 'user' : 'assistant'}`}>
      <div className="message-role">
        {isUser ? 'You' : 'Loccle'}
        {isStreaming && <span className="streaming-dot" />}
      </div>
      <div className="message-content">
        {renderMarkdown(message.content)}
      </div>
      {message.status === 'error' && !message.content && (
        <div className="message-error">Failed to get response. Check the Loccle server connection.</div>
      )}
    </div>
  )
}
