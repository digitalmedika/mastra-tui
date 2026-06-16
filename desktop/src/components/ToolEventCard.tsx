import React from 'react'
import type { ToolEvent } from '../lib/types'

interface ToolEventCardProps {
  event: ToolEvent
}

const statusColors: Record<string, string> = {
  running: '#c8a7ff',
  done: '#4fc1ff',
  error: '#f87171',
  pending: '#facc15',
  approved: '#4ade80',
  denied: '#f87171',
  waiting: '#7e8494',
}

const typeColors: Record<string, string> = {
  run: '#6d5dfc',
  edit: '#1d4ed8',
  read: '#0f766e',
  explore: '#7547ff',
  shell: '#2374ab',
  'task-list': '#6b4dff',
  approval: '#7c2d12',
  usage: '#065f46',
}

export default function ToolEventCard({ event }: ToolEventCardProps) {
  const statusColor = statusColors[event.status] || '#7e8494'
  const typeColor = typeColors[event.type] || '#6d5dfc'

  return (
    <div className={`tool-event-card ${event.status}`}>
      <div className="tool-event-header">
        <span
          className="tool-event-badge"
          style={{ backgroundColor: typeColor }}
        >
          {event.label}
        </span>
        <span className="tool-event-summary">{event.summary}</span>
        <span className="tool-event-status" style={{ color: statusColor }}>
          {event.status === 'running' ? '···' : event.status === 'done' ? '✓' : event.status === 'error' ? '✗' : event.status}
        </span>
      </div>
      {event.path && (
        <div className="tool-event-path">{event.path}</div>
      )}
      {event.details && (
        <div className="tool-event-details">
          <pre>{event.details}</pre>
        </div>
      )}
      {event.usage && (
        <div className="tool-event-usage">
          <span>In: {event.usage.inputTokens ?? '?'}</span>
          <span>Out: {event.usage.outputTokens ?? '?'}</span>
          <span>Total: {event.usage.totalTokens ?? '?'}</span>
        </div>
      )}
    </div>
  )
}
