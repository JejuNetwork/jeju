/**
 * MFASetup Component
 *
 * Complete MFA setup flow for TOTP, Passkeys, and backup codes.
 */

import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { MFAMethod } from '../../mfa/index'
import { useMFA } from '../hooks/useMFA'

export interface MFASetupProps {
  onComplete?: (method: MFAMethod) => void
  showTOTP?: boolean
  showPasskeys?: boolean
  showBackupCodes?: boolean
  className?: string
  style?: React.CSSProperties
}

export function MFASetup({
  onComplete,
  showTOTP = true,
  showPasskeys = true,
  showBackupCodes = true,
  className = '',
  style,
}: MFASetupProps) {
  const {
    mfaStatus,
    isLoading,
    error,
    setupTOTP,
    verifyTOTP,
    disableTOTP,
    setupPasskey,
    listPasskeys,
    removePasskey,
    generateBackupCodes,
    refreshStatus: _refreshStatus,
  } = useMFA({ onSetupComplete: onComplete })

  const [view, setView] = useState<'main' | 'totp' | 'passkey' | 'backup'>(
    'main',
  )
  const [totpSetup, setTotpSetup] = useState<{
    secret: string
    uri: string
    qrCode: string
  } | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [passkeyName, setPasskeyName] = useState('')
  const [passkeys, setPasskeys] = useState<
    Array<{ id: string; deviceName: string; createdAt: number }>
  >([])
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [localError, setLocalError] = useState<string | null>(null)

  // Load passkeys
  useEffect(() => {
    if (view === 'passkey') {
      listPasskeys().then(setPasskeys)
    }
  }, [view, listPasskeys])

  const handleSetupTOTP = useCallback(async () => {
    setLocalError(null)
    const result = await setupTOTP()
    if (result) {
      setTotpSetup(result)
      setView('totp')
    }
  }, [setupTOTP])

  const handleVerifyTOTP = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setLocalError(null)

      const success = await verifyTOTP(totpCode)
      if (success) {
        setTotpSetup(null)
        setTotpCode('')
        setView('main')
      } else {
        setLocalError('Invalid code. Please try again.')
      }
    },
    [verifyTOTP, totpCode],
  )

  const handleDisableTOTP = useCallback(async () => {
    await disableTOTP()
    setView('main')
  }, [disableTOTP])

  const handleSetupPasskey = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setLocalError(null)

      const success = await setupPasskey(passkeyName ?? 'My Device')
      if (success) {
        setPasskeyName('')
        await listPasskeys().then(setPasskeys)
      }
    },
    [setupPasskey, passkeyName, listPasskeys],
  )

  const handleRemovePasskey = useCallback(
    async (id: string) => {
      await removePasskey(id)
      await listPasskeys().then(setPasskeys)
    },
    [removePasskey, listPasskeys],
  )

  const handleGenerateBackupCodes = useCallback(async () => {
    setLocalError(null)
    const codes = await generateBackupCodes()
    if (codes) {
      setBackupCodes(codes)
      setView('backup')
    }
  }, [generateBackupCodes])

  const containerStyle: React.CSSProperties = {
    padding: '24px',
    backgroundColor: 'white',
    borderRadius: '12px',
    maxWidth: '500px',
    ...style,
  }

  const titleStyle: React.CSSProperties = {
    fontSize: '20px',
    fontWeight: 600,
    marginBottom: '8px',
  }

  const subtitleStyle: React.CSSProperties = {
    fontSize: '14px',
    color: '#666',
    marginBottom: '24px',
  }

  const cardStyle: React.CSSProperties = {
    padding: '16px',
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    marginBottom: '12px',
    cursor: 'pointer',
  }

  const buttonStyle: React.CSSProperties = {
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    cursor: isLoading ? 'not-allowed' : 'pointer',
    backgroundColor: '#4F46E5',
    color: 'white',
    fontWeight: 500,
  }

  const backButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#4F46E5',
    cursor: 'pointer',
    marginBottom: '16px',
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    borderRadius: '8px',
    border: '1px solid #e0e0e0',
    marginBottom: '12px',
    fontSize: '16px',
  }

  const errorStyle: React.CSSProperties = {
    color: '#DC2626',
    fontSize: '14px',
    marginBottom: '12px',
  }

  const displayError = localError || error

  if (view === 'totp' && totpSetup) {
    return (
      <div style={containerStyle} className={className}>
        <button
          type="button"
          style={backButtonStyle}
          onClick={() => {
            setView('main')
            setTotpSetup(null)
          }}
        >
          ← Back
        </button>

        <h3 style={titleStyle}>Set up Authenticator App</h3>
        <p style={subtitleStyle}>
          Scan this QR code with your authenticator app (Google Authenticator,
          Authy, etc.)
        </p>

        {displayError && <p style={errorStyle}>{displayError}</p>}

        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          {/* QR Code would go here - for now show URI */}
          <div
            style={{
              width: '200px',
              height: '200px',
              backgroundColor: '#f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              borderRadius: '8px',
            }}
          >
            QR Code
          </div>

          <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
            Or enter this code manually:
          </p>
          <code
            style={{
              display: 'block',
              padding: '8px 16px',
              backgroundColor: '#f3f4f6',
              borderRadius: '4px',
              fontSize: '14px',
              wordBreak: 'break-all',
            }}
          >
            {totpSetup.secret}
          </code>
        </div>

        <form onSubmit={handleVerifyTOTP}>
          <input
            type="text"
            placeholder="Enter 6-digit code"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            style={inputStyle}
            maxLength={6}
            pattern="\d{6}"
            required
          />
          <button
            type="submit"
            style={{ ...buttonStyle, width: '100%' }}
            disabled={isLoading}
          >
            {isLoading ? 'Verifying...' : 'Verify & Enable'}
          </button>
        </form>
      </div>
    )
  }

  if (view === 'passkey') {
    return (
      <div style={containerStyle} className={className}>
        <button
          type="button"
          style={backButtonStyle}
          onClick={() => setView('main')}
        >
          ← Back
        </button>

        <h3 style={titleStyle}>Passkeys</h3>
        <p style={subtitleStyle}>
          Use your device's biometrics or security key for passwordless
          authentication.
        </p>

        {displayError && <p style={errorStyle}>{displayError}</p>}

        {passkeys.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h4
              style={{
                fontSize: '14px',
                fontWeight: 600,
                marginBottom: '12px',
              }}
            >
              Your Passkeys
            </h4>
            {passkeys.map((pk) => (
              <div
                key={pk.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px',
                  border: '1px solid #e0e0e0',
                  borderRadius: '8px',
                  marginBottom: '8px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{pk.deviceName}</div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    Added {new Date(pk.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemovePasskey(pk.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#DC2626',
                    cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSetupPasskey}>
          <input
            type="text"
            placeholder="Device name (optional)"
            value={passkeyName}
            onChange={(e) => setPasskeyName(e.target.value)}
            style={inputStyle}
          />
          <button
            type="submit"
            style={{ ...buttonStyle, width: '100%' }}
            disabled={isLoading}
          >
            {isLoading ? 'Setting up...' : '+ Add New Passkey'}
          </button>
        </form>
      </div>
    )
  }

  if (view === 'backup') {
    return (
      <div style={containerStyle} className={className}>
        <button
          type="button"
          style={backButtonStyle}
          onClick={() => {
            setView('main')
            setBackupCodes([])
          }}
        >
          ← Back
        </button>

        <h3 style={titleStyle}>Backup Codes</h3>
        <p style={subtitleStyle}>
          Save these codes in a secure place. Each code can only be used once.
        </p>

        <div
          style={{
            backgroundColor: '#FEF3C7',
            border: '1px solid #F59E0B',
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '24px',
          }}
        >
          <strong>⚠️ Important:</strong> These codes will only be shown once.
          Save them now!
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '8px',
            marginBottom: '24px',
          }}
        >
          {backupCodes.map((code) => (
            <div
              key={`backup-code-${code}`}
              style={{
                padding: '8px 12px',
                backgroundColor: '#f3f4f6',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '14px',
                textAlign: 'center',
              }}
            >
              {code}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            const text = backupCodes.join('\n')
            navigator.clipboard.writeText(text)
          }}
          style={{ ...buttonStyle, width: '100%', marginBottom: '12px' }}
        >
          Copy All Codes
        </button>

        <button
          type="button"
          onClick={() => {
            setView('main')
            setBackupCodes([])
          }}
          style={{ ...buttonStyle, width: '100%', backgroundColor: '#22C55E' }}
        >
          I've Saved My Codes
        </button>
      </div>
    )
  }

  // Main view
  return (
    <div style={containerStyle} className={className}>
      <h3 style={titleStyle}>Two-Factor Authentication</h3>
      <p style={subtitleStyle}>
        Add extra security to your account with these verification methods.
      </p>

      {displayError && <p style={errorStyle}>{displayError}</p>}

      {showTOTP && (
        <button
          type="button"
          style={{
            ...cardStyle,
            width: '100%',
            textAlign: 'left',
            background: 'none',
          }}
          onClick={() => !mfaStatus?.totpEnabled && handleSetupTOTP()}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                📱 Authenticator App
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>
                Use Google Authenticator, Authy, or similar
              </div>
            </div>
            {mfaStatus?.totpEnabled ? (
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span style={{ color: '#22C55E' }}>✓ Enabled</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDisableTOTP()
                  }}
                  style={{ ...backButtonStyle, color: '#DC2626', margin: 0 }}
                >
                  Disable
                </button>
              </div>
            ) : (
              <span style={{ color: '#4F46E5' }}>Set up →</span>
            )}
          </div>
        </button>
      )}

      {showPasskeys && (
        <button
          type="button"
          style={{
            ...cardStyle,
            width: '100%',
            textAlign: 'left',
            background: 'none',
          }}
          onClick={() => setView('passkey')}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                🔑 Passkeys
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>
                Use biometrics or security keys
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {(mfaStatus?.passkeyCount ?? 0) > 0 && (
                <span style={{ color: '#22C55E' }}>
                  {mfaStatus?.passkeyCount} key
                  {(mfaStatus?.passkeyCount ?? 0) > 1 ? 's' : ''}
                </span>
              )}
              <span style={{ color: '#4F46E5' }}>Manage →</span>
            </div>
          </div>
        </button>
      )}

      {showBackupCodes && (
        <button
          type="button"
          style={{
            ...cardStyle,
            width: '100%',
            textAlign: 'left',
            background: 'none',
          }}
          onClick={handleGenerateBackupCodes}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 500, marginBottom: '4px' }}>
                🔐 Backup Codes
              </div>
              <div style={{ fontSize: '14px', color: '#666' }}>
                One-time codes for account recovery
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {(mfaStatus?.backupCodesRemaining ?? 0) > 0 && (
                <span style={{ color: '#666' }}>
                  {mfaStatus?.backupCodesRemaining} remaining
                </span>
              )}
              <span style={{ color: '#4F46E5' }}>
                {(mfaStatus?.backupCodesRemaining ?? 0) > 0
                  ? 'Regenerate →'
                  : 'Generate →'}
              </span>
            </div>
          </div>
        </button>
      )}
    </div>
  )
}
