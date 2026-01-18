/**
 * JejuAuthButton - Unified Authentication Button
 *
 * A standardized auth button that works with the KMS-based OAuth3 system.
 * Supports wallet, Farcaster, and social logins with a consistent UX.
 */

import { useJejuAuth } from '@jejunetwork/auth/react'
import { AuthProvider } from '@jejunetwork/auth/types'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export interface JejuAuthButtonProps {
  /** Custom label for the connect button */
  connectLabel?: string
  /** App name shown in the modal */
  appName?: string
  /** App icon shown in the modal */
  appIcon?: string
  /** Enabled auth providers (defaults to all) */
  providers?: AuthProvider[]
  /** Show full address when connected */
  showFullAddress?: boolean
  /** Callback when authentication succeeds */
  onSuccess?: () => void
  /** Callback when authentication fails */
  onError?: (error: Error) => void
  /** Additional CSS class names */
  className?: string
  /** Custom styles */
  style?: React.CSSProperties
  /** Button variant */
  variant?: 'default' | 'compact' | 'icon'
}

const DEFAULT_PROVIDERS: AuthProvider[] = [
  AuthProvider.WALLET,
  AuthProvider.FARCASTER,
  AuthProvider.GOOGLE,
  AuthProvider.GITHUB,
  AuthProvider.TWITTER,
  AuthProvider.DISCORD,
]

const PROVIDER_CONFIG: Record<
  AuthProvider,
  { label: string; icon: string; color: string }
