/**
 * Farcaster Connect Component
 *
 * Onboarding flow for connecting Farcaster to Factory.
 */

import { clsx } from 'clsx'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Key,
  Loader2,
  User,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import {
  useActivateSigner,
  useFarcasterStatus,
  useLookupFid,
  useOnboardingStatus,
  useQuickConnect,
} from '../../hooks/useFarcaster'

interface FarcasterConnectProps {
  onComplete?: () => void
  compact?: boolean
}

export function FarcasterConnect({
  onComplete,
  compact,
}: FarcasterConnectProps) {
  const { address, isConnected: walletConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { data: farcasterStatus, isLoading: statusLoading } =
    useFarcasterStatus()
  const { data: onboarding, isLoading: onboardingLoading } =
    useOnboardingStatus()
  const { data: lookup, isLoading: lookupLoading } = useLookupFid(address)

  const quickConnect = useQuickConnect()
  const activateSigner = useActivateSigner()

  const [step, setStep] = useState<'lookup' | 'connect' | 'sign' | 'done'>(
    'lookup',
  )
  const [error, setError] = useState<string | null>(null)
  const [pendingSignature, setPendingSignature] = useState<{
    message: string
    publicKey: string
  } | null>(null)

  // Determine current state
  useEffect(() => {
    if (farcasterStatus?.connected) {
      setStep('done')
    } else if (
      onboarding?.steps.linkFid.complete &&
      !onboarding.steps.activateSigner.complete
    ) {
      setStep('sign')
    } else if (lookup?.found) {
      setStep('connect')
    } else {
      setStep('lookup')
    }
  }, [farcasterStatus, onboarding, lookup])

  // Call onComplete when done
  useEffect(() => {
    if (step === 'done' && farcasterStatus?.connected) {
      onComplete?.()
    }
  }, [step, farcasterStatus?.connected, onComplete])

  const handleConnect = useCallback(async () => {
    if (!lookup?.found || !lookup.fid) return

    setError(null)
    const result = await quickConnect.mutateAsync(lookup.fid)

    if (result.registrationRequired && result.registration) {
      setPendingSignature({
        message: result.registration.message,
        publicKey: result.registration.signerPublicKey,
      })
      setStep('sign')
    } else if (!result.registrationRequired) {
      setStep('done')
    }
  }, [lookup, quickConnect])

  const handleSign = useCallback(async () => {
    if (!pendingSignature) return

    setError(null)
    const signature = await signMessageAsync({
      message: pendingSignature.message,
    })

    await activateSigner.mutateAsync({
      signerPublicKey: pendingSignature.publicKey,
      signature,
    })

    setPendingSignature(null)
    setStep('done')
  }, [pendingSignature, signMessageAsync, activateSigner])

  const isLoading = statusLoading || onboardingLoading || lookupLoading

  // If already connected, show status
  if (step === 'done' && farcasterStatus?.connected) {
    if (compact) {
      return (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-success-500/10 border border-success-500/20">
          <CheckCircle2
            className="w-5 h-5 text-success-400"
            aria-hidden="true"
          />
          <p className="text-sm font-medium text-surface-100">
            Connected as @{farcasterStatus.username}
          </p>
        </div>
      )
    }

    return (
      <div className="card p-6">
        <div className="flex items-center gap-4">
          {farcasterStatus.pfpUrl ? (
            <img
              src={farcasterStatus.pfpUrl}
              alt={farcasterStatus.username ?? ''}
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-surface-700 flex items-center justify-center text-surface-400 text-xl">
              {farcasterStatus.username?.slice(0, 2).toUpperCase() ?? '?'}
            </div>
          )}
          <div>
            <p className="font-semibold text-surface-100 text-lg font-display">
              {farcasterStatus.displayName || farcasterStatus.username}
            </p>
            <p className="text-surface-400">@{farcasterStatus.username}</p>
            <div className="flex items-center gap-2 mt-2">
              <CheckCircle2
                className="w-4 h-4 text-success-400"
                aria-hidden="true"
              />
              <span className="text-sm text-success-400">
                Connected to Farcaster
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Not connected - show onboarding
  if (!walletConnected) {
    return (
      <div className="card p-8 text-center">
        <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-surface-800/80 flex items-center justify-center">
          <Wallet className="w-7 h-7 text-surface-500" aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold text-surface-100 mb-2 font-display">
          Connect Wallet
        </h3>
        <p className="text-surface-400 text-sm">
          Connect your wallet to link Farcaster
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2
          className="w-8 h-8 animate-spin text-factory-400"
          aria-hidden="true"
        />
      </div>
    )
  }

  return (
    <div className="card p-6">
      {/* Progress steps */}
      <div
        className="flex items-center gap-2 mb-6"
        role="progressbar"
        aria-valuenow={
          step === 'done'
            ? 100
            : step === 'sign'
              ? 66
              : step === 'connect'
                ? 33
                : 0
        }
      >
        <StepIndicator
          icon={User}
          label="Find FID"
          active={step === 'lookup'}
          complete={step !== 'lookup'}
        />
        <div
          className={clsx(
            'flex-1 h-0.5',
            step !== 'lookup' ? 'bg-factory-500' : 'bg-surface-800',
          )}
        />
        <StepIndicator
          icon={Key}
          label="Create Signer"
          active={step === 'connect'}
          complete={step === 'sign' || step === 'done'}
        />
        <div
          className={clsx(
            'flex-1 h-0.5',
            step === 'sign' || step === 'done'
              ? 'bg-factory-500'
              : 'bg-surface-800',
          )}
        />
        <StepIndicator
          icon={CheckCircle2}
          label="Sign"
          active={step === 'sign'}
          complete={step === 'done'}
        />
      </div>

      {error && (
        <div
          className="flex items-center gap-2 p-3 mb-4 rounded-xl bg-error-500/10 border border-error-500/20 text-error-400"
          role="alert"
        >
          <AlertCircle className="w-5 h-5" aria-hidden="true" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Step 1: Lookup */}
      {step === 'lookup' && (
        <div className="text-center">
          {lookup?.found ? (
            <>
              <div className="flex items-center justify-center gap-4 mb-6">
                {lookup.user?.pfpUrl ? (
                  <img
                    src={lookup.user.pfpUrl}
                    alt={lookup.user.username}
                    className="w-16 h-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-surface-700 flex items-center justify-center text-surface-400 text-xl">
                    {lookup.user?.username?.slice(0, 2).toUpperCase() ?? '?'}
                  </div>
                )}
                <div className="text-left">
                  <p className="font-semibold text-surface-100 font-display">
                    {lookup.user?.displayName || lookup.user?.username}
                  </p>
                  <p className="text-surface-400 text-sm">
                    @{lookup.user?.username}
                  </p>
                  <p className="text-surface-500 text-xs mt-1">
                    FID: {lookup.fid}
                  </p>
                </div>
              </div>
              <p className="text-surface-400 text-sm mb-4">
                This account is linked to your wallet
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setStep('connect')}
              >
                Continue
              </button>
            </>
          ) : (
            <>
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-surface-800/80 flex items-center justify-center">
                <User className="w-7 h-7 text-surface-500" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-semibold text-surface-100 mb-2 font-display">
                No Farcaster Account
              </h3>
              <p className="text-surface-400 text-sm mb-4">
                This wallet is not linked to Farcaster
              </p>
              <a
                href="https://warpcast.com"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary inline-flex"
              >
                Create on Warpcast
                <ExternalLink className="w-4 h-4 ml-2" aria-hidden="true" />
              </a>
              <p className="text-surface-500 text-xs mt-4">
                After signing up, verify this wallet in Warpcast
              </p>
            </>
          )}
        </div>
      )}

      {/* Step 2: Connect */}
      {step === 'connect' && lookup?.found && (
        <div className="text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-factory-500/15 flex items-center justify-center">
            <Key className="w-7 h-7 text-factory-400" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-surface-100 mb-2 font-display">
            Create Signer
          </h3>
          <p className="text-surface-400 text-sm mb-6">
            Authorize Factory to post on your behalf. You can revoke this at any
            time.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConnect}
            disabled={quickConnect.isPending}
          >
            {quickConnect.isPending && (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            )}
            Create Signer
          </button>
        </div>
      )}

      {/* Step 3: Sign */}
      {step === 'sign' && pendingSignature && (
        <div className="text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-factory-500/15 flex items-center justify-center">
            <Wallet className="w-7 h-7 text-factory-400" aria-hidden="true" />
          </div>
          <h3 className="text-lg font-semibold text-surface-100 mb-2 font-display">
            Authorize
          </h3>
          <p className="text-surface-400 text-sm mb-6">
            Sign a message to complete authorization
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSign}
            disabled={activateSigner.isPending}
          >
            {activateSigner.isPending && (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            )}
            Sign Message
          </button>
        </div>
      )}
    </div>
  )
}

function StepIndicator({
  icon: Icon,
  label,
  active,
  complete,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active: boolean
  complete: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={clsx(
          'w-9 h-9 rounded-full flex items-center justify-center transition-colors',
          complete
            ? 'bg-success-500/20 text-success-400'
            : active
              ? 'bg-factory-500/20 text-factory-400'
              : 'bg-surface-800 text-surface-500',
        )}
      >
        {complete ? (
          <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
        ) : (
          <Icon className="w-4 h-4" aria-hidden="true" />
        )}
      </div>
      <span
        className={clsx(
          'text-xs',
          complete || active ? 'text-surface-300' : 'text-surface-500',
        )}
      >
        {label}
      </span>
    </div>
  )
}
