/**
 * Rewards Page
 *
 * Earn points by referring friends and completing tasks
 */

import { useQuery } from '@tanstack/react-query'
import { Check, Copy, TrendingUp, Users } from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { z } from 'zod'
import { AuthButton } from '../components/auth/AuthButton'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { Grid, StatCard } from '../components/ui'

const ReferralStatsSchema = z.object({
  totalReferrals: z.number(),
  totalPointsEarned: z.number(),
  referralCode: z.string(),
})

type ReferralStats = z.infer<typeof ReferralStatsSchema>

export default function RewardsPage() {
  const { address, isConnected } = useAccount()
  const [copiedUrl, setCopiedUrl] = useState(false)

  const { data: stats, isLoading } = useQuery({
    queryKey: ['referralStats', address],
    queryFn: async (): Promise<ReferralStats> => {
      const response = await fetch(`/api/users/${address}/referrals`)
      if (!response.ok) throw new Error('Failed to fetch referral data')
      const json: unknown = await response.json()
      return ReferralStatsSchema.parse(json)
    },
    enabled: isConnected && Boolean(address),
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
      <div className="max-w-2xl mx-auto text-center py-20 animate-fade-in">
        <div className="text-6xl mb-4 animate-float" aria-hidden="true">
          🎁
        </div>
        <h1 className="text-2xl font-bold text-primary mb-4">Rewards</h1>
        <p className="text-secondary mb-8">
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
    <div className="max-w-2xl mx-auto animate-fade-in">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gradient-warm flex items-center gap-3 mb-2">
          <span
            className="text-3xl md:text-4xl animate-bounce-subtle"
            aria-hidden="true"
          >
            🎁
          </span>
          <span>Rewards</span>
        </h1>
        <p className="text-secondary">
          Earn points by referring friends and completing tasks
        </p>
      </header>

      {/* Stats */}
      <Grid cols={2} className="mb-8">
        <StatCard
          icon={TrendingUp}
          label="Total Earned"
          value={stats?.totalPointsEarned.toLocaleString() ?? '—'}
        />
        <StatCard
          icon={Users}
          label="Referrals"
          value={stats?.totalReferrals?.toString() ?? '—'}
        />
      </Grid>

      {/* Referral Link */}
      <section className="card p-6">
        <h2 className="text-lg font-bold text-primary mb-2 flex items-center gap-2">
          <span aria-hidden="true">🔗</span>
          Your Referral Link
        </h2>
        <p className="text-sm text-secondary mb-4">
          Share your link with friends. Earn points when they sign up and trade.
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
            className="input flex-1 font-mono text-sm"
          />
          <button
            type="button"
            onClick={handleCopyUrl}
            disabled={!stats?.referralCode}
            className="btn-primary px-4 flex items-center gap-2 whitespace-nowrap"
          >
            {copiedUrl ? (
              <>
                <Check className="h-4 w-4" aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" aria-hidden="true" />
                Copy
              </>
            )}
          </button>
        </div>
      </section>

      {/* How it Works */}
      <section className="card p-6 mt-6">
        <h2 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
          <span aria-hidden="true">✨</span>
          How It Works
        </h2>
        <ol className="space-y-4">
          {[
            {
              step: '1',
              title: 'Share Your Link',
              desc: 'Send your unique referral link to friends',
            },
            {
              step: '2',
              title: 'Friends Sign Up',
              desc: 'They connect their wallet and start trading',
            },
            {
              step: '3',
              title: 'Earn Points',
              desc: 'Get rewarded for every friend who joins',
            },
          ].map((item) => (
            <li key={item.step} className="flex items-start gap-4">
              <div className="w-8 h-8 rounded-full gradient-warm flex items-center justify-center text-white font-bold shrink-0">
                {item.step}
              </div>
              <div>
                <h3 className="font-semibold text-primary">{item.title}</h3>
                <p className="text-sm text-secondary">{item.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
