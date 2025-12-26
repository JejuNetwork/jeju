/**
 * Farcaster Connect Component
 *
 * Onboarding flow for connecting Farcaster to Factory.
 */

import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Key,
  Loader2,
  User,
  Wallet,
} from 'lucide-react'
import { useEffect, useState } from 'react'
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
      !onboarding?.steps.activateSigner.complete
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

  const handleConnect = async () => {
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
  }

  const handleSign = async () => {
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
  }

  const isLoading = statusLoading || onboardingLoading || lookupLoading

  // If already connected, show status
  if (step === 'done' && farcasterStatus?.connected) {
    if (compact) {
      return (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          <div>
            <p className="text-sm font-medium text-factory-100">
              Connected as @{farcasterStatus.username}
            </p>
          </div>
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
            <div className="w-16 h-16 rounded-full bg-factory-700 flex items-center justify-center text-factory-400 text-xl">
              {farcasterStatus.username?.slice(0, 2).toUpperCase() ?? '?'}
            </div>
          )}
          <div>
            <p className="font-medium text-factory-100 text-lg">
              {farcasterStatus.displayName || farcasterStatus.username}
            </p>
            <p className="text-factory-400">@{farcasterStatus.username}</p>
            <div className="flex items-center gap-2 mt-2">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <span className="text-sm text-green-400">
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
        <Wallet className="w-12 h-12 mx-auto mb-4 text-factory-600" />
        <h3 className="text-lg font-medium text-factory-100 mb-2">
          Connect Wallet First
        </h3>
        <p className="text-factory-400 text-sm">
          Please connect your wallet to link your Farcaster account
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="card p-8 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-500" />
      </div>
    )
  }

  return (
    <div className="card p-6">
      {/* Progress steps */}
      <div className="flex items-center gap-2 mb-6">
        <StepIndicator
          icon={User}
          label="Find FID"
          active={step === 'lookup'}
          complete={step !== 'lookup'}
        />
        <div className="flex-1 h-0.5 bg-factory-800" />
        <StepIndicator
          icon={Key}
          label="Create Signer"
          active={step === 'connect'}
          complete={step === 'sign' || step === 'done'}
        />
        <div className="flex-1 h-0.5 bg-factory-800" />
        <StepIndicator
          icon={CheckCircle2}
          label="Sign"
          active={step === 'sign'}
          complete={step === 'done'}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
          <AlertCircle className="w-5 h-5" />
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
                  <div className="w-16 h-16 rounded-full bg-factory-700 flex items-center justify-center text-factory-400 text-xl">
                    {lookup.user?.username?.slice(0, 2).toUpperCase() ?? '?'}
                  </div>
                )}
                <div className="text-left">
                  <p className="font-medium text-factory-100">
                    {lookup.user?.displayName || lookup.user?.username}
                  </p>
                  <p className="text-factory-400 text-sm">
                    @{lookup.user?.username}
                  </p>
                  <p className="text-factory-500 text-xs mt-1">
                    FID: {lookup.fid}
                  </p>
                </div>
              </div>
              <p className="text-factory-400 text-sm mb-4">
                This Farcaster account is verified with your wallet address
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
              <User className="w-12 h-12 mx-auto mb-4 text-factory-600" />
              <h3 className="text-lg font-medium text-factory-100 mb-2">
                No Farcaster Account Found
              </h3>
              <p className="text-factory-400 text-sm mb-4">
                Your wallet address is not connected to a Farcaster account
              </p>
              <a
                href="https://warpcast.com"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary inline-flex"
              >
                Create on Warpcast
                <ExternalLink className="w-4 h-4 ml-2" />
              </a>
              <p className="text-factory-500 text-xs mt-4">
                After creating an account, verify this address in Warpcast
                settings
              </p>
            </>
          )}
        </div>
      )}

      {/* Step 2: Connect */}
      {step === 'connect' && lookup?.found && (
        <div className="text-center">
          <Key className="w-12 h-12 mx-auto mb-4 text-accent-500" />
          <h3 className="text-lg font-medium text-factory-100 mb-2">
            Create Signing Key
          </h3>
          <p className="text-factory-400 text-sm mb-6">
            Factory needs a signing key to post on your behalf. This key is
            stored securely and can be revoked at any time.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConnect}
            disabled={quickConnect.isPending}
          >
            {quickConnect.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            Create Signer
          </button>
        </div>
      )}

      {/* Step 3: Sign */}
      {step === 'sign' && pendingSignature && (
        <div className="text-center">
          <Wallet className="w-12 h-12 mx-auto mb-4 text-accent-500" />
          <h3 className="text-lg font-medium text-factory-100 mb-2">
            Sign to Authorize
          </h3>
          <p className="text-factory-400 text-sm mb-6">
            Sign a message with your wallet to authorize the signing key
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSign}
            disabled={activateSigner.isPending}
          >
            {activateSigner.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
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
        className={`w-8 h-8 rounded-full flex items-center justify-center ${
          complete
            ? 'bg-green-500/20 text-green-400'
            : active
              ? 'bg-accent-500/20 text-accent-400'
              : 'bg-factory-800 text-factory-500'
        }`}
      >
        {complete ? (
          <CheckCircle2 className="w-5 h-5" />
        ) : (
          <Icon className="w-4 h-4" />
        )}
      </div>
      <span
        className={`text-xs ${
          complete || active ? 'text-factory-300' : 'text-factory-500'
        }`}
      >
        {label}
      </span>
    </div>
  )
}
