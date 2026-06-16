import React, { useState, useEffect, useCallback, useRef } from 'react'

interface AuthScreenProps {
  onLogin: (token: string) => void
}

const AUTH_SERVER_URL = 'https://api.loccle.com'
const CLIENT_ID = 'loccle-cli'

type LoginMode = 'select' | 'device' | 'manual'

export default function AuthScreen({ onLogin }: AuthScreenProps) {
  const [mode, setMode] = useState<LoginMode>('select')
  const [phase, setPhase] = useState<'loading' | 'polling' | 'error'>('loading')
  const [userCode, setUserCode] = useState('')
  const [verificationUri, setVerificationUri] = useState('')
  const [error, setError] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [manualLoading, setManualLoading] = useState(false)
  const cancelledRef = useRef(false)

  // ── Manual token login ───────────────────────────────────────────────
  const handleManualLogin = useCallback(async () => {
    const trimmed = manualToken.trim()
    if (!trimmed) return
    setManualLoading(true)
    setError('')
    try {
      const res = await fetch(`${AUTH_SERVER_URL}/api/session/me`, {
        headers: { Authorization: `Bearer ${trimmed}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as any).error_description || (body as any).error || 'Invalid token')
      }
      onLogin(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid token')
    } finally {
      setManualLoading(false)
    }
  }, [manualToken, onLogin])

  // ── Device OAuth flow (same as TUI) ──────────────────────────────────
  const startDeviceLogin = useCallback(async () => {
    cancelledRef.current = false
    setPhase('loading')
    setError('')

    try {
      const codeRes = await fetch(`${AUTH_SERVER_URL}/api/auth/device/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CLIENT_ID }),
      })

      if (!codeRes.ok) {
        const body = await codeRes.json().catch(() => ({}))
        throw new Error((body as any).error_description || (body as any).error || `HTTP ${codeRes.status}`)
      }

      const code = await codeRes.json() as {
        device_code: string
        user_code: string
        verification_uri: string
        verification_uri_complete: string
        expires_in: number
        interval: number
      }
      console.log('[DeviceAuth] got code:', { device_code: code.device_code, user_code: code.user_code })

      if (cancelledRef.current) return

      setUserCode(code.user_code)
      setVerificationUri(code.verification_uri_complete || code.verification_uri)
      setPhase('polling')

      const intervalMs = Math.max(code.interval ?? 10, 1) * 1000
      const expiresAt = Date.now() + Math.max(code.expires_in ?? 300, 1) * 1000

      while (!cancelledRef.current) {
        await new Promise((r) => setTimeout(r, intervalMs))
        if (cancelledRef.current) return

        const requestBody = {
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: code.device_code,
          client_id: CLIENT_ID,
        }
        console.log('[DeviceAuth] polling with:', requestBody)

        try {
          const tokenRes = await fetch(`${AUTH_SERVER_URL}/api/auth/device/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          })

          if (tokenRes.ok) {
            const tokenBody = await tokenRes.json() as { access_token: string; expires_in: number }
            if (cancelledRef.current) return

            const sessionRes = await fetch(`${AUTH_SERVER_URL}/api/session/me`, {
              headers: { Authorization: `Bearer ${tokenBody.access_token}` },
            })
            if (!sessionRes.ok) throw new Error('Session validation failed')

            if (cancelledRef.current) return
            onLogin(tokenBody.access_token)
            return
          }

          const body = await tokenRes.json().catch(() => ({})) as {
            error?: string
            error_description?: string
            message?: string
          }
          console.log('[DeviceAuth] poll response:', tokenRes.status, body)

          if (body.error === 'authorization_pending' || body.error === 'slow_down') {
            continue
          }

          if (body.error === 'expired_token') {
            setError('Login code expired. Please try again.')
            setPhase('error')
            return
          }
          if (body.error === 'access_denied') {
            setError('Login denied from browser.')
            setPhase('error')
            return
          }

          setError((body.error_description || body.message || body.error) as string)
          setPhase('error')
          return

        } catch (err) {
          if (!cancelledRef.current) {
            setError(err instanceof Error ? err.message : 'Connection failed')
            setPhase('error')
          }
          return
        }

        if (Date.now() >= expiresAt) {
          setError('Login code expired. Please try again.')
          setPhase('error')
          return
        }
      }
    } catch (err) {
      console.error('[DeviceAuth] error:', err)
      if (!cancelledRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to request login code')
        setPhase('error')
      }
    }
  }, [onLogin])

  useEffect(() => {
    if (mode === 'device') {
      startDeviceLogin()
      return () => { cancelledRef.current = true }
    }
  }, [mode, startDeviceLogin])

  // ── Helpers ──────────────────────────────────────────────────────────
  const handleOpenUrl = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const electron = (window as any).electronAPI
    if (electron?.openExternal && verificationUri) {
      electron.openExternal(verificationUri)
    } else if (verificationUri) {
      window.open(verificationUri, '_blank')
    }
  }, [verificationUri])

  const handleBack = () => {
    cancelledRef.current = true
    setMode('select')
    setError('')
    setPhase('loading')
  }

  // ── Render: Mode selector ───────────────────────────────────────────
  if (mode === 'select') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-icon">✦</div>
          <h1>Loccle Desktop</h1>
          <p className="auth-subtitle">AI-powered vibe coding assistant</p>

          <div className="auth-form">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn btn-primary btn-block" onClick={() => setMode('device')}>
                Device Login (Recommended)
              </button>
              <p className="empty-hint" style={{ textAlign: 'center', fontSize: 11 }}>
                Open a URL in your browser and enter a short code to sign in.
              </p>

              <div className="auth-divider"><span>or</span></div>

              <button className="btn btn-secondary btn-block" onClick={() => { setMode('manual'); setError('') }}>
                Paste API Token
              </button>
              <p className="empty-hint" style={{ textAlign: 'center', fontSize: 11 }}>
                Use an API token from your loccle.com account settings.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: Manual token ─────────────────────────────────────────────
  if (mode === 'manual') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-icon">✦</div>
          <h1>Loccle Desktop</h1>
          <p className="auth-subtitle">Sign in with API token</p>

          <div className="auth-form">
            <div className="auth-field">
              <label>API Token</label>
              <input
                type="password"
                className="auth-input"
                value={manualToken}
                onChange={(e) => { setManualToken(e.target.value); setError('') }}
                onKeyDown={(e) => e.key === 'Enter' && handleManualLogin()}
                placeholder="Paste your loccle.com API token"
                disabled={manualLoading}
                autoFocus
              />
            </div>

            {error && <div className="auth-error">{error}</div>}

            <button
              className="btn btn-primary btn-block"
              onClick={handleManualLogin}
              disabled={manualLoading || !manualToken.trim()}
            >
              {manualLoading ? 'Verifying...' : 'Sign In'}
            </button>

            <div style={{ marginTop: 12 }}>
              <button className="btn btn-secondary btn-block" onClick={handleBack}>
                ← Back
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: Device login ─────────────────────────────────────────────
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-icon">✦</div>
        <h1>Loccle Desktop</h1>
        <p className="auth-subtitle">Device login</p>

        <div className="auth-form">
          {phase === 'loading' && (
            <div className="loading-center">
              <div className="loading-spinner" />
              <p>Requesting device login code...</p>
            </div>
          )}

          {phase === 'polling' && (
            <>
              <div className="device-login-step">
                <div className="device-login-label">Verification URL</div>
                <div className="device-login-value">
                  <code>{verificationUri || 'Loading...'}</code>
                </div>
                <button className="btn btn-secondary btn-block" onClick={handleOpenUrl} style={{ marginTop: 8 }}>
                  Open in Browser
                </button>
              </div>

              <div className="auth-divider"><span>then enter this code</span></div>

              <div className="device-login-step">
                <div className="device-login-label">User Code</div>
                <div className="device-login-code">{userCode || '---'}</div>
                <p className="device-login-hint">
                  Copy this code, open the URL above in your browser, and paste the code to authorize.
                </p>
              </div>

              <div className="loading-center" style={{ padding: '12px 0' }}>
                <div className="loading-spinner" />
                <p>Waiting for browser approval...</p>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <div className="auth-error">{error}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn btn-primary btn-block" onClick={() => startDeviceLogin()}>
                  Try Again
                </button>
                <button className="btn btn-secondary btn-block" onClick={handleBack}>
                  ← Back
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
