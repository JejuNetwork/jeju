/**
 * LoginButton Component
 *
 * A pre-styled button for initiating OAuth3 login.
 */

import type React from 'react'
import { useCallback, useState } from 'react'
import { AuthProvider } from '../../types'
import { useOAuth3 } from '../provider'

export interface LoginButtonProps {
  provider?: AuthProvider
  onSuccess?: () => void
  onError?: (error: Error) => void
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
  disabled?: boolean
}

const providerLabels: Record<AuthProvider, string> = {
  [AuthProvider.WALLET]: 'Connect Wallet',
  [AuthProvider.FARCASTER]: 'Sign in with Farcaster',
  [AuthProvider.GOOGLE]: 'Continue with Google',
  [AuthProvider.APPLE]: 'Continue with Apple',
  [AuthProvider.TWITTER]: 'Continue with X',
  [AuthProvider.GITHUB]: 'Continue with GitHub',
  [AuthProvider.DISCORD]: 'Continue with Discord',
  [AuthProvider.EMAIL]: 'Continue with Email',
  [AuthProvider.PHONE]: 'Continue with Phone',
}

const providerIcons: Record<AuthProvider, string> = {
  [AuthProvider.WALLET]: '🔐',
  [AuthProvider.FARCASTER]: '🟣',
  [AuthProvider.GOOGLE]: '🔵',
  [AuthProvider.APPLE]: '🍎',
  [AuthProvider.TWITTER]: '✖️',
  [AuthProvider.GITHUB]: '🐙',
  [AuthProvider.DISCORD]: '💬',
  [AuthProvider.EMAIL]: '📧',
  [AuthProvider.PHONE]: '📱',
}

export function LoginButton({
  provider = AuthProvider.WALLET,
  onSuccess,
  onError: _onError,
  className = '',
  style,
  children,
  disabled = false,
}: LoginButtonProps) {
  const { login, isLoading } = useOAuth3()
  const [isButtonLoading, setIsButtonLoading] = useState(false)

  const handleClick = useCallback(async () => {
    if (isLoading || isButtonLoading || disabled) return

    setIsButtonLoading(true)

    await login(provider)
    onSuccess?.()
    setIsButtonLoading(false)
  }, [login, provider, isLoading, isButtonLoading, disabled, onSuccess])

  const buttonLabel = children ?? (
    <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span>{providerIcons[provider]}</span>
      <span>{providerLabels[provider]}</span>
    </span>
  )

  const defaultStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 500,
    borderRadius: '8px',
    border: 'none',
    cursor:
      disabled || isLoading || isButtonLoading ? 'not-allowed' : 'pointer',
    opacity: disabled || isLoading || isButtonLoading ? 0.6 : 1,
    backgroundColor: '#4F46E5',
    color: 'white',
    transition: 'all 0.2s',
    ...style,
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isLoading || isButtonLoading}
      className={`oauth3-login-button ${className}`}
      style={defaultStyle}
    >
      {isButtonLoading ? 'Connecting...' : buttonLabel}
    </button>
  )
}
