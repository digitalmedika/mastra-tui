import React from 'react'
import type { Workspace } from '../lib/workspace-store'
import type { Session } from '../lib/types'

interface SidebarProps {
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  allSessions: Session[]
  currentSession: Session
  onAddWorkspace: () => Promise<Workspace | null>
  onRemoveWorkspace: (id: string) => void
  onSelectWorkspace: (id: string) => void
  onCreateSession: (workspaceId: string, title?: string) => void
  onSelectSession: (id: string, workspaceId: string) => void
  onDeleteSession: (id: string) => void
  onLogout?: () => void
}

export default function Sidebar({
  workspaces,
  activeWorkspace,
  allSessions,
  currentSession,
  onAddWorkspace,
  onRemoveWorkspace,
  onSelectWorkspace,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onLogout,
}: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-section" style={{ flex: 1, overflowY: 'auto' }}>
        <div className="sidebar-header">
          <span className="sidebar-title">WORKSPACES</span>
          <button
            className="icon-btn"
            onClick={onAddWorkspace}
            title="Add workspace"
          >
            +
          </button>
        </div>

        <div className="sidebar-list">
          {workspaces.map((ws) => {
            const wsSessions = allSessions.filter((s) => s.workspaceId === ws.id)
            const isWsActive = activeWorkspace?.id === ws.id

            return (
              <div key={ws.id} className="sidebar-workspace-node">
                <div
                  className={`sidebar-workspace-row ${isWsActive ? 'active' : ''}`}
                  onClick={() => onSelectWorkspace(ws.id)}
                >
                  <span className="sidebar-item-icon">📁</span>
                  <div className="sidebar-item-content">
                    <div className="sidebar-item-name">{ws.name}</div>
                    <div className="sidebar-item-meta" title={ws.path}>{ws.path}</div>
                  </div>
                  <div className="sidebar-workspace-actions">
                    <button
                      className="icon-btn sidebar-item-action"
                      onClick={(e) => {
                        e.stopPropagation()
                        onCreateSession(ws.id)
                      }}
                      title="New session"
                    >
                      +
                    </button>
                    <button
                      className="icon-btn sidebar-item-action"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveWorkspace(ws.id)
                      }}
                      title="Remove workspace"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="sidebar-sessions-list">
                  {wsSessions.map((s) => (
                    <div
                      key={s.id}
                      className={`sidebar-session-item ${
                        currentSession.id === s.id && isWsActive ? 'active' : ''
                      }`}
                      onClick={() => onSelectSession(s.id, ws.id)}
                    >
                      <span className="sidebar-session-icon">💬</span>
                      <div className="sidebar-session-name">{s.title || s.id}</div>
                      {wsSessions.length > 1 && (
                        <button
                          className="icon-btn sidebar-session-action"
                          onClick={(e) => {
                            e.stopPropagation()
                            onDeleteSession(s.id)
                          }}
                          title="Delete session"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="sidebar-item muted">
          <span className="sidebar-item-icon">❖</span>
          <span>Loccle Desktop v1.0</span>
        </div>
        {onLogout && (
          <button className="btn btn-secondary btn-block" onClick={onLogout} style={{ fontSize: 11, padding: '4px 8px' }}>
            Logout
          </button>
        )}
      </div>
    </div>
  )
}
