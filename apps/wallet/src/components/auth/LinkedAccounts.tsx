/**
 * LinkedAccounts - Manage Social Recovery & Connected Accounts
 *
 * Shows all linked providers and allows adding/removing them.
 * Linked accounts can be used for:
 * - Social recovery if you lose your key
 * - Quick login across devices
 * - Identity verification
 */

import {
  AlertTriangle,
  Apple,
  Check,
  Chrome,
  Github,
  Loader2,
  MessageCircle,
  Plus,
  Shield,
  Trash2,
  Twitter,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import { type AuthProvider, useAuth } from '../../hooks/useAuth'

const PROVIDER_INFO: Record<
  AuthProvider,
  {
    name: string
    icon: React.ComponentType<{ className?: string }>
    color: string
    description: string
  }
> = {
  wallet: {
    name: 'Wallet',
    icon: Wallet,
    color: 'text-orange-400',
    description: 'Ethereum wallet',
  },
  google: {
    name: 'Google',
    icon: Chrome,
    color: 'text-red-400',
    description: 'Google account',
  },
  apple: {
    name: 'Apple',
    icon: Apple,
    color: 'text-gray-400',
    description: 'Apple ID',
  },
  twitter: {
    name: 'Twitter',
    icon: Twitter,
    color: 'text-blue-400',
    description: 'Twitter/X account',
  },
  github: {
    name: 'GitHub',
    icon: Github,
    color: 'text-purple-400',
    description: 'GitHub account',
  },
  discord: {
    name: 'Discord',
    icon: MessageCircle,
    color: 'text-indigo-400',
    description: 'Discord account',
  },
  farcaster: {
    name: 'Farcaster',
    icon: MessageCircle,
    color: 'text-purple-400',
    description: 'Farcaster ID',
  },
}

export function LinkedAccounts() {
  const { session, linkProvider, unlinkProvider, isLoading } = useAuth()
  const [activeAction, setActiveAction] = useState<{
    provider: AuthProvider
    action: 'link' | 'unlink'
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!session) {
    return (
      <div className="rounded-xl bg-card border border-border p-6 text-center">
        <p className="text-muted-foreground">
          Sign in to manage linked accounts
        </p>
      </div>
    )
  }

  const linkedProviders = session.linkedProviders || []
  const linkedProviderIds = new Set(linkedProviders.map((p) => p.provider))
  const availableProviders = (
    Object.keys(PROVIDER_INFO) as AuthProvider[]
  ).filter((p) => !linkedProviderIds.has(p))

  const handleLink = async (provider: AuthProvider) => {
    setActiveAction({ provider, action: 'link' })
    setError(null)
    try {
      await linkProvider(provider)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setActiveAction(null)
    }
  }

  const handleUnlink = async (provider: AuthProvider) => {
    // Don't allow unlinking if it's the only provider
    if (linkedProviders.length <= 1) {
      setError('Cannot unlink your only recovery method')
      return
    }

    setActiveAction({ provider, action: 'unlink' })
    setError(null)
    try {
      await unlinkProvider(provider)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setActiveAction(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h3 className="font-semibold">Linked Accounts</h3>
          <p className="text-sm text-muted-foreground">
            Add social accounts for recovery & easy login
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Recovery Status */}
      <div
        className={`rounded-xl p-4 border ${
          linkedProviders.length >= 2
            ? 'bg-emerald-500/5 border-emerald-500/30'
            : 'bg-yellow-500/5 border-yellow-500/30'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {linkedProviders.length >= 2 ? (
              <Check className="w-5 h-5 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
            )}
            <div>
              <p
                className={`text-sm font-medium ${linkedProviders.length >= 2 ? 'text-emerald-400' : 'text-yellow-400'}`}
              >
                {linkedProviders.length >= 2
                  ? 'Social Recovery Enabled'
                  : 'Add Recovery Options'}
              </p>
              <p className="text-xs text-muted-foreground">
                {linkedProviders.length >= 2
                  ? `${linkedProviders.length} accounts linked for recovery`
                  : 'Link at least 2 accounts for social recovery'}
              </p>
            </div>
          </div>
          <span className="text-2xl font-bold text-muted-foreground">
            {linkedProviders.length}/3
          </span>
        </div>
      </div>

      {/* Linked Providers */}
      {linkedProviders.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Connected
          </h4>
          <div className="space-y-2">
            {linkedProviders.map((linked) => {
              const info = PROVIDER_INFO[linked.provider]
              const Icon = info.icon
              const isActive =
                activeAction?.provider === linked.provider &&
                activeAction?.action === 'unlink'

              return (
                <div
                  key={linked.provider}
                  className="flex items-center justify-between p-3 rounded-xl bg-secondary/30 border border-border"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-10 w-10 rounded-lg bg-secondary flex items-center justify-center`}
                    >
                      <Icon className={`w-5 h-5 ${info.color}`} />
                    </div>
                    <div>
                      <p className="font-medium">{info.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {linked.handle ||
                          `Connected ${new Date(linked.linkedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {linked.verified && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs">
                        Verified
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleUnlink(linked.provider)}
                      disabled={isLoading || linkedProviders.length <= 1}
                      className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={
                        linkedProviders.length <= 1
                          ? 'Cannot remove your only recovery method'
                          : 'Remove'
                      }
                    >
                      {isActive ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Available Providers */}
      {availableProviders.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Add Account
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {availableProviders.map((provider) => {
              const info = PROVIDER_INFO[provider]
              const Icon = info.icon
              const isActive =
                activeAction?.provider === provider &&
                activeAction?.action === 'link'

              return (
                <button
                  type="button"
                  key={provider}
                  onClick={() => handleLink(provider)}
                  disabled={isLoading}
                  className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30 border border-border hover:bg-secondary hover:border-emerald-500/30 transition-all group"
                >
                  <div className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center group-hover:bg-emerald-500/10">
                    <Icon className={`w-4 h-4 ${info.color}`} />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium">{info.name}</p>
                  </div>
                  {isActive ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>• Link multiple accounts for social recovery</p>
        <p>
          • If you lose your wallet key, sign in with any linked account to
          recover
        </p>
        <p>• Your linked accounts are encrypted and stored securely in TEE</p>
      </div>
    </div>
  )
}

export default LinkedAccounts
