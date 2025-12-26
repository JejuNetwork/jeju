/**
 * Farcaster Connect Component
 *
 * Banner/widget to connect Farcaster account for Direct Casts
 */

import {
  AlertCircle,
  AtSign,
  Check,
  ChevronRight,
  ExternalLink,
  Loader2,
  X,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import type { Hex } from 'viem'
import { useFarcasterAccount } from '../../hooks/useMessaging'
import { useWallet } from '../../hooks/useWallet'

type ConnectionStep =
  | 'idle'
  | 'lookup'
  | 'link'
  | 'approve'
  | 'complete'
  | 'error'

export function FarcasterConnect() {
  const { address } = useWallet()
  const { account, lookupFid, linkAccount, completeLink, getProfile } =
    useFarcasterAccount()

  const [step, setStep] = useState<ConnectionStep>('idle')
  const [isDismissed, setIsDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [foundFid, setFoundFid] = useState<number | null>(null)
  const [foundProfile, setFoundProfile] = useState<{
    username: string
    displayName: string
    pfpUrl: string
  } | null>(null)
  const [signerData, setSignerData] = useState<{
    publicKey: Hex
    privateKey: Hex
    keyId: string
    approvalLink: string
  } | null>(null)

  // Step 1: Look up FID by address
  const handleLookup = useCallback(async () => {
    if (!address) return

    setStep('lookup')
    setError(null)

    const fid = await lookupFid.mutateAsync(address)

    if (!fid) {
      setError(
        'No Farcaster account found for this address. Create one at warpcast.com first.',
      )
      setStep('error')
      return
    }

    // Fetch profile info
    const profile = await getProfile.mutateAsync(fid)

    setFoundFid(fid)
    setFoundProfile(
      profile
        ? {
            username: profile.username,
            displayName: profile.displayName,
            pfpUrl: profile.pfpUrl,
          }
        : null,
    )
    setStep('link')
  }, [address, lookupFid, getProfile])

  // Step 2: Generate and register signer
  const handleLink = useCallback(async () => {
    if (!foundFid) return

    setStep('approve')
    setError(null)

    const result = await linkAccount.mutateAsync(foundFid)

    // Store signer data - user needs to approve on Warpcast
    setSignerData({
      publicKey: result.signerPublicKey,
      privateKey: result.signer.privateKey,
      keyId: result.signer.keyId,
      approvalLink: result.approvalLink,
    })

    // Open Warpcast to approve the signer
    window.open(result.approvalLink, '_blank')
  }, [foundFid, linkAccount])

  // Step 3: Complete linking after Warpcast approval
  const handleComplete = useCallback(async () => {
    if (!foundFid || !signerData) return

    setStep('complete')

    // In production, we'd poll for signer approval or use a callback
    // For now, assume it's approved after the user clicks complete
    await completeLink.mutateAsync({
      fid: foundFid,
      signerPublicKey: signerData.publicKey,
      signerPrivateKey: signerData.privateKey,
    })
  }, [foundFid, signerData, completeLink])

  const handleDismiss = useCallback(() => {
    setIsDismissed(true)
  }, [])

  const handleRetry = useCallback(() => {
    setStep('idle')
    setError(null)
    setFoundFid(null)
    setFoundProfile(null)
    setSignerData(null)
  }, [])

  // Don't show if already connected or dismissed
  if (account || isDismissed) return null

  return (
    <div className="bg-gradient-to-r from-purple-500/10 to-fuchsia-500/10 border-b border-purple-500/20">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* Icon & Content */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
              <AtSign className="w-5 h-5 text-purple-400" />
            </div>

            <div className="flex-1 min-w-0">
              {step === 'idle' && (
                <>
                  <p className="font-medium text-sm">
                    Connect Farcaster for Direct Casts
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Send encrypted messages to Farcaster users
                  </p>
                </>
              )}

              {step === 'lookup' && (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                  <span className="text-sm">
                    Looking up Farcaster account...
                  </span>
                </div>
              )}

              {step === 'link' && foundProfile && (
                <div className="flex items-center gap-3">
                  <img
                    src={foundProfile.pfpUrl}
                    alt={foundProfile.displayName}
                    className="w-8 h-8 rounded-full"
                  />
                  <div>
                    <p className="font-medium text-sm">
                      {foundProfile.displayName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      @{foundProfile.username} • FID {foundFid}
                    </p>
                  </div>
                </div>
              )}

              {step === 'approve' && (
                <div className="flex items-center gap-2">
                  <ExternalLink className="w-4 h-4 text-purple-400" />
                  <span className="text-sm">
                    Approve signer in Warpcast, then click Complete
                  </span>
                </div>
              )}

              {step === 'complete' && (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                  <span className="text-sm">Completing connection...</span>
                </div>
              )}

              {step === 'error' && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <span className="text-sm text-red-400">{error}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {step === 'idle' && (
              <button
                type="button"
                onClick={handleLookup}
                disabled={lookupFid.isPending}
                className="px-4 py-2 rounded-lg bg-purple-500 text-white text-sm font-medium hover:bg-purple-600 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                Connect
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {step === 'link' && (
              <button
                type="button"
                onClick={handleLink}
                disabled={linkAccount.isPending}
                className="px-4 py-2 rounded-lg bg-purple-500 text-white text-sm font-medium hover:bg-purple-600 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {linkAccount.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Linking...
                  </>
                ) : (
                  <>
                    Link Account
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            )}

            {step === 'approve' && (
              <button
                type="button"
                onClick={handleComplete}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                Complete
              </button>
            )}

            {step === 'error' && (
              <button
                type="button"
                onClick={handleRetry}
                className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
              >
                Retry
              </button>
            )}

            {/* Dismiss button */}
            <button
              type="button"
              onClick={handleDismiss}
              className="p-2 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