> = {
  [AuthProvider.WALLET]: {
    label: 'Connect Wallet',
    icon: '🔐',
    color: 'hover:bg-blue-500/10 hover:border-blue-500/30',
  },
  [AuthProvider.FARCASTER]: {
    label: 'Farcaster',
    icon: '🟣',
    color: 'hover:bg-purple-500/10 hover:border-purple-500/30',
  },
  [AuthProvider.GOOGLE]: {
    label: 'Google',
    icon: '🔵',
    color: 'hover:bg-red-500/10 hover:border-red-500/30',
  },
  [AuthProvider.GITHUB]: {
    label: 'GitHub',
    icon: '⚫',
    color: 'hover:bg-gray-500/10 hover:border-gray-500/30',
  },
  [AuthProvider.TWITTER]: {
    label: 'X',
    icon: '🐦',
    color: 'hover:bg-sky-500/10 hover:border-sky-500/30',
  },
  [AuthProvider.DISCORD]: {
    label: 'Discord',
    icon: '💬',
    color: 'hover:bg-indigo-500/10 hover:border-indigo-500/30',
  },
  [AuthProvider.APPLE]: {
    label: 'Apple',
    icon: '🍎',
    color: 'hover:bg-gray-500/10 hover:border-gray-500/30',
  },
  [AuthProvider.EMAIL]: {
    label: 'Email',
    icon: '📧',
    color: 'hover:bg-teal-500/10 hover:border-teal-500/30',
  },
  [AuthProvider.PHONE]: {
    label: 'Phone',
    icon: '📱',
    color: 'hover:bg-green-500/10 hover:border-green-500/30',
  },
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function Spinner() {
  return (
    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
      <title>Loading</title>
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

export function JejuAuthButton({
  connectLabel = 'Sign In',
  appName = 'Jeju',
  appIcon = '🏝️',
  providers = DEFAULT_PROVIDERS,
  showFullAddress = false,
  onSuccess,
  onError,
  className = '',
  style,
  variant = 'default',
}: JejuAuthButtonProps) {
  const {
    authenticated,
    loading,
    walletAddress,
    loginWithWallet,
    loginWithFarcaster,
    logout,
  } = useJejuAuth()

  const [showModal, setShowModal] = useState(false)
  const [activeProvider, setActiveProvider] = useState<AuthProvider | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setShowDropdown(false)
    if (showDropdown) {
      document.addEventListener('click', handleClickOutside)
    }
    return () => document.removeEventListener('click', handleClickOutside)
  }, [showDropdown])

  const handleLogin = useCallback(
    async (provider: AuthProvider) => {
      setActiveProvider(provider)
      setError(null)

      try {
        switch (provider) {
          case AuthProvider.WALLET:
            await loginWithWallet()
            break
          case AuthProvider.FARCASTER:
            await loginWithFarcaster()
            break
          default:
            // For OAuth providers, the SDK handles redirection
            await loginWithWallet() // Placeholder - should use OAuth flow
        }
        onSuccess?.()
        setShowModal(false)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setError(error.message)
        onError?.(error)
      } finally {
        setActiveProvider(null)
      }
    },
    [loginWithWallet, loginWithFarcaster, onSuccess, onError],
  )

  const handleLogout = useCallback(async () => {
    await logout()
    setShowDropdown(false)
  }, [logout])

  // Connected state - show address with dropdown
  if (authenticated && walletAddress) {
    const displayAddress = showFullAddress
      ? walletAddress
      : truncateAddress(walletAddress)

    return (
      <div className="relative" style={style}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setShowDropdown(!showDropdown)
          }}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all duration-200 ${className}`}
          style={{
            backgroundColor: 'var(--bg-secondary, #1f2937)',
            color: 'var(--text-primary, #f9fafb)',
            border: '1px solid var(--border, #374151)',
          }}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: '#22c55e' }}
          />
          <span className="text-sm font-mono">{displayAddress}</span>
          <span className="text-xs opacity-70">▼</span>
        </button>

        {showDropdown && (
          <div
            className="absolute right-0 top-full mt-2 w-48 rounded-xl border shadow-lg z-50 overflow-hidden"
            style={{
              backgroundColor: 'var(--surface, #1f2937)',
              borderColor: 'var(--border, #374151)',
            }}
          >
            <div
              className="px-4 py-3 text-xs font-mono border-b"
              style={{ borderColor: 'var(--border, #374151)' }}
            >
              <div
                className="text-[10px] uppercase tracking-wide mb-1"
                style={{ color: 'var(--text-secondary, #9ca3af)' }}
              >
                Connected
              </div>
              <div className="break-all">{walletAddress}</div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left"
              style={{ color: '#ef4444' }}
            >
              <span>🚪</span>
              <span className="font-medium">Disconnect</span>
            </button>
          </div>
        )}
      </div>
    )
  }

  // Disconnected state - show connect button
  const buttonContent =
    variant === 'icon' ? '🔐' : loading ? 'Connecting...' : connectLabel

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        disabled={loading}
        className={`px-4 py-2 rounded-xl font-medium transition-all ${className}`}
        style={{
          backgroundColor: 'var(--color-primary, #4F46E5)',
          color: 'white',
          opacity: loading ? 0.7 : 1,
          cursor: loading ? 'not-allowed' : 'pointer',
          ...style,
        }}
      >
        {buttonContent}
      </button>

      {/* Auth Modal */}
      {showModal &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            <button
              type="button"
              className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
              onClick={() => setShowModal(false)}
              aria-label="Close modal"
            />

            <div
              className="relative w-full max-w-md mx-4 rounded-2xl border shadow-2xl overflow-hidden"
              style={{
                backgroundColor: 'var(--surface, #111827)',
                borderColor: 'var(--border, #374151)',
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between p-6 border-b"
                style={{ borderColor: 'var(--border, #374151)' }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{appIcon}</span>
                  <div>
                    <h2 className="text-lg font-semibold">Sign In</h2>
                    <p
                      className="text-sm"
                      style={{ color: 'var(--text-secondary, #9ca3af)' }}
                    >
                      to {appName}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="p-2 rounded-lg transition-colors"
                  style={{ backgroundColor: 'var(--bg-secondary, #1f2937)' }}
                >
                  ✕
                </button>
              </div>

              {/* Error */}
              {error && (
                <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                  {error}
                </div>
              )}

              {/* Provider Options */}
              <div className="p-6 space-y-3">
                {/* Wallet - Primary */}
                {providers.includes(AuthProvider.WALLET) && (
                  <button
                    type="button"
                    onClick={() => handleLogin(AuthProvider.WALLET)}
                    disabled={activeProvider !== null}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${PROVIDER_CONFIG[AuthProvider.WALLET].color}`}
                    style={{ borderColor: 'var(--border, #374151)' }}
                  >
                    <span className="text-2xl">🦊</span>
                    <div className="flex-1 text-left">
                      <p className="font-medium">Wallet</p>
                      <p
                        className="text-xs"
                        style={{ color: 'var(--text-secondary, #9ca3af)' }}
                      >
                        MetaMask, Coinbase, or other
                      </p>
                    </div>
                    {activeProvider === AuthProvider.WALLET && <Spinner />}
                  </button>
                )}

                {/* Farcaster */}
                {providers.includes(AuthProvider.FARCASTER) && (
                  <button
                    type="button"
                    onClick={() => handleLogin(AuthProvider.FARCASTER)}
                    disabled={activeProvider !== null}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all ${PROVIDER_CONFIG[AuthProvider.FARCASTER].color}`}
                    style={{ borderColor: 'var(--border, #374151)' }}
                  >
                    <div className="w-8 h-8 rounded-lg bg-purple-600 flex items-center justify-center">
                      <span className="text-white font-bold text-sm">FC</span>
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium">Farcaster</p>
                      <p
                        className="text-xs"
                        style={{ color: 'var(--text-secondary, #9ca3af)' }}
                      >
                        Sign in with Warpcast
                      </p>
                    </div>
                    {activeProvider === AuthProvider.FARCASTER && <Spinner />}
                  </button>
                )}

                {/* Social Providers Grid */}
                {providers.some(
                  (p) =>
                    p === AuthProvider.GOOGLE ||
                    p === AuthProvider.GITHUB ||
                    p === AuthProvider.TWITTER ||
                    p === AuthProvider.DISCORD,
                ) && (
                  <div className="grid grid-cols-4 gap-2 pt-2">
                    {(
                      [
                        AuthProvider.GOOGLE,
                        AuthProvider.GITHUB,
                        AuthProvider.TWITTER,
                        AuthProvider.DISCORD,
                      ] as const
                    )
                      .filter((p) => providers.includes(p))
                      .map((provider) => (
                        <button
                          key={provider}
                          type="button"
                          onClick={() => handleLogin(provider)}
                          disabled={activeProvider !== null}
                          className={`flex items-center justify-center p-3 rounded-xl border transition-all ${PROVIDER_CONFIG[provider].color}`}
                          style={{ borderColor: 'var(--border, #374151)' }}
                          title={PROVIDER_CONFIG[provider].label}
                        >
                          {activeProvider === provider ? (
                            <Spinner />
                          ) : (
                            <span className="text-xl">
                              {PROVIDER_CONFIG[provider].icon}
                            </span>
                          )}
                        </button>
                      ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-6 pb-6">
                <p
                  className="text-xs text-center"
                  style={{ color: 'var(--text-secondary, #9ca3af)' }}
                >
                  Secured by{' '}
                  <span className="text-emerald-400">Jeju Network</span> with
                  TEE-backed key management
                </p>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
