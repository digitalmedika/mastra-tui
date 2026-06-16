import React from 'react'

interface ApprovalDialogProps {
  toolName: string
  path?: string
  selectedIndex: number
  onApprove: () => void
  onDeny: () => void
}

export default function ApprovalDialog({
  toolName,
  path,
  selectedIndex,
  onApprove,
  onDeny,
}: ApprovalDialogProps) {
  return (
    <div className="approval-dialog-overlay">
      <div className="approval-dialog">
        <div className="approval-icon">⚠</div>
        <h3>Tool Access Approval</h3>
        <p>
          The agent wants to use <strong>{toolName}</strong>
          {path && (
            <>
              {' '}on <code>{path}</code>
            </>
          )}
        </p>
        <p className="approval-hint">
          This path is outside your workspace. Allow access?
        </p>
        <div className="approval-actions">
          <button
            className={`btn btn-approve ${selectedIndex === 0 ? 'selected' : ''}`}
            onClick={onApprove}
            autoFocus
          >
            Approve (A/Y)
          </button>
          <button
            className={`btn btn-deny ${selectedIndex === 1 ? 'selected' : ''}`}
            onClick={onDeny}
          >
            Deny (D/N/Esc)
          </button>
        </div>
      </div>
    </div>
  )
}
