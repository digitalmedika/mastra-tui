import React, { useState } from 'react'
import type { Workspace } from '../lib/workspace-store'
import type { Session } from '../lib/types'

interface SidebarProps {
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  sessions: Session[]
  currentSession: Session
  onAddWorkspace: (name: string, path?: string) => Promise<Workspace | null>
  onRemoveWorkspace: (id: string) => void
  onSelectWorkspace: (id: string) => void
  onCreateSession: (title?: string) => Session
  onSelectSession: (id: string) => void
  onDeleteSession: (id: string) => void
}

export default function Sidebar({
  workspaces,
  activeWorkspace,
  sessions,
  currentSession,
  onAddWorkspace,
  onRemoveWorkspace,
  onSelectWorkspace,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
}: SidebarProps) {
  const [showNewWs, setShowNewWs] = useState(false)
  const [newWsName, setNewWsName] = useState('')

  const handleAddWs = async () => {
    if (!newWsName.trim()) return
    await onAddWorkspace(newWsName.trim())
    setNewWsName('')
    setShowNewWs(false)
  }

  return (
    <div className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-header">
          <span className="sidebar-title">WORKSPACES</span>
          <button
            className="icon-btn"
            onClick={() => setShowNewWs(!showNewWs)}
            title="Add workspace"
          >
            +
          </button>
        </div>

        {showNewWs && (
          <div className="sidebar-new-item">
            <input
              className="sidebar-input"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddWs()}
              placeholder="Workspace name"
              autoFocus
            />
          </div>
        )}

        <div className="sidebar-list">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className={`sidebar-item ${activeWorkspace?.id === ws.id ? 'active' : ''}`}
              onClick={() => onSelectWorkspace(ws.id)}
            >
              <span className="sidebar-item-icon">📁</span>
              <div className="sidebar-item-content">
                <div className="sidebar-item-name">{ws.name}</div>
                <div className="sidebar-item-meta" title={ws.path}>{ws.path}</div>
              </div>
              <button
                className="icon-btn sidebar-item-action"
                onClick={(e) => { e.stopPropagation(); onRemoveWorkspace(ws.id) }}
                title="Remove workspace"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-header">
          <span className="sidebar-title">SESSIONS</span>
          <button
            className="icon-btn"
            onClick={() => onCreateSession()}
            title="New session"
          >
            +
          </button>
        </div>

        <div className="sidebar-list">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`sidebar-item ${currentSession.id === s.id ? 'active' : ''}`}
              onClick={() => onSelectSession(s.id)}
            >
              <span className="sidebar-item-icon">💬</span>
              <div className="sidebar-item-content">
                <div className="sidebar-item-name">{s.title || s.id}</div>
              </div>
              {sessions.length > 1 && (
                <button
                  className="icon-btn sidebar-item-action"
                  onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id) }}
                  title="Delete session"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-item muted">
          <span className="sidebar-item-icon">❖</span>
          <span>Loccle Desktop v1.0</span>
        </div>
      </div>
    </div>
  )
}
