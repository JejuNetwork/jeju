'use client'

/**
 * AuthButton - Universal Authentication Button
 *
 * Provides a single button for all authentication methods:
 * - Wallet (MetaMask, WalletConnect, etc.) with SIWE
 * - Farcaster (SIWF)
 * - Passkeys (WebAuthn)
 * - Social (Google, Apple, Twitter, GitHub, Discord)
 */

import { isPlatformAuthenticatorAvailable } from '@jejunetwork/shared/auth/passkeys'
import {
  createSIWEMessage,
  formatSIWEMessage,
} from '@jejunetwork/shared/auth/siwe'
import { useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'

interface AuthButtonProps {
  onAuthSuccess?: (session: AuthSession) => void
  onAuthError?: (error: Error) => void
  className?: string
  variant?: 'default' | 'compact' | 'icon'
}

interface AuthSession {
  address: string
  method: 'siwe' | 'siwf' | 'passkey' | 'social'
  expiresAt: number
}

type AuthMethod =
  | 'wallet'
  | 'farcaster'
  | 'passkey'
  | 'google'
  | 'github'
  | 'twitter'
  | 'discord'

import { WALLETCONNECT_PROJECT_ID } from '../../config'

export function AuthButton({
  onAuthSuccess,
  onAuthError,
  className = '',
  variant = 'default',
}: AuthButtonProps) {
  const [showModal, setShowModal] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [activeMethod, setActiveMethod] = useState<AuthMethod | null>(null)
  const [hasPasskeys, setHasPasskeys] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { address, isConnected } = useAccount()
  const { connectAsync } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const { signMessageAsync } = useSignMessage()

  // Check passkey availability
  useState(() => {
    isPlatformAuthenticatorAvailable().then(setHasPasskeys)
  })

  const handleWalletConnect = async (
    connectorType: 'injected' | 'walletConnect',
  ) => {
    setIsLoading(true)
    setActiveMethod('wallet')
    setError(null)

    try {
      const connector =
        connectorType === 'injected'
          ? injected()
          : walletConnect({ projectId: WALLETCONNECT_PROJECT_ID })

      const result = await connectAsync({ connector })
      const walletAddress = result.accounts[0]

      // Create and sign SIWE message
      const chainId = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '420691', 10)
      const message = createSIWEMessage({
        domain: window.location.host,
        address: walletAddress as `0x${string}`,
        uri: window.location.origin,
        chainId,
        statement: 'Sign in to Bazaar',
        expirationMinutes: 60 * 24,
      })

      const messageString = formatSIWEMessage(message)
      await signMessageAsync({ message: messageString })

      const session: AuthSession = {
        address: walletAddress,
        method: 'siwe',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }

      onAuthSuccess?.(session)
      setShowModal(false)
    } catch (err) {
      const error = err as Error
      setError(error.message)
      onAuthError?.(error)
    } finally {
      setIsLoading(false)
      setActiveMethod(null)
    }
  }

  const handleFarcasterConnect = async () => {
    setIsLoading(true)
    setActiveMethod('farcaster')
    setError(null)

    try {
      // Redirect to Farcaster auth flow via OAuth3
      const oauth3Url =
        process.env.NEXT_PUBLIC_OAUTH3_AGENT_URL || 'http://localhost:4200'
      const redirectUri = `${window.location.origin}/auth/callback`

      const response = await fetch(`${oauth3Url}/auth/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'farcaster',
          appId: 'bazaar.apps.jeju',
          redirectUri,
        }),
      })

      if (!response.ok) throw new Error('Failed to initialize Farcaster auth')

      const { authUrl, state } = await response.json()
      sessionStorage.setItem('oauth3_state', state)
      window.location.href = authUrl
    } catch (err) {
      const error = err as Error
      setError(error.message)
      onAuthError?.(error)
      setIsLoading(false)
      setActiveMethod(null)
    }
  }

  const handlePasskeyConnect = async () => {
    setIsLoading(true)
    setActiveMethod('passkey')
    setError(null)

    try {
      // WebAuthn authentication
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: window.location.hostname,
          userVerification: 'preferred',
          timeout: 60000,
        },
      })

      if (!credential) throw new Error('Passkey authentication cancelled')

      // Create session from passkey
      const session: AuthSession = {
        address: `passkey:${credential.id.slice(0, 20)}`,
        method: 'passkey',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }

      onAuthSuccess?.(session)
      setShowModal(false)
    } catch (err) {
      const error = err as Error
      setError(error.message)
      onAuthError?.(error)
    } finally {
      setIsLoading(false)
      setActiveMethod(null)
    }
  }

  const handleSocialConnect = async (
    provider: 'google' | 'github' | 'twitter' | 'discord',
  ) => {
    setIsLoading(true)
    setActiveMethod(provider)
    setError(null)

    try {
      const oauth3Url =
        process.env.NEXT_PUBLIC_OAUTH3_AGENT_URL || 'http://localhost:4200'
      const redirectUri = `${window.location.origin}/auth/callback`

      const response = await fetch(`${oauth3Url}/auth/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          appId: 'bazaar.apps.jeju',
          redirectUri,
        }),
      })

      if (!response.ok) throw new Error(`Failed to initialize ${provider} auth`)

      const { authUrl, state } = await response.json()
      sessionStorage.setItem('oauth3_state', state)
      sessionStorage.setItem('oauth3_provider', provider)
      window.location.href = authUrl
    } catch (err) {
      const error = err as Error
      setError(error.message)
      onAuthError?.(error)
      setIsLoading(false)
      setActiveMethod(null)
    }
  }

  const handleDisconnect = async () => {
    await disconnectAsync()
    localStorage.removeItem('bazaar_session')
  }

  // Already connected - show account
  if (isConnected && address) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowModal(!showModal)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all duration-200 ${className}`}
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
          }}
        >
          <div className="w-6 h-6 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 flex items-center justify-center text-xs font-bold text-white">
            {address.slice(2, 4).toUpperCase()}
          </div>
          <span className="text-sm font-medium">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
        </button>

        {showModal && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setShowModal(false)}
              aria-label="Close dropdown"
            />
            <div
              className="absolute right-0 top-full mt-2 w-48 rounded-xl border shadow-lg z-50 overflow-hidden"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
              }}
            >
              <button
                type="button"
                onClick={handleDisconnect}
                className="w-full flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-secondary)] text-left"
              >
                <span>🚪</span>
                <span className="font-medium">Disconnect</span>
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className={`btn-primary ${className}`}
      >
        {variant === 'icon' ? '🔐' : 'Sign In'}
      </button>

      {/* Auth Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-default"
            onClick={() => setShowModal(false)}
            aria-label="Close modal"
          />

          <div
            className="relative w-full max-w-md mx-4 rounded-2xl border shadow-2xl overflow-hidden"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between p-6 border-b"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">🏝️</span>
                <div>
                  <h2 className="text-lg font-semibold">Sign In</h2>
                  <p
                    className="text-sm"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    to Bazaar
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-2 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
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

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Wallet Options */}
              <div className="space-y-2">
                <p
                  className="text-xs font-medium uppercase tracking-wide"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Wallet
                </p>
                <button
                  type="button"
                  onClick={() => handleWalletConnect('injected')}
                  disabled={isLoading}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all hover:bg-[var(--bg-secondary)]"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span className="text-2xl">🦊</span>
                  <div className="flex-1 text-left">
                    <p className="font-medium">MetaMask</p>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Browser extension
                    </p>
                  </div>
                  {activeMethod === 'wallet' && <Spinner />}
                </button>

                {WALLETCONNECT_PROJECT_ID && (
                  <button
                    type="button"
                    onClick={() => handleWalletConnect('walletConnect')}
                    disabled={isLoading}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all hover:bg-[var(--bg-secondary)]"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="text-2xl">🔗</span>
                    <div className="flex-1 text-left">
                      <p className="font-medium">WalletConnect</p>
                      <p
                        className="text-xs"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Mobile & desktop wallets
                      </p>
                    </div>
                  </button>
                )}
              </div>

              {/* Farcaster */}
              <div className="space-y-2">
                <p
                  className="text-xs font-medium uppercase tracking-wide"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Social
                </p>
                <button
                  type="button"
                  onClick={handleFarcasterConnect}
                  disabled={isLoading}
                  className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all hover:bg-purple-500/10 hover:border-purple-500/30"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="w-8 h-8 rounded-lg bg-purple-500 flex items-center justify-center">
                    <span className="text-white font-bold text-sm">FC</span>
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium">Farcaster</p>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Sign in with Warpcast
                    </p>
                  </div>
                  {activeMethod === 'farcaster' && <Spinner />}
                </button>

                {/* Other social providers */}
                <div className="grid grid-cols-4 gap-2">
                  {(['google', 'github', 'twitter', 'discord'] as const).map(
                    (provider) => (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => handleSocialConnect(provider)}
                        disabled={isLoading}
                        className="flex items-center justify-center p-3 rounded-xl border transition-all hover:bg-[var(--bg-secondary)]"
                        style={{ borderColor: 'var(--border)' }}
                        title={
                          provider.charAt(0).toUpperCase() + provider.slice(1)
                        }
                      >
                        {activeMethod === provider ? (
                          <Spinner />
                        ) : (
                          getSocialIcon(provider)
                        )}
                      </button>
                    ),
                  )}
                </div>
              </div>

              {/* Passkey */}
              {hasPasskeys && (
                <div className="space-y-2">
                  <p
                    className="text-xs font-medium uppercase tracking-wide"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Passkey
                  </p>
                  <button
                    type="button"
                    onClick={handlePasskeyConnect}
                    disabled={isLoading}
                    className="w-full flex items-center gap-4 p-4 rounded-xl border transition-all hover:bg-emerald-500/10 hover:border-emerald-500/30"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="text-2xl">🔐</span>
                    <div className="flex-1 text-left">
                      <p className="font-medium">Passkey</p>
                      <p
                        className="text-xs"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        Face ID, Touch ID, or security key
                      </p>
                    </div>
                    {activeMethod === 'passkey' && <Spinner />}
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 pb-6">
              <p
                className="text-xs text-center"
                style={{ color: 'var(--text-secondary)' }}
              >
                By signing in, you agree to Jeju's{' '}
                <a href="/terms" className="text-emerald-400 hover:underline">
                  Terms
                </a>{' '}
                and{' '}
                <a href="/privacy" className="text-emerald-400 hover:underline">
                  Privacy Policy
                </a>
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
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

function getSocialIcon(provider: string): string {
  switch (provider) {
    case 'google':
      return '🔴'
    case 'github':
      return '⚫'
    case 'twitter':
      return '🐦'
    case 'discord':
      return '💬'
    default:
      return '🔗'
  }
}

export default AuthButton
