import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'

// Window.ethereum type is provided by wagmi

interface SIWEMessage {
  domain: string
  address: `0x${string}`
  statement?: string
  uri: string
  version: string
  chainId: number
  nonce: string
  issuedAt: string
  expirationTime?: string
  notBefore?: string
  requestId?: string
  resources?: string[]
}

function generateNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  for (let i = 0; i < 16; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
}

function createSIWEMessage(params: {
  domain: string
  address: `0x${string}`
  uri: string
  chainId: number
  statement?: string
  expirationMinutes?: number
}): SIWEMessage {
  const now = new Date()
  const expirationTime = params.expirationMinutes
    ? new Date(
        now.getTime() + params.expirationMinutes * 60 * 1000,
      ).toISOString()
    : undefined

  return {
    domain: params.domain,
    address: params.address,
    statement: params.statement,
    uri: params.uri,
    version: '1',
    chainId: params.chainId,
    nonce: generateNonce(),
    issuedAt: now.toISOString(),
    expirationTime,
  }
}

function formatSIWEMessage(message: SIWEMessage): string {
  const lines: string[] = [
    `${message.domain} wants you to sign in with your Ethereum account:`,
    message.address,
    '',
  ]

  if (message.statement) {
    lines.push(message.statement)
    lines.push('')
  }

  lines.push(`URI: ${message.uri}`)
  lines.push(`Version: ${message.version}`)
  lines.push(`Chain ID: ${message.chainId}`)
  lines.push(`Nonce: ${message.nonce}`)
  lines.push(`Issued At: ${message.issuedAt}`)

  if (message.expirationTime) {
    lines.push(`Expiration Time: ${message.expirationTime}`)
  }

  return lines.join('\n')
}

async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) {
    return false
  }

  if (
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ===
    'function'
  ) {
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  }

  return false
}

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

