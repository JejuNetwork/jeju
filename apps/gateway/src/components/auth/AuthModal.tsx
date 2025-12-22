/**
 * AuthModal - Enhanced Authentication Modal for Gateway
 *
 * Integrates:
 * - RainbowKit wallet connections (MetaMask, WalletConnect, Coinbase, etc.)
 * - SIWE (Sign In With Ethereum)
 * - SIWF (Sign In With Farcaster)
 * - Passkeys (WebAuthn)
 * - Social logins via OAuth3
 * - Email/Phone authentication
 */

import { AuthProvider } from '@jejunetwork/oauth3'
import { useOAuth3 } from '@jejunetwork/oauth3/react'
import { isPlatformAuthenticatorAvailable } from '@jejunetwork/shared/auth/passkeys'
import {
  createSIWEMessage,
  formatSIWEMessage,
} from '@jejunetwork/shared/auth/siwe'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useMutation } from '@tanstack/react-query'
import {
  Chrome,
  Fingerprint,
  Github,
  Key,
  Loader2,
  type LucideProps,
  Mail,
  MessageCircle,
  Phone,
  Twitter,
  Wallet,
  X,
} from 'lucide-react'
import { type ComponentType, useCallback, useEffect, useState } from 'react'
import { useAccount, useDisconnect, useSignMessage } from 'wagmi'
import { CHAIN_ID, OAUTH3_AGENT_URL } from '../../config'

// Auth API functions
async function initSocialAuth(
  provider: string,
  redirectUri: string,
): Promise<{ authUrl: string; state: string }> {
  const response = await fetch(`${OAUTH3_AGENT_URL}/auth/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider,
      appId: 'gateway.apps.jeju',
      redirectUri,
    }),
  })
  if (!response.ok) throw new Error(`Failed to initialize ${provider} auth`)
  return response.json()
}

async function sendEmailCode(email: string): Promise<void> {
  const response = await fetch(`${OAUTH3_AGENT_URL}/auth/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, appId: 'gateway.apps.jeju' }),
  })
  if (!response.ok) throw new Error('Failed to send verification code')
}

async function verifyEmailCode(
  email: string,
  code: string,
): Promise<{ smartAccount?: string }> {
  const response = await fetch(`${OAUTH3_AGENT_URL}/auth/email/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, appId: 'gateway.apps.jeju' }),
  })
  if (!response.ok) throw new Error('Invalid verification code')
  return response.json()
}

async function sendPhoneCode(phone: string): Promise<void> {
  const response = await fetch(`${OAUTH3_AGENT_URL}/auth/phone/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, appId: 'gateway.apps.jeju' }),
  })
  if (!response.ok) throw new Error('Failed to send verification code')
}

