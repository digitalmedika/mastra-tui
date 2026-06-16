import React, { useState } from 'react'

interface PaymentDialogProps {
  onClose: () => void
  onTopUp: (amountIdr: number) => Promise<void>
}

export const PAYMENT_AMOUNTS = [
  { label: 'Rp 20.000', value: 20000 },
  { label: 'Rp 50.000', value: 50000 },
  { label: 'Rp 100.000', value: 100000 },
  { label: 'Rp 200.000', value: 200000 },
]

export default function PaymentDialog({ onClose, onTopUp }: PaymentDialogProps) {
  const [selected, setSelected] = useState(0)
  const [phase, setPhase] = useState<'select' | 'loading' | 'ready' | 'error'>('select')
  const [error, setError] = useState('')

  const handleTopUp = async () => {
    setPhase('loading')
    setError('')
    try {
      await onTopUp(PAYMENT_AMOUNTS[selected].value)
      setPhase('ready')
    } catch (err: any) {
      setError(err.message || 'Top-up failed')
      setPhase('error')
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Top Up Credits</h3>
          <button className="icon-btn" onClick={onClose}>×</button>
        </div>

        <div className="dialog-body">
          {phase === 'select' && (
            <>
              <p className="dialog-hint">Select top-up amount:</p>
              {PAYMENT_AMOUNTS.map((amount, i) => (
                <div
                  key={amount.value}
                  className={`dialog-item ${i === selected ? 'active' : ''}`}
                  onClick={() => setSelected(i)}
                >
                  {amount.label}
                </div>
              ))}
              <button className="btn btn-primary btn-block" onClick={handleTopUp}>
                Continue
              </button>
            </>
          )}

          {phase === 'loading' && (
            <div className="loading-center">
              <div className="loading-spinner" />
              <p>Creating payment...</p>
            </div>
          )}

          {phase === 'ready' && (
            <>
              <p className="success-text">Payment created! Check your browser to complete payment.</p>
              <button className="btn btn-primary btn-block" onClick={onClose}>
                Done
              </button>
            </>
          )}

          {phase === 'error' && (
            <>
              <div className="auth-error">{error}</div>
              <button className="btn btn-primary btn-block" onClick={() => setPhase('select')}>
                Try Again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