import {
  CHAIN_ID,
  OAUTH3_AGENT_URL,
  WALLETCONNECT_PROJECT_ID,
} from '../../config'

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

  const { address, isConnected, chainId } = useAccount()
  const { connectAsync } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const { signMessageAsync } = useSignMessage()

  useState(() => {
    isPlatformAuthenticatorAvailable().then(setHasPasskeys)
  })

  // Validate connected account matches MetaMask's current account on mount/change
  // Also listen for account changes in MetaMask
  useEffect(() => {
    if (typeof window === 'undefined' || !window.ethereum) return

    const validateAccount = async () => {
      if (!isConnected || !address) return

      try {
        const accounts = (await window.ethereum.request({
          method: 'eth_accounts',
        })) as string[]

        if (accounts.length > 0) {
          const metaMaskAccount = accounts[0]?.toLowerCase()
          const connectedAccount = address.toLowerCase()

          if (metaMaskAccount && metaMaskAccount !== connectedAccount) {
            console.warn('[Auth] Account mismatch detected:', {
              connected: connectedAccount,
              metamask: metaMaskAccount,
            })
            // Auto-disconnect if accounts don't match
            await disconnectAsync()
            localStorage.removeItem('bazaar_session')
            setError(
              `Account mismatch: MetaMask shows ${metaMaskAccount.slice(0, 6)}...${metaMaskAccount.slice(-4)}, but app is connected to ${connectedAccount.slice(0, 6)}...${connectedAccount.slice(-4)}. Please reconnect.`,
            )
          }
        }
      } catch (err) {
        console.error('[Auth] Error validating account:', err)
      }
    }

    // Validate on mount and when address changes
    validateAccount()

    // Listen for account changes in MetaMask
    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        // User disconnected from MetaMask
        disconnectAsync().catch(console.error)
        localStorage.removeItem('bazaar_session')
        return
      }

      const newAccount = accounts[0]?.toLowerCase()
      const connectedAccount = address?.toLowerCase()

      if (newAccount && connectedAccount && newAccount !== connectedAccount) {
        console.log('[Auth] MetaMask account changed, disconnecting:', {
          old: connectedAccount,
          new: newAccount,
        })
        disconnectAsync().catch(console.error)
        localStorage.removeItem('bazaar_session')
        setError('Account changed in MetaMask. Please reconnect.')
      }
    }

    // Add event listener for account changes
    window.ethereum.on('accountsChanged', handleAccountsChanged)

    return () => {
      // Cleanup: remove event listener
      if (window.ethereum?.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
      }
    }
  }, [isConnected, address, disconnectAsync])

  const handleWalletConnect = async (
    connectorType: 'injected' | 'walletConnect',
  ) => {
    setIsLoading(true)
    setActiveMethod('wallet')
    setError(null)

    try {
      // For injected connector (MetaMask/Trust Wallet), explicitly request the current account
      // This ensures we get the account that's currently selected in the wallet
      let expectedAccount: string | null = null

      if (
        connectorType === 'injected' &&
        typeof window !== 'undefined' &&
        window.ethereum
      ) {
        // First, disconnect any existing connection and clear ALL caches
        try {
          await disconnectAsync()

          // Try to revoke permissions from the wallet itself
          try {
            await window.ethereum.request({
              method: 'wallet_revokePermissions',
              params: [{ eth_accounts: {} }],
            })
            console.log('[Auth] Revoked wallet permissions')
          } catch (revokeError) {
            console.log(
              '[Auth] Could not revoke permissions (wallet may not support it):',
              revokeError,
            )
          }

          // Clear wagmi's localStorage cache more aggressively
          if (typeof window !== 'undefined' && window.localStorage) {
            // Clear ALL wagmi-related storage
            const keys = Object.keys(window.localStorage)
            keys.forEach((key) => {
              if (
                key.startsWith('wagmi') ||
                key.startsWith('wc@') ||
                key.includes('connector') ||
                key.includes('wallet') ||
                key.includes('bazaar_session') ||
                key.includes('trustwallet') ||
                key.includes('metamask')
              ) {
                window.localStorage.removeItem(key)
                console.log('[Auth] Cleared localStorage key:', key)
              }
            })
          }

          // Also clear sessionStorage
          if (typeof window !== 'undefined' && window.sessionStorage) {
            const sessionKeys = Object.keys(window.sessionStorage)
            sessionKeys.forEach((key) => {
              if (
                key.includes('wagmi') ||
                key.includes('wallet') ||
                key.includes('bazaar')
              ) {
                window.sessionStorage.removeItem(key)
                console.log('[Auth] Cleared sessionStorage key:', key)
              }
            })
          }

          // Small delay to ensure disconnect and revoke complete
          await new Promise((resolve) => setTimeout(resolve, 500))
        } catch {
          // Ignore disconnect errors - might not be connected
        }

        // Check what account MetaMask is currently showing BEFORE requesting
        // This helps us detect if MetaMask auto-connects to a different account
        let metaMaskCurrentAccount: string | null = null
        try {
          // Check what MetaMask thinks is selected (without requesting)
          const currentAccounts = (await window.ethereum.request({
            method: 'eth_accounts',
          })) as string[]
          if (currentAccounts.length > 0) {
            metaMaskCurrentAccount = currentAccounts[0]?.toLowerCase()
            console.log(
              '[Auth] MetaMask eth_accounts (before request):',
              metaMaskCurrentAccount,
            )
          }
        } catch {
          // Ignore - might not have any accounts yet
        }

        // IMPORTANT: Request accounts - this should show the wallet's connection popup
        // But wallets often auto-approve if there's a cached connection
        console.log('[Auth] Requesting accounts from wallet...')
        console.log(
          '[Auth] MetaMask is currently showing:',
          metaMaskCurrentAccount || 'no account',
        )

        const accounts = (await window.ethereum.request({
          method: 'eth_requestAccounts',
        })) as string[]

        if (!accounts || accounts.length === 0) {
          throw new Error(
            'No accounts found. Please unlock your wallet and try again.',
          )
        }

        // Store the account that the wallet returned
        expectedAccount = accounts[0]?.toLowerCase()
        console.log('[Auth] Wallet returned account:', expectedAccount)
        console.log('[Auth] Full address:', expectedAccount)

        if (!expectedAccount) {
          throw new Error('Failed to get account from wallet')
        }

        // Check what account MetaMask is showing AFTER requesting (should be the same)
        let currentSelectedAccount: string | null = null
        try {
          const selectedAccounts = (await window.ethereum.request({
            method: 'eth_accounts',
          })) as string[]
          if (selectedAccounts.length > 0) {
            currentSelectedAccount = selectedAccounts[0]?.toLowerCase()
            console.log(
              '[Auth] MetaMask eth_accounts (after request):',
              currentSelectedAccount,
            )
          }
        } catch {
          // Ignore - might not have any accounts yet
        }

        // Log comparison for debugging
        console.log('[Auth] Account comparison:', {
          beforeRequest: metaMaskCurrentAccount,
          walletReturned: expectedAccount,
          afterRequest: currentSelectedAccount,
        })

        // If MetaMask was showing Account #6 before request but wallet returned different account,
        // that means MetaMask auto-approved the cached connection
        if (
          metaMaskCurrentAccount &&
          metaMaskCurrentAccount !== expectedAccount
        ) {
          console.warn(
            '[Auth] MetaMask was showing different account before request:',
            {
              wasShowing: metaMaskCurrentAccount,
              returned: expectedAccount,
            },
          )

          const errorMessage = `❌ Wrong Account Auto-Connected

MetaMask was showing: ${metaMaskCurrentAccount.slice(0, 6)}...${metaMaskCurrentAccount.slice(-4)}
But wallet auto-connected to: ${expectedAccount.slice(0, 6)}...${expectedAccount.slice(-4)}

🔧 MetaMask auto-approved a cached connection. To fix:

**Option 1: Reset MetaMask Account Connections**
1. In MetaMask: Settings → Advanced → Reset Account
2. This clears ALL site connections (you'll need to reconnect to all sites)
3. Refresh this page
4. Switch to Account #6 in MetaMask
5. Click Connect - MetaMask should now show the account selection dialog

**Option 2: Use Incognito/Private Mode**
1. Open this site in an incognito/private window
2. MetaMask won't have cached connections
3. Switch to Account #6
4. Connect

**Option 3: Clear Browser Data**
1. Close ALL tabs with localhost:4006
2. Clear browser cookies/cache for localhost
3. Restart browser
4. Switch to Account #6
5. Connect`

          setError(errorMessage)
          setIsLoading(false)
          setActiveMethod(null)
          return
        }

        // Verify the account matches what MetaMask is showing
        // This ensures we're using the account the user actually selected, not a cached one
        if (
          currentSelectedAccount &&
          currentSelectedAccount !== expectedAccount
        ) {
          console.error('[Auth] Account mismatch detected:', {
            metamaskShowing: currentSelectedAccount,
            walletReturned: expectedAccount,
          })

          const errorMessage = `❌ Account Mismatch Detected

MetaMask is showing: ${currentSelectedAccount.slice(0, 6)}...${currentSelectedAccount.slice(-4)}
But wallet returned: ${expectedAccount.slice(0, 6)}...${expectedAccount.slice(-4)}

🔧 The wallet is auto-connecting to a cached account. Try:
1. In MetaMask: Settings → Advanced → Reset Account
2. Refresh this page
3. Switch to Account #6 BEFORE clicking Connect
4. Try connecting again`

          setError(errorMessage)
          setIsLoading(false)
          setActiveMethod(null)
          return
        }

        // Account is valid - proceed with connection
        console.log(
          '[Auth] Account validated, proceeding with connection:',
          expectedAccount,
        )
      }

      const connector =
        connectorType === 'injected'
          ? injected()
          : walletConnect({ projectId: WALLETCONNECT_PROJECT_ID })

      // Now connect with wagmi
      const result = await connectAsync({ connector })
      const walletAddress = result.accounts[0]?.toLowerCase()

      if (!walletAddress) {
        throw new Error('Failed to get wallet address from connection')
      }

      // Verify the connected account matches what the wallet is showing
      if (connectorType === 'injected' && expectedAccount) {
        if (walletAddress !== expectedAccount) {
          console.error('[Auth] Account mismatch:', {
            connected: walletAddress,
            wallet: expectedAccount,
          })
          // Force disconnect and show error
          await disconnectAsync()
          throw new Error(
            `Account mismatch: Wallet shows ${expectedAccount.slice(0, 6)}...${expectedAccount.slice(-4)}, but connected to ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}. Please select the correct account in your wallet and try again.`,
          )
        }
      }

      console.log('[Auth] Connected account:', walletAddress)

      // Get the actual chain ID from the connection result or use the configured one
      // This ensures the SIWE message matches MetaMask's connected chain
      const connectedChainId = result.chainId ?? chainId ?? CHAIN_ID

      const message = createSIWEMessage({
        domain: window.location.host,
        address: walletAddress as `0x${string}`,
        uri: window.location.origin,
        chainId: connectedChainId,
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
      const redirectUri = `${window.location.origin}/auth/callback`

      const response = await fetch(`${OAUTH3_AGENT_URL}/auth/init`, {
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
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: window.location.hostname,
          userVerification: 'preferred',
          timeout: 60000,
        },
      })

      if (!credential) throw new Error('Passkey authentication cancelled')

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
      const redirectUri = `${window.location.origin}/auth/callback`

      const response = await fetch(`${OAUTH3_AGENT_URL}/auth/init`, {
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
    try {
      await disconnectAsync()
      localStorage.removeItem('bazaar_session')
      // Clear wagmi's connection cache by reloading the page
      // This ensures a fresh connection on next login
      window.location.reload()
    } catch (err) {
      console.error('Disconnect error:', err)
      // Still clear localStorage and reload even if disconnect fails
      localStorage.removeItem('bazaar_session')
      window.location.reload()
    }
  }

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

      {/* Auth Modal - rendered via portal to escape header stacking context */}
      {showModal &&
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
                  <a
                    href="/privacy"
                    className="text-emerald-400 hover:underline"
                  >
                    Privacy Policy
                  </a>
                </p>
              </div>
            </div>
          </div>,
          document.body,
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
