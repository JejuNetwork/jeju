import {
  Award,
  Flag,
  Loader2,
  RefreshCw,
  Shield,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  User,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  fetchActiveFlags,
  fetchModeratorLeaderboard,
  fetchModeratorStats,
  voteOnFlag,
} from '../config/api'

interface ActiveFlag {
  id: string
  proposalId: string
  flagger: string
  flagType: string
  reason: string
  evidence: string[]
  stake: number
  createdAt: number
  upvotes: number
  downvotes: number
  status: string
}

interface ModeratorStats {
  address: string
  totalFlags: number
  accurateFlags: number
  accuracy: number
  reputation: number
  rank: number
  rewards: string
}

interface LeaderboardEntry {
  rank: number
  address: string
  reputation: number
  accurateFlags: number
  rewards: string
}

export default function ModerationPage() {
  const [flags, setFlags] = useState<ActiveFlag[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [votingId, setVotingId] = useState<string | null>(null)

  // Moderator lookup state
  const [lookupAddress, setLookupAddress] = useState('')
  const [moderatorStats, setModeratorStats] = useState<ModeratorStats | null>(
    null,
  )
  const [lookupLoading, setLookupLoading] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [flagsData, leaderboardData] = await Promise.all([
      fetchActiveFlags().catch(() => ({ flags: [] })),
      fetchModeratorLeaderboard(10).catch(() => ({ entries: [] })),
    ])
    setFlags(
      (flagsData as { flags: ActiveFlag[] } | null)?.flags ??
        ([] as ActiveFlag[]),
    )
    setLeaderboard(
      (leaderboardData as { entries: LeaderboardEntry[] } | null)?.entries ??
        ([] as LeaderboardEntry[]),
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleVote = async (flagId: string, upvote: boolean) => {
    setVotingId(flagId)
    await voteOnFlag(
      flagId,
      '0x0000000000000000000000000000000000000000', // Would come from wallet
      upvote,
    ).catch(() => null)
    await loadData()
    setVotingId(null)
  }

  const handleLookupModerator = async () => {
    if (!lookupAddress.trim()) return
    setLookupLoading(true)
    const stats = await fetchModeratorStats(lookupAddress).catch(() => null)
    setModeratorStats(stats as ModeratorStats | null)
    setLookupLoading(false)
  }

  const formatAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`

  const getFlagTypeColor = (type: string) => {
    switch (type) {
      case 'spam':
        return 'bg-gray-100 text-gray-700'
      case 'inappropriate':
        return 'bg-red-100 text-red-700'
      case 'duplicate':
        return 'bg-blue-100 text-blue-700'
      case 'misleading':
        return 'bg-yellow-100 text-yellow-700'
      default:
        return 'bg-purple-100 text-purple-700'
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Shield size={24} />
            Moderation
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Review and vote on flagged content
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Active Flags - Main Content */}
        <div className="lg:col-span-2">
          <div className="card-static p-4 sm:p-6">
            <h2 className="font-semibold flex items-center gap-2 mb-4">
              <Flag size={18} />
              Active Flags ({flags.length})
            </h2>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin" size={32} />
              </div>
            ) : flags.length > 0 ? (
              <div className="space-y-4">
                {flags.map((flag) => (
                  <div
                    key={flag.id}
                    className="p-4 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${getFlagTypeColor(flag.flagType)}`}
                        >
                          {flag.flagType.toUpperCase()}
                        </span>
                        <Link
                          to={`/proposals/${flag.proposalId}`}
                          className="ml-2 text-sm text-blue-500 hover:underline"
                        >
                          Proposal {flag.proposalId.slice(0, 10)}...
                        </Link>
                      </div>
                      <span className="text-xs text-gray-500">
                        {new Date(flag.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <p className="text-sm mb-3">{flag.reason}</p>

                    {flag.evidence.length > 0 && (
                      <div className="mb-3">
                        <span className="text-xs font-medium text-gray-500">
                          Evidence:
                        </span>
                        <ul className="text-xs text-gray-600 mt-1">
                          {flag.evidence.map((e) => (
                            <li key={e}>• {e}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span>By: {formatAddress(flag.flagger)}</span>
                        <span>Stake: {flag.stake} ETH</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleVote(flag.id, true)}
                          disabled={votingId === flag.id}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                        >
                          {votingId === flag.id ? (
                            <Loader2 className="animate-spin" size={14} />
                          ) : (
                            <ThumbsUp size={14} />
                          )}
                          {flag.upvotes}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleVote(flag.id, false)}
                          disabled={votingId === flag.id}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                        >
                          {votingId === flag.id ? (
                            <Loader2 className="animate-spin" size={14} />
                          ) : (
                            <ThumbsDown size={14} />
                          )}
                          {flag.downvotes}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Flag className="mx-auto mb-3 text-gray-300" size={48} />
                <p className="text-gray-500">No active flags to review</p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Leaderboard */}
          <div className="card-static p-4">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <TrendingUp size={16} />
              Top Moderators
            </h3>
            {leaderboard.length > 0 ? (
              <div className="space-y-2">
                {leaderboard.map((entry, i) => (
                  <div
                    key={entry.address}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        i === 0
                          ? 'bg-yellow-100 text-yellow-700'
                          : i === 1
                            ? 'bg-gray-100 text-gray-700'
                            : i === 2
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-gray-50 text-gray-500'
                      }`}
                    >
                      {entry.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {formatAddress(entry.address)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {entry.accurateFlags} accurate flags
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        {entry.reputation}
                      </p>
                      <p className="text-xs text-gray-500">rep</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No moderators yet</p>
            )}
          </div>

          {/* Moderator Lookup */}
          <div className="card-static p-4">
            <h3 className="font-semibold flex items-center gap-2 mb-4">
              <User size={16} />
              Moderator Lookup
            </h3>
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={lookupAddress}
                  onChange={(e) => setLookupAddress(e.target.value)}
                  placeholder="0x..."
                  className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                />
                <button
                  type="button"
                  onClick={handleLookupModerator}
                  disabled={lookupLoading || !lookupAddress.trim()}
                  className="btn-primary px-4"
                >
                  {lookupLoading ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    'Look up'
                  )}
                </button>
              </div>

              {moderatorStats && (
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 space-y-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Award size={16} className="text-yellow-500" />
                    <span className="font-medium">
                      Rank #{moderatorStats.rank}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-500">Total Flags</span>
                      <p className="font-semibold">
                        {moderatorStats.totalFlags}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Accurate</span>
                      <p className="font-semibold">
                        {moderatorStats.accurateFlags}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Accuracy</span>
                      <p className="font-semibold">
                        {moderatorStats.accuracy}%
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Reputation</span>
                      <p className="font-semibold">
                        {moderatorStats.reputation}
                      </p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-gray-500 text-sm">Total Rewards</span>
                    <p className="font-semibold">{moderatorStats.rewards}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
