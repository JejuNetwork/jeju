/**
 * Approval Management Component
 * View and revoke token approvals
 */

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
    safe: 'bg-green-500/20 text-green-400',
    low: 'bg-lime-500/20 text-lime-400',
    medium: 'bg-yellow-500/20 text-yellow-400',
    high: 'bg-red-500/20 text-red-400',
  }

  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded ${styles[level]}`}
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
      <div className="p-8 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
        <span className="ml-3 text-zinc-400">Loading approvals...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header Stats */}
      <div className="grid grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`p-3 rounded-lg text-center transition-colors ${
            filter === 'all'
              ? 'bg-emerald-600'
              : 'bg-zinc-800 hover:bg-zinc-700'
          }`}
        >
          <p className="text-2xl font-bold">{approvals.length}</p>
          <p className="text-xs text-zinc-400">Total</p>
        </button>
        <button
          type="button"
          onClick={() => setFilter('unlimited')}
          className={`p-3 rounded-lg text-center transition-colors ${
            filter === 'unlimited'
              ? 'bg-yellow-600'
              : 'bg-zinc-800 hover:bg-zinc-700'
          }`}
        >
          <p className="text-2xl font-bold">{unlimitedCount}</p>
          <p className="text-xs text-zinc-400">Unlimited</p>
        </button>
        <button
          type="button"
          onClick={() => setFilter('risky')}
          className={`p-3 rounded-lg text-center transition-colors ${
            filter === 'risky' ? 'bg-red-600' : 'bg-zinc-800 hover:bg-zinc-700'
          }`}
        >
          <p className="text-2xl font-bold">{riskyCount}</p>
          <p className="text-xs text-zinc-400">Risky</p>
        </button>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
          >
            {selected.size === sortedApprovals.length
              ? 'Deselect All'
              : 'Select All'}
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={handleBatchRevoke}
              className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-500 rounded transition-colors"
            >
              Revoke Selected ({selected.size})
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-1.5 text-sm bg-zinc-800 rounded border-none outline-none"
          >
            <option value="recent">Most Recent</option>
            <option value="amount">Highest Amount</option>
            <option value="risk">Highest Risk</option>
          </select>
          <button
            type="button"
            onClick={onRefresh}
            className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Approval List */}
      {sortedApprovals.length === 0 ? (
        <div className="p-8 text-center text-zinc-500">
          <p>No approvals found</p>
          {filter !== 'all' && (
            <button
              type="button"
              onClick={() => setFilter('all')}
              className="mt-2 text-sm text-emerald-500 hover:text-emerald-400"
            >
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {sortedApprovals.map((approval) => {
            const key = getKey(approval)
            const isSelected = selected.has(key)
            const isRevoking = revoking.has(key)

            return (
              <div
                key={key}
                className={`p-4 rounded-lg transition-colors ${
                  isSelected
                    ? 'bg-zinc-700 ring-1 ring-emerald-500'
                    : 'bg-zinc-800'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <button
                    type="button"
                    onClick={() => toggleSelect(approval)}
                    className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'bg-emerald-600 border-emerald-600'
                        : 'border-zinc-600 hover:border-zinc-500'
                    }`}
                  >
                    {isSelected && <span className="text-xs">✓</span>}
                  </button>

                  {/* Token Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">
                        {approval.token.symbol}
                      </span>
                      {approval.isUnlimited && (
                        <span className="px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                          Unlimited
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-400 truncate">
                      Spender:{' '}
                      {approval.spender.name ||
                        `${approval.spender.address.slice(0, 6)}...${approval.spender.address.slice(-4)}`}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <RiskBadge level={approval.spender.riskLevel} />
                      {approval.spender.isVerified && (
                        <span className="text-xs text-green-400">
                          ✓ Verified
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Allowance & Actions */}
                  <div className="text-right">
                    <p className="font-mono text-sm mb-2">
                      {approval.isUnlimited ? '∞' : approval.allowanceFormatted}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleRevoke(approval)}
                      disabled={isRevoking}
                      className={`px-3 py-1 text-sm rounded transition-colors ${
                        isRevoking
                          ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                          : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
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

/**
 * Build revoke transaction data
 */
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
