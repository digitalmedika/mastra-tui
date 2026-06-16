import React from 'react'

interface ModelPickerProps {
  models: { name: string; id: string; provider: string }[]
  selectedModelId: string
  onSelect: (modelId: string) => void
  onClose: () => void
}

export default function ModelPicker({
  models,
  selectedModelId,
  onSelect,
  onClose,
}: ModelPickerProps) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Select Model</h3>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>
        <div className="dialog-body">
          {models.length === 0 ? (
            <p className="text-muted">No models available. Using default.</p>
          ) : (
            models.map((m) => (
              <div
                key={m.id}
                className={`dialog-item ${m.id === selectedModelId ? 'active' : ''}`}
                onClick={() => onSelect(m.id)}
              >
                <div className="dialog-item-name">{m.name}</div>
                <div className="dialog-item-meta">{m.provider}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
