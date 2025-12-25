/**
 * Rewards Page
 * Converted from Next.js to React Router
 */

import { useQuery } from '@tanstack/react-query'
import { Award, Check, Copy, TrendingUp, Users } from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { AuthButton } from '../components/auth/AuthButton'
import { LoadingSpinner } from '../components/LoadingSpinner'

interface ReferralStats {
  totalReferrals: number
  totalPointsEarned: number
  referralCode: string | null
}

export default function RewardsPage() {
  const { address, isConnected } = useAccount()
  const [copiedUrl, setCopiedUrl] = useState(false)

  const { data: stats, isLoading } = useQuery({
    queryKey: ['referralStats', address],
    queryFn: async (): Promise<ReferralStats> => {
      const response = await fetch(`/api/users/${address}/referrals`)
      if (!response.ok) throw new Error('Failed to fetch referral data')
      return response.json() as Promise<ReferralStats>
    },
    enabled: isConnected && !!address,
  })

  const handleCopyUrl = async () => {
    if (!stats?.referralCode) return
    const referralUrl = `${window.location.origin}/?ref=${stats.referralCode}`
    await navigator.clipboard.writeText(referralUrl)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <Award
          className="mx-auto mb-4 h-16 w-16"
          style={{ color: 'var(--text-tertiary)' }}
        />
        <h1
          className="text-2xl font-bold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Rewards
        </h1>
        <p className="mb-8" style={{ color: 'var(--text-secondary)' }}>
          Connect your wallet to view and earn rewards
        </p>
        <AuthButton />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        Rewards
      </h1>
      <p className="mb-8" style={{ color: 'var(--text-secondary)' }}>
        Earn points by referring friends and completing tasks
      </p>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp
              className="h-5 w-5"
              style={{ color: 'var(--bazaar-primary)' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Total Earned
            </span>
          </div>
          <div
            className="text-3xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            {stats?.totalPointsEarned?.toLocaleString() || 0}
          </div>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2 mb-2">
            <Users
              className="h-5 w-5"
              style={{ color: 'var(--bazaar-primary)' }}
            />
            <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Referrals
            </span>
          </div>
          <div
            className="text-3xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            {stats?.totalReferrals || 0}
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h2
          className="text-lg font-bold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Your Referral Link
        </h2>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Share your link to earn points when friends sign up
        </p>

        <div className="flex gap-2">
          <input
            id="referral-link"
            aria-label="Your referral link"
            type="text"
            readOnly
            value={
              stats?.referralCode
                ? `${window.location.origin}/?ref=${stats.referralCode}`
                : 'Loading...'
            }
            className="input flex-1"
          />
          <button
            type="button"
            onClick={handleCopyUrl}
            disabled={!stats?.referralCode}
            className="btn-primary px-4 flex items-center gap-2"
          >
            {copiedUrl ? (
              <>
                <Check className="h-4 w-4" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
