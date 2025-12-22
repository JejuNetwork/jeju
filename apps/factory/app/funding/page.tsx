'use client'

import { useState } from 'react'
import { formatEther } from 'viem'
import { useAccount } from 'wagmi'
import { useContributorByWallet } from '../../hooks/useContributor'
import {
  useClaimContributorRewards,
  useCurrentEpoch,
  useDAOFundingConfig,
  useDAOPool,
  useEpochVotes,
  usePendingContributorRewards,
  useVoteOnWeight,
} from '../../hooks/useFunding'
import type { FundingEpoch, WeightVote } from '../../types/funding'
import { DEFAULT_FEE_CONFIG } from '../../types/funding'

// Hardcoded DAO ID for demo
const DEFAULT_DAO_ID = `0x${'0'.repeat(63)}1`

// ============ Components ============

function ProgressBar({
  segments,
}: {
  segments: Array<{ value: number; color: string; label: string }>
}) {
  return (
    <div className="space-y-2">
      <div className="flex h-4 rounded-full overflow-hidden bg-slate-800">
        {segments.map((seg, i) => (
          <div
            key={i}
            className={`${seg.color} transition-all duration-500`}
            style={{ width: `${seg.value}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded ${seg.color}`} />
            <span className="text-sm text-slate-400">
              {seg.label}: {seg.value.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function EpochCard({ epoch }: { epoch: FundingEpoch }) {
  const daysRemaining = Math.max(
    0,
    Math.ceil((epoch.endTime - Date.now() / 1000) / (24 * 60 * 60)),
  )
  const progress = Math.min(
    100,
    ((Date.now() / 1000 - epoch.startTime) /
      (epoch.endTime - epoch.startTime)) *
      100,
  )

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <span className="text-white font-bold text-lg">
              #{epoch.epochId}
            </span>
          </div>
          <div>
            <h3 className="text-white font-semibold">Epoch {epoch.epochId}</h3>
            <p className="text-slate-400 text-sm">
              {epoch.finalized
                ? 'Finalized'
                : `${daysRemaining} days remaining`}
            </p>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-sm font-medium ${
            epoch.finalized
              ? 'bg-slate-500/20 text-slate-400'
              : 'bg-emerald-500/20 text-emerald-400'
          }`}
        >
          {epoch.finalized ? 'Complete' : 'Active'}
        </span>
      </div>

      {!epoch.finalized && (
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-400">Progress</span>
            <span className="text-slate-300">{progress.toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-700">
        <div>
          <p className="text-slate-500 text-xs">Contributor Pool</p>
          <p className="text-white font-semibold">
            {formatEther(epoch.totalContributorRewards)} ETH
          </p>
        </div>
        <div>
          <p className="text-slate-500 text-xs">Dependency Pool</p>
          <p className="text-white font-semibold">
            {formatEther(epoch.totalDependencyRewards)} ETH
          </p>
        </div>
        <div>
          <p className="text-slate-500 text-xs">Total Distributed</p>
          <p className="text-white font-semibold">
            {formatEther(epoch.totalDistributed)} ETH
          </p>
        </div>
      </div>
    </div>
  )
}

function VoteForm({
  daoId,
  onSuccess,
}: {
  daoId: string
  onSuccess: () => void
}) {
  const [targetId, setTargetId] = useState('')
  const [adjustment, setAdjustment] = useState('')
  const [reason, setReason] = useState('')
  const [reputation, setReputation] = useState('50')

  const { vote, isPending, isConfirming, isSuccess, error } = useVoteOnWeight()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    vote(
      daoId,
      targetId,
      parseInt(adjustment, 10),
      reason,
      parseInt(reputation, 10),
    )
  }

  if (isSuccess) {
    onSuccess()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Target ID
          </label>
          <input
            type="text"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="Contributor or dependency ID"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Weight Adjustment
          </label>
          <input
            type="number"
            value={adjustment}
            onChange={(e) => setAdjustment(e.target.value)}
            placeholder="-500 to +500"
            min="-500"
            max="500"
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            required
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Reason
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why do you think this weight should be adjusted?"
          rows={2}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none resize-none"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Your Reputation Score
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={reputation}
          onChange={(e) => setReputation(e.target.value)}
          className="w-full"
        />
        <p className="text-slate-400 text-sm text-right">{reputation}/100</p>
      </div>

      {error && <p className="text-rose-400 text-sm">{error.message}</p>}

      <button
        type="submit"
        disabled={isPending || isConfirming}
        className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50"
      >
        {isPending
          ? 'Signing...'
          : isConfirming
            ? 'Confirming...'
            : 'Submit Vote'}
      </button>
    </form>
  )
}

function VoteCard({ vote }: { vote: WeightVote }) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-sm text-slate-400">
          {vote.voter.slice(0, 6)}...{vote.voter.slice(-4)}
        </span>
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            vote.weightAdjustment > 0
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-rose-500/20 text-rose-400'
          }`}
        >
          {vote.weightAdjustment > 0 ? '+' : ''}
          {vote.weightAdjustment}
        </span>
      </div>
      <p className="text-white text-sm mb-2">{vote.reason}</p>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Rep: {vote.reputation}</span>
        <span>{new Date(vote.votedAt * 1000).toLocaleDateString()}</span>
      </div>
    </div>
  )
}

function ClaimRewardsCard({
  daoId,
  contributorId,
  pendingRewards,
  wallet,
}: {
  daoId: string
  contributorId: string
  pendingRewards: bigint
  wallet: `0x${string}`
}) {
  const { claim, isPending, isConfirming } = useClaimContributorRewards()

  const handleClaim = () => {
    claim(daoId, contributorId, [0, 1, 2, 3, 4, 5], wallet) // Claim from recent epochs
  }

  return (
    <div className="bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 rounded-xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-400 text-sm">Your Pending Rewards</p>
          <p className="text-3xl font-bold text-white mt-1">
            {formatEther(pendingRewards)} ETH
          </p>
        </div>
        <button
          onClick={handleClaim}
          disabled={isPending || isConfirming || pendingRewards === 0n}
          className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50"
        >
          {isPending
            ? 'Signing...'
            : isConfirming
              ? 'Confirming...'
              : 'Claim Rewards'}
        </button>
      </div>
    </div>
  )
}

// ============ Main Page ============

export default function FundingPage() {
  const { address, isConnected } = useAccount()
  const [activeTab, setActiveTab] = useState<
    'overview' | 'deliberation' | 'votes'
  >('overview')

  const { pool } = useDAOPool(DEFAULT_DAO_ID)
  const { epoch } = useCurrentEpoch(DEFAULT_DAO_ID)
  const { votes, refetch: refetchVotes } = useEpochVotes(
    DEFAULT_DAO_ID,
    epoch?.epochId,
  )
  const { config } = useDAOFundingConfig(DEFAULT_DAO_ID)
  const { profile: myProfile } = useContributorByWallet(address)
  const { rewards: pendingRewards } = usePendingContributorRewards(
    DEFAULT_DAO_ID,
    myProfile?.contributorId,
  )

  const feeConfig = config || DEFAULT_FEE_CONFIG

  const feeSegments = [
    {
      value: feeConfig.contributorPoolBps / 100,
      color: 'bg-indigo-500',
      label: 'Contributors',
    },
    {
      value: feeConfig.dependencyPoolBps / 100,
      color: 'bg-purple-500',
      label: 'Dependencies',
    },
    {
      value: feeConfig.treasuryBps / 100,
      color: 'bg-amber-500',
      label: 'Treasury',
    },
    { value: feeConfig.jejuBps / 100, color: 'bg-cyan-500', label: 'Jeju' },
    {
      value: feeConfig.reserveBps / 100,
      color: 'bg-slate-500',
      label: 'Reserve',
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Deep Funding</h1>
          <p className="text-slate-400">
            Track epoch distributions, participate in deliberation, and claim
            rewards
          </p>
        </div>

        {/* Pending Rewards */}
        {isConnected && myProfile && address && (
          <div className="mb-8">
            <ClaimRewardsCard
              daoId={DEFAULT_DAO_ID}
              contributorId={myProfile.contributorId}
              pendingRewards={pendingRewards}
              wallet={address}
            />
          </div>
        )}

        {/* Pool Stats */}
        {pool && (
          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5">
              <p className="text-slate-400 text-sm">Total Accumulated</p>
              <p className="text-2xl font-bold text-white mt-1">
                {formatEther(pool.totalAccumulated)} ETH
              </p>
            </div>
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5">
              <p className="text-slate-400 text-sm">Contributor Pool</p>
              <p className="text-2xl font-bold text-indigo-400 mt-1">
                {formatEther(pool.contributorPool)} ETH
              </p>
            </div>
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5">
              <p className="text-slate-400 text-sm">Dependency Pool</p>
              <p className="text-2xl font-bold text-purple-400 mt-1">
                {formatEther(pool.dependencyPool)} ETH
              </p>
            </div>
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-5">
              <p className="text-slate-400 text-sm">Reserve Pool</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">
                {formatEther(pool.reservePool)} ETH
              </p>
            </div>
          </div>
        )}

        {/* Fee Distribution */}
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6 mb-8">
          <h3 className="text-lg font-semibold text-white mb-4">
            Fee Distribution
          </h3>
          <ProgressBar segments={feeSegments} />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-700 mb-6">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'deliberation', label: 'Deliberation' },
            { id: 'votes', label: 'Recent Votes' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() =>
                setActiveTab(tab.id as 'overview' | 'deliberation' | 'votes')
              }
              className={`px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-indigo-400 border-b-2 border-indigo-500'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {epoch && <EpochCard epoch={epoch} />}

            {!epoch && (
              <div className="text-center py-12 bg-slate-800/30 rounded-xl border border-slate-700">
                <p className="text-slate-400 text-lg">No active epoch</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'deliberation' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                Submit Weight Vote
              </h3>
              <p className="text-slate-400 text-sm mb-4">
                Participate in deliberation by suggesting weight adjustments for
                contributors or dependencies. Your vote is weighted by your
                reputation score.
              </p>
              <VoteForm
                daoId={DEFAULT_DAO_ID}
                onSuccess={() => refetchVotes()}
              />
            </div>

            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                How Deliberation Works
              </h3>
              <ul className="space-y-3 text-slate-300 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-indigo-400">1.</span>
                  <span>
                    Registered contributors can vote on weight adjustments for
                    other contributors or dependencies.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-indigo-400">2.</span>
                  <span>
                    Votes are weighted by the voter's reputation score (0-100).
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-indigo-400">3.</span>
                  <span>
                    The maximum deliberation influence is capped at 10% of base
                    weights.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-indigo-400">4.</span>
                  <span>
                    Final weights are calculated when the epoch is finalized,
                    incorporating all votes.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-indigo-400">5.</span>
                  <span>
                    Dependency weights decay by 20% per transitive depth level.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'votes' && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">
              Recent Deliberation Votes
            </h3>

            {votes.length === 0 ? (
              <div className="text-center py-12 bg-slate-800/30 rounded-xl border border-slate-700">
                <p className="text-slate-400">
                  No votes submitted for this epoch yet
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {votes.map((vote, i) => (
                  <VoteCard key={i} vote={vote} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Not connected notice */}
        {!isConnected && (
          <div className="mt-8 p-6 bg-slate-800/30 border border-slate-700 rounded-xl text-center">
            <p className="text-slate-400 text-lg">
              Connect your wallet to participate in deliberation and claim
              rewards
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