async function verifyPhoneCode(
  phone: string,
  code: string,
): Promise<{ smartAccount?: string }> {
  const response = await fetch(`${OAUTH3_AGENT_URL}/auth/phone/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code, appId: 'gateway.apps.jeju' }),
  })
  if (!response.ok) throw new Error('Invalid verification code')
  return response.json()
}

// Fix for Lucide React 19 type compatibility
const XIcon = X as ComponentType<LucideProps>
const KeyIcon = Key as ComponentType<LucideProps>
const WalletIcon = Wallet as ComponentType<LucideProps>
const ChromeIcon = Chrome as ComponentType<LucideProps>
const GithubIcon = Github as ComponentType<LucideProps>
const TwitterIcon = Twitter as ComponentType<LucideProps>
const MessageCircleIcon = MessageCircle as ComponentType<LucideProps>
const FingerprintIcon = Fingerprint as ComponentType<LucideProps>
const Loader2Icon = Loader2 as ComponentType<LucideProps>
const MailIcon = Mail as ComponentType<LucideProps>
const PhoneIcon = Phone as ComponentType<LucideProps>

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (session: AuthSession) => void
}

interface AuthSession {
  address: string
  method: 'siwe' | 'siwf' | 'passkey' | 'social'
  expiresAt: number
  provider?: string
}

type AuthStep =
  | 'choose'
  | 'wallet'
  | 'signing'
  | 'email'
  | 'phone'
  | 'success'
  | 'error'

const SESSION_KEY = 'gateway_auth_session'

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [step, setStep] = useState<AuthStep>('choose')
  const [hasPasskeys, setHasPasskeys] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [phoneInput, setPhoneInput] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [siweError, setSiweError] = useState<string | null>(null)
  const [farcasterLoading, setFarcasterLoading] = useState(false)
  const [farcasterError, setFarcasterError] = useState<string | null>(null)

  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { disconnect: _disconnect } = useDisconnect()
  const { openConnectModal } = useConnectModal()

  // OAuth3 integration
  const oauth3Context = useOAuth3()

  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setHasPasskeys)
  }, [])

  // Auth mutations
  const socialAuthMutation = useMutation({
    mutationFn: ({
      provider,
      redirectUri,
    }: {
      provider: string
      redirectUri: string
    }) => initSocialAuth(provider, redirectUri),
    onSuccess: ({ authUrl, state }, { provider }) => {
      sessionStorage.setItem('oauth3_state', state)
      sessionStorage.setItem('oauth3_provider', provider)
      window.location.href = authUrl
    },
  })

  const sendEmailMutation = useMutation({
    mutationFn: (email: string) => sendEmailCode(email),
    onSuccess: () => setCodeSent(true),
  })

  const verifyEmailMutation = useMutation({
    mutationFn: ({ email, code }: { email: string; code: string }) =>
      verifyEmailCode(email, code),
    onSuccess: (data, { email }) => {
      const session: AuthSession = {
        address: data.smartAccount || `email:${email}`,
        method: 'social',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        provider: 'email',
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      setStep('success')
      onSuccess?.(session)
      setTimeout(() => onClose(), 1500)
    },
  })

  const sendPhoneMutation = useMutation({
    mutationFn: (phone: string) => sendPhoneCode(phone),
    onSuccess: () => setCodeSent(true),
  })

  const verifyPhoneMutation = useMutation({
    mutationFn: ({ phone, code }: { phone: string; code: string }) =>
      verifyPhoneCode(phone, code),
    onSuccess: (data, { phone }) => {
      const session: AuthSession = {
        address: data.smartAccount || `phone:${phone}`,
        method: 'social',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        provider: 'phone',
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      setStep('success')
      onSuccess?.(session)
      setTimeout(() => onClose(), 1500)
    },
  })

  // Aggregate loading/error states (passkeyMutation added after its definition)
  const isLoading =
    socialAuthMutation.isPending ||
    sendEmailMutation.isPending ||
    verifyEmailMutation.isPending ||
    sendPhoneMutation.isPending ||
    verifyPhoneMutation.isPending

  // Error state aggregated from all mutations (passkeyMutation error added after its definition)
  const mutationError =
    socialAuthMutation.error?.message ??
    sendEmailMutation.error?.message ??
    verifyEmailMutation.error?.message ??
    sendPhoneMutation.error?.message ??
    verifyPhoneMutation.error?.message ??
    null

  const handleSIWE = useCallback(async () => {
    if (!address) return

    setStep('signing')
    setSiweError(null)

    const message = createSIWEMessage({
      domain: window.location.host,
      address,
      uri: window.location.origin,
      chainId: CHAIN_ID,
      statement: 'Sign in to Gateway Portal',
      expirationMinutes: 60 * 24,
    })

    const messageString = formatSIWEMessage(message)
    const result = await signMessageAsync({ message: messageString }).catch(
      (err: Error) => {
        setSiweError(err.message)
        setStep('error')
        return null
      },
    )

    if (!result) return

    const session: AuthSession = {
      address,
      method: 'siwe',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    setStep('success')
    onSuccess?.(session)

    setTimeout(() => onClose(), 1500)
  }, [address, signMessageAsync, onSuccess, onClose])

  // Handle SIWE after wallet connects
  useEffect(() => {
    if (isConnected && address && step === 'wallet') {
      handleSIWE()
    }
  }, [isConnected, address, step, handleSIWE])

  const handleWalletConnect = () => {
    setStep('wallet')
    if (openConnectModal) {
      openConnectModal()
    }
  }

  const handleFarcaster = async () => {
    setFarcasterLoading(true)
    setFarcasterError(null)

    // Use OAuth3 SDK if available
    if (oauth3Context?.login) {
      await oauth3Context.login(AuthProvider.FARCASTER)
      const session: AuthSession = {
        address: 'oauth3-farcaster',
        method: 'siwf',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        provider: 'farcaster',
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      setStep('success')
      onSuccess?.(session)
      setFarcasterLoading(false)
      setTimeout(() => onClose(), 1500)
      return
    }

    // Fallback to direct API call
    const redirectUri = `${window.location.origin}/auth/callback`
    const result = await initSocialAuth('farcaster', redirectUri).catch(
      (err: Error) => {
        setFarcasterError(err.message)
        setFarcasterLoading(false)
        return null
      },
    )

    if (!result) return

    sessionStorage.setItem('oauth3_state', result.state)
    sessionStorage.setItem('oauth3_provider', 'farcaster')
    window.location.href = result.authUrl
  }

  const handleSocial = async (
    provider: 'google' | 'github' | 'twitter' | 'discord',
  ) => {
    // Use OAuth3 SDK if available
    if (oauth3Context?.login) {
      const providerMap: Record<string, AuthProvider> = {
        google: AuthProvider.GOOGLE,
        github: AuthProvider.GITHUB,
        twitter: AuthProvider.TWITTER,
        discord: AuthProvider.DISCORD,
      }
      await oauth3Context.login(providerMap[provider])
      const session: AuthSession = {
        address: `oauth3-${provider}`,
        method: 'social',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        provider,
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      setStep('success')
      onSuccess?.(session)
      setTimeout(() => onClose(), 1500)
      return
    }

    // Fallback to direct API call via mutation
    const redirectUri = `${window.location.origin}/auth/callback`
    socialAuthMutation.mutate({ provider, redirectUri })
  }

  const handleEmail = () => {
    setStep('email')
    setCodeSent(false)
    setCodeInput('')
  }

  const handlePhone = () => {
    setStep('phone')
    setCodeSent(false)
    setCodeInput('')
  }

  const handleSendEmailCode = () => {
    sendEmailMutation.mutate(emailInput)
  }

  const handleVerifyEmailCode = () => {
    verifyEmailMutation.mutate({ email: emailInput, code: codeInput })
  }

  const handleSendPhoneCode = () => {
    sendPhoneMutation.mutate(phoneInput)
  }

  const handleVerifyPhoneCode = () => {
    verifyPhoneMutation.mutate({ phone: phoneInput, code: codeInput })
  }

  // Passkey mutation
  const passkeyMutation = useMutation({
    mutationFn: async () => {
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: window.location.hostname,
          userVerification: 'preferred',
          timeout: 60000,
        },
      })
      if (!credential) throw new Error('Passkey authentication cancelled')
      return credential
    },
    onSuccess: (credential) => {
      const session: AuthSession = {
        address: `passkey:${credential.id.slice(0, 20)}`,
        method: 'passkey',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
      onSuccess?.(session)
      onClose()
    },
  })

  const handlePasskey = () => {
    passkeyMutation.mutate()
  }

  // Include passkey, farcaster, SIWE in loading/error states
  const isLoadingAny =
    isLoading || passkeyMutation.isPending || farcasterLoading
  const error =
    mutationError ??
    passkeyMutation.error?.message ??
    siweError ??
    farcasterError ??
    null

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onClose()
          }
        }}
        role="presentation"
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <KeyIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Sign In</h2>
              <p className="text-sm text-muted-foreground">to Gateway Portal</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
          >
            <XIcon className="w-5 h-5" />
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
          {step === 'choose' && (
            <>
              {/* Wallet Section */}
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Wallet (SIWE)
                </span>
                <button
                  type="button"
                  onClick={handleWalletConnect}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-secondary/50 border border-border hover:bg-secondary hover:border-violet-500/30 transition-all group"
                >
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center">
                    <WalletIcon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium">Connect Wallet</p>
                    <p className="text-xs text-muted-foreground">
                      MetaMask, WalletConnect, Coinbase...
                    </p>
                  </div>
                </button>
              </div>

              {/* Farcaster */}
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Farcaster (SIWF)
                </span>
                <button
                  type="button"
                  onClick={handleFarcaster}
                  disabled={isLoadingAny}
                  className="w-full flex items-center gap-4 p-4 rounded-xl bg-secondary/50 border border-border hover:bg-purple-500/10 hover:border-purple-500/30 transition-all"
                >
                  <div className="w-10 h-10 rounded-xl bg-purple-600 flex items-center justify-center">
                    <span className="text-white font-bold text-sm">FC</span>
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-medium">Farcaster</p>
                    <p className="text-xs text-muted-foreground">
                      Sign in with Warpcast
                    </p>
                  </div>
                  {isLoadingAny && (
                    <Loader2Icon className="w-5 h-5 animate-spin" />
                  )}
                </button>
              </div>

              {/* Social Logins */}
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Social (OAuth3)
                </span>
                <div className="grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => handleSocial('google')}
                    disabled={isLoadingAny}
                    className="flex items-center justify-center p-3 rounded-xl bg-secondary/50 border border-border hover:bg-red-500/10 hover:border-red-500/30 transition-all"
                    title="Google"
                  >
                    <ChromeIcon className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocial('github')}
                    disabled={isLoadingAny}
                    className="flex items-center justify-center p-3 rounded-xl bg-secondary/50 border border-border hover:bg-gray-500/10 hover:border-gray-500/30 transition-all"
                    title="GitHub"
                  >
                    <GithubIcon className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocial('twitter')}
                    disabled={isLoadingAny}
                    className="flex items-center justify-center p-3 rounded-xl bg-secondary/50 border border-border hover:bg-blue-500/10 hover:border-blue-500/30 transition-all"
                    title="Twitter"
                  >
                    <TwitterIcon className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSocial('discord')}
                    disabled={isLoadingAny}
                    className="flex items-center justify-center p-3 rounded-xl bg-secondary/50 border border-border hover:bg-indigo-500/10 hover:border-indigo-500/30 transition-all"
                    title="Discord"
                  >
                    <MessageCircleIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Email/Phone */}
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Email / Phone
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleEmail}
                    disabled={isLoadingAny}
                    className="flex items-center justify-center gap-2 p-3 rounded-xl bg-secondary/50 border border-border hover:bg-blue-500/10 hover:border-blue-500/30 transition-all"
                  >
                    <MailIcon className="w-5 h-5" />
                    <span className="text-sm">Email</span>
                  </button>
                  <button
                    type="button"
                    onClick={handlePhone}
                    disabled={isLoadingAny}
                    className="flex items-center justify-center gap-2 p-3 rounded-xl bg-secondary/50 border border-border hover:bg-green-500/10 hover:border-green-500/30 transition-all"
                  >
                    <PhoneIcon className="w-5 h-5" />
                    <span className="text-sm">Phone</span>
                  </button>
                </div>
              </div>

              {/* Passkeys */}
              {hasPasskeys && (
                <div className="space-y-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Passkey (WebAuthn)
                  </span>
                  <button
                    type="button"
                    onClick={handlePasskey}
                    disabled={isLoadingAny}
                    className="w-full flex items-center gap-4 p-4 rounded-xl bg-secondary/50 border border-border hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-all"
                  >
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center">
                      <FingerprintIcon className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="font-medium">Passkey</p>
                      <p className="text-xs text-muted-foreground">
                        Touch ID, Face ID, or security key
                      </p>
                    </div>
                    {isLoadingAny && (
                      <Loader2Icon className="w-5 h-5 animate-spin" />
                    )}
                  </button>
                </div>
              )}
            </>
          )}

          {step === 'email' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setStep('choose')
                  setCodeSent(false)
                }}
                className="text-sm text-violet-400 hover:underline"
              >
                ← Back to options
              </button>

              <div className="space-y-2">
                <label htmlFor="email-input" className="text-sm font-medium">
                  Email Address
                </label>
                <input
                  id="email-input"
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full p-3 rounded-xl bg-secondary border border-border focus:border-violet-500 focus:outline-none transition-colors"
                  disabled={codeSent}
                />
              </div>

              {!codeSent ? (
                <button
                  type="button"
                  onClick={handleSendEmailCode}
                  disabled={isLoadingAny || !emailInput}
                  className="w-full p-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium transition-colors disabled:opacity-50"
                >
                  {isLoadingAny ? (
                    <Loader2Icon className="w-5 h-5 animate-spin mx-auto" />
                  ) : (
                    'Send Code'
                  )}
                </button>
              ) : (
                <>
                  <div className="space-y-2">
                    <label
                      htmlFor="email-code-input"
                      className="text-sm font-medium"
                    >
                      Verification Code
                    </label>
                    <input
                      id="email-code-input"
                      type="text"
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value)}
                      placeholder="123456"
                      maxLength={6}
                      className="w-full p-3 rounded-xl bg-secondary border border-border focus:border-violet-500 focus:outline-none transition-colors text-center text-2xl tracking-widest"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleVerifyEmailCode}
                    disabled={isLoadingAny || codeInput.length < 6}
                    className="w-full p-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {isLoadingAny ? (
                      <Loader2Icon className="w-5 h-5 animate-spin mx-auto" />
                    ) : (
                      'Verify'
                    )}
                  </button>
                </>
              )}
            </div>
          )}

          {step === 'phone' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setStep('choose')
                  setCodeSent(false)
                }}
                className="text-sm text-violet-400 hover:underline"
              >
                ← Back to options
              </button>

              <div className="space-y-2">
                <label htmlFor="phone-input" className="text-sm font-medium">
                  Phone Number
                </label>
                <input
                  id="phone-input"
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="+1 234 567 8900"
                  className="w-full p-3 rounded-xl bg-secondary border border-border focus:border-violet-500 focus:outline-none transition-colors"
                  disabled={codeSent}
                />
              </div>

              {!codeSent ? (
                <button
                  type="button"
                  onClick={handleSendPhoneCode}
                  disabled={isLoadingAny || !phoneInput}
                  className="w-full p-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium transition-colors disabled:opacity-50"
                >
                  {isLoadingAny ? (
                    <Loader2Icon className="w-5 h-5 animate-spin mx-auto" />
                  ) : (
                    'Send Code'
                  )}
                </button>
              ) : (
                <>
                  <div className="space-y-2">
                    <label
                      htmlFor="phone-code-input"
                      className="text-sm font-medium"
                    >
                      Verification Code
                    </label>
                    <input
                      id="phone-code-input"
                      type="text"
                      value={codeInput}
                      onChange={(e) => setCodeInput(e.target.value)}
                      placeholder="123456"
                      maxLength={6}
                      className="w-full p-3 rounded-xl bg-secondary border border-border focus:border-violet-500 focus:outline-none transition-colors text-center text-2xl tracking-widest"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleVerifyPhoneCode}
                    disabled={isLoadingAny || codeInput.length < 6}
                    className="w-full p-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium transition-colors disabled:opacity-50"
                  >
                    {isLoadingAny ? (
                      <Loader2Icon className="w-5 h-5 animate-spin mx-auto" />
                    ) : (
                      'Verify'
                    )}
                  </button>
                </>
              )}
            </div>
          )}

          {step === 'wallet' && (
            <div className="text-center py-8">
              <Loader2Icon className="w-12 h-12 animate-spin mx-auto text-violet-500" />
              <p className="mt-4 text-muted-foreground">Connecting wallet...</p>
              <p className="text-xs text-muted-foreground mt-2">
                Please check your wallet
              </p>
            </div>
          )}

          {step === 'signing' && (
            <div className="text-center py-8">
              <Loader2Icon className="w-12 h-12 animate-spin mx-auto text-violet-500" />
              <p className="mt-4 text-muted-foreground">Signing message...</p>
              <p className="text-xs text-muted-foreground mt-2">
                Please sign the message in your wallet
              </p>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto">
                <span className="text-3xl">✓</span>
              </div>
              <p className="mt-4 font-semibold text-emerald-400">
                Successfully signed in!
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Redirecting...
              </p>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto">
                <XIcon className="w-8 h-8 text-red-400" />
              </div>
              <p className="mt-4 font-semibold text-red-400">Sign in failed</p>
              <button
                type="button"
                onClick={() => {
                  setStep('choose')
                  setSiweError(null)
                  setFarcasterError(null)
                }}
                className="mt-4 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <p className="text-xs text-center text-muted-foreground">
            By signing in, you agree to Jeju's{' '}
            <a href="/terms" className="text-violet-400 hover:underline">
              Terms
            </a>{' '}
            and{' '}
            <a href="/privacy" className="text-violet-400 hover:underline">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

export default AuthModal
