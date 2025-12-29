import type React from 'react'
import { useState } from 'react'
import type { Address, Hex } from 'viem'
import { encodeFunctionData } from 'viem'

interface TokenApproval {
  token: {
    address: Address
    symbol: string
    name: string
    decimals: number
    logoUrl?: string
  }
  spender: {
    address: Address
    name?: string
    isVerified: boolean
    riskLevel: 'safe' | 'low' | 'medium' | 'high'
  }
  allowance: bigint
  allowanceFormatted: string
  isUnlimited: boolean
  chainId: number
  lastUpdated: string
}

interface ApprovalManagerProps {
  address: Address
  approvals: TokenApproval[]
  loading?: boolean
  onRevoke: (approval: TokenApproval) => Promise<void>
  onBatchRevoke: (approvals: TokenApproval[]) => Promise<void>
  onRefresh: () => void
}

const RiskBadge: React.FC<{ level: TokenApproval['spender']['riskLevel'] }> = ({
  level,
}) => {
  const styles: Record<string, string> = {
    safe: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    low: 'bg-lime-500/20 text-lime-400 border-lime-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    high: 'bg-red-500/20 text-red-400 border-red-500/30',
  }

  return (
    <span
      className={`px-2.5 py-1 text-xs font-semibold rounded-lg border capitalize ${styles[level]}`}
    >
      {level}
    </span>
  )
}

