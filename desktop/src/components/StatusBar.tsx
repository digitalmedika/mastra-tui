import React from 'react'
import type { TokenUsage } from '../lib/types'

interface StatusBarProps {
  workspaceName: string
  modelDisplayName: string
  mastraReady: boolean
  status: string
  activeStreamCount?: number
  usage?: TokenUsage
  balance: string | null
}

export default function StatusBar({
  workspaceName,
  modelDisplayName,
  mastraReady,
  status,
  activeStreamCount = 0,
  usage,
  balance,
}: StatusBarProps) {
  const statusLabel =
    status === 'streaming' ? (activeStreamCount > 1 ? `${activeStreamCount} streams running` : 'Streaming...')
    : status === 'awaiting-approval' ? 'Awaiting approval'
    : status === 'finished' ? 'Ready'
    : status === 'error' ? 'Error'
    : mastraReady ? 'Ready'
    : 'Waiting for server...'

  const statusClass =
    status === 'streaming' ? 'status-streaming'
    : status === 'awaiting-approval' ? 'status-warning'
    : status === 'error' ? 'status-error'
    : mastraReady ? 'status-ready'
    : 'status-waiting'

  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span className="statusbar-workspace">📁 {workspaceName}</span>
        <span className="statusbar-separator">|</span>
        <span className="statusbar-model">{modelDisplayName}</span>
        {balance !== null && (
          <>
            <span className="statusbar-separator">|</span>
            <span className="statusbar-balance">💰 ${Number(balance).toFixed(2)}</span>
          </>
        )}
      </div>
      <div className="statusbar-right">
        {usage && (
          <span className="statusbar-usage">
            Tokens: {usage.totalTokens ?? '?'}
          </span>
        )}
        <span className={`statusbar-indicator ${statusClass}`}>
          {mastraReady ? '●' : '○'} {statusLabel}
        </span>
      </div>
    </div>
  )
}