export const ApprovalManager: React.FC<ApprovalManagerProps> = ({
  address: _address,
  approvals,
  loading,
  onRevoke,
  onBatchRevoke,
  onRefresh,
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [revoking, setRevoking] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<'all' | 'unlimited' | 'risky'>('all')
  const [sortBy, setSortBy] = useState<'recent' | 'amount' | 'risk'>('recent')

  // Filter approvals
  const filteredApprovals = approvals.filter((approval) => {
    if (filter === 'unlimited') return approval.isUnlimited
    if (filter === 'risky')
      return (
        approval.spender.riskLevel === 'high' ||
        approval.spender.riskLevel === 'medium'
      )
    return true
  })

  // Sort approvals
  const sortedApprovals = [...filteredApprovals].sort((a, b) => {
    if (sortBy === 'recent') {
      return (
        new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
      )
    }
    if (sortBy === 'amount') {
      if (a.isUnlimited && !b.isUnlimited) return -1
      if (!a.isUnlimited && b.isUnlimited) return 1
      return Number(b.allowance - a.allowance)
    }
    if (sortBy === 'risk') {
      const riskOrder = { high: 0, medium: 1, low: 2, safe: 3 }
      return riskOrder[a.spender.riskLevel] - riskOrder[b.spender.riskLevel]
    }
    return 0
  })

  // Generate approval key
  const getKey = (approval: TokenApproval) =>
    `${approval.token.address}-${approval.spender.address}-${approval.chainId}`

  // Toggle selection
  const toggleSelect = (approval: TokenApproval) => {
    const key = getKey(approval)
    const newSelected = new Set(selected)
    if (newSelected.has(key)) {
      newSelected.delete(key)
    } else {
      newSelected.add(key)
    }
    setSelected(newSelected)
  }

  // Select all
  const selectAll = () => {
    if (selected.size === sortedApprovals.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(sortedApprovals.map(getKey)))
    }
  }

  // Revoke single approval
  const handleRevoke = async (approval: TokenApproval) => {
    const key = getKey(approval)
    setRevoking((prev) => new Set(prev).add(key))
    try {
      await onRevoke(approval)
    } finally {
      setRevoking((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  // Batch revoke
  const handleBatchRevoke = async () => {
    const toRevoke = sortedApprovals.filter((a) => selected.has(getKey(a)))
    if (toRevoke.length === 0) return

    for (const approval of toRevoke) {
      setRevoking((prev) => new Set(prev).add(getKey(approval)))
    }

    try {
      await onBatchRevoke(toRevoke)
      setSelected(new Set())
    } finally {
      setRevoking(new Set())
    }
  }

  // Stats
  const unlimitedCount = approvals.filter((a) => a.isUnlimited).length
  const riskyCount = approvals.filter(
    (a) => a.spender.riskLevel === 'high' || a.spender.riskLevel === 'medium',
  ).length

  if (loading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-500" />
        <span className="mt-4 text-muted-foreground">Loading approvals...</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header Stats */}
      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
          className={`p-4 rounded-xl text-center transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
            filter === 'all'
              ? 'bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30'
              : 'bg-card border border-border hover:border-emerald-500/30'
          }`}
        >
          <p
            className={`text-2xl font-bold ${filter === 'all' ? 'text-emerald-400' : ''}`}
          >
            {approvals.length}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Total</p>
        </button>
        <button
          type="button"
          onClick={() => setFilter('unlimited')}
          aria-pressed={filter === 'unlimited'}
          className={`p-4 rounded-xl text-center transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
            filter === 'unlimited'
              ? 'bg-gradient-to-br from-yellow-500/20 to-orange-500/20 border border-yellow-500/30'
              : 'bg-card border border-border hover:border-yellow-500/30'
          }`}
        >
          <p
            className={`text-2xl font-bold ${filter === 'unlimited' ? 'text-yellow-400' : ''}`}
          >
            {unlimitedCount}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Unlimited</p>
        </button>
        <button
          type="button"
          onClick={() => setFilter('risky')}
          aria-pressed={filter === 'risky'}
          className={`p-4 rounded-xl text-center transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
            filter === 'risky'
              ? 'bg-gradient-to-br from-red-500/20 to-rose-500/20 border border-red-500/30'
              : 'bg-card border border-border hover:border-red-500/30'
          }`}
        >
          <p
            className={`text-2xl font-bold ${filter === 'risky' ? 'text-red-400' : ''}`}
          >
            {riskyCount}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Risky</p>
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="px-4 py-2 text-sm font-medium bg-secondary hover:bg-secondary/80 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            {selected.size === sortedApprovals.length
              ? 'Deselect All'
              : 'Select All'}
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={handleBatchRevoke}
              className="px-4 py-2 text-sm font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl border border-red-500/20 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/50"
            >
              Revoke Selected ({selected.size})
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            aria-label="Sort approvals by"
            className="px-4 py-2 text-sm font-medium bg-secondary rounded-xl border border-border focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            <option value="recent">Most Recent</option>
            <option value="amount">Highest Amount</option>
            <option value="risk">Highest Risk</option>
          </select>
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh approvals"
            className="p-2.5 bg-secondary hover:bg-secondary/80 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Approval List */}
      {sortedApprovals.length === 0 ? (
        <div className="p-12 text-center bg-card border border-border rounded-2xl">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center mb-4">
            <span className="text-2xl">✨</span>
          </div>
          <h3 className="font-bold text-lg">No Approvals Found</h3>
          <p className="text-muted-foreground mt-2">
            Your wallet is squeaky clean
          </p>
          {filter !== 'all' && (
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="mt-4 text-sm text-amber-400 hover:text-amber-300 font-medium transition-colors"
            >
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {sortedApprovals.map((approval) => {
            const key = getKey(approval)
            const isSelected = selected.has(key)
            const isRevoking = revoking.has(key)

            return (
              <div
                key={key}
                className={`p-4 rounded-xl transition-all ${
                  isSelected
                    ? 'bg-card border-2 border-amber-500/50'
                    : 'bg-card border border-border hover:border-amber-500/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <button
                    type="button"
                    onClick={() => toggleSelect(approval)}
                    aria-pressed={isSelected}
                    aria-label={`Select ${approval.token.symbol} approval`}
                    className={`mt-1 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                      isSelected
                        ? 'bg-amber-500 border-amber-500'
                        : 'border-border hover:border-amber-500/50'
                    }`}
                  >
                    {isSelected && (
                      <span className="text-xs text-white font-bold">✓</span>
                    )}
                  </button>

                  {/* Token Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-bold">{approval.token.symbol}</span>
                      {approval.isUnlimited && (
                        <span className="px-2 py-0.5 text-xs font-semibold bg-yellow-500/20 text-yellow-400 rounded-lg border border-yellow-500/30">
                          Unlimited
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      Spender:{' '}
                      {approval.spender.name ||
                        `${approval.spender.address.slice(0, 6)}...${approval.spender.address.slice(-4)}`}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <RiskBadge level={approval.spender.riskLevel} />
                      {approval.spender.isVerified && (
                        <span className="text-xs text-emerald-400 font-medium">
                          ✓ Verified
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Allowance & Actions */}
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold mb-2">
                      {approval.isUnlimited ? '∞' : approval.allowanceFormatted}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleRevoke(approval)}
                      disabled={isRevoking}
                      className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-red-500/50 ${
                        isRevoking
                          ? 'bg-secondary text-muted-foreground cursor-not-allowed'
                          : 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
                      }`}
                    >
                      {isRevoking ? 'Revoking...' : 'Revoke'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function buildRevokeTransaction(
  tokenAddress: Address,
  spenderAddress: Address,
): { to: Address; data: Hex } {
  const data = encodeFunctionData({
    abi: [
      {
        name: 'approve',
        type: 'function',
        inputs: [
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ type: 'bool' }],
      },
    ],
    functionName: 'approve',
    args: [spenderAddress, 0n],
  })

  return { to: tokenAddress, data }
}

export default ApprovalManager
