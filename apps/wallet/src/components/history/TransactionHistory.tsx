/**
 * Transaction History Component
 * Full transaction history with filtering and details
 */

import type React from 'react'
import { useMemo, useState } from 'react'
import type { Address, Hex } from 'viem'

export interface Transaction {
  hash: Hex
  from: Address
  to: Address | null
  value: bigint
  valueFormatted: string
  valueUsd?: number
  status: 'pending' | 'success' | 'failed'
  timestamp: number
  blockNumber?: number
  gasUsed?: bigint
  gasCost?: bigint
  gasCostUsd?: number
  chainId: number
  chainName: string
  type: 'send' | 'receive' | 'swap' | 'approve' | 'contract' | 'mint' | 'bridge'
  token?: {
    address: Address
    symbol: string
    name: string
    decimals: number
    logoUrl?: string
  }
  nft?: {
    address: Address
    name: string
    tokenId: string
    imageUrl?: string
  }
  method?: string
  explorerUrl: string
}

interface TransactionHistoryProps {
  transactions: Transaction[]
  loading?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  onTransactionClick?: (tx: Transaction) => void
  userAddress: Address
}

const StatusBadge: React.FC<{ status: Transaction['status'] }> = ({
  status,
}) => {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    success: 'bg-green-500/20 text-green-400',
    failed: 'bg-red-500/20 text-red-400',
  }

  const icons: Record<string, string> = {
    pending: '⏳',
    success: '✓',
    failed: '✗',
  }

  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded ${styles[status]}`}
    >
      {icons[status]} {status}
    </span>
  )
}

const TypeIcon: React.FC<{
  type: Transaction['type']
  isOutgoing: boolean
}> = ({ type, isOutgoing }) => {
  const icons: Record<string, string> = {
    send: '↑',
    receive: '↓',
    swap: '⇄',
    approve: '✓',
    contract: '📄',
    mint: '✨',
    bridge: '🌉',
  }

  const colors: Record<string, string> = {
    send: 'text-red-400',
    receive: 'text-green-400',
    swap: 'text-blue-400',
    approve: 'text-yellow-400',
    contract: 'text-purple-400',
    mint: 'text-pink-400',
    bridge: 'text-cyan-400',
  }

  return (
    <div
      className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${
        type === 'send' || type === 'receive'
          ? isOutgoing
            ? 'bg-red-500/20'
            : 'bg-green-500/20'
          : 'bg-zinc-700'
      }`}
    >
      <span className={colors[type]}>{icons[type]}</span>
    </div>
  )
}

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // Less than 1 minute
  if (diff < 60000) return 'Just now'
  // Less than 1 hour
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  // Less than 24 hours
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  // Less than 7 days
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`

  return date.toLocaleDateString()
}

const formatAmount = (
  value: string,
  type: Transaction['type'],
  isOutgoing: boolean,
): string => {
  if (type === 'approve') return ''
  const prefix = isOutgoing ? '-' : '+'
  return `${prefix}${value}`
}

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  transactions,
  loading,
  hasMore,
  onLoadMore,
  onTransactionClick,
  userAddress,
}) => {
  const [filter, setFilter] = useState<
    'all' | 'sent' | 'received' | 'swaps' | 'approvals'
  >('all')
  const [chainFilter, setChainFilter] = useState<number | 'all'>('all')

  // Get unique chains
  const chains = useMemo(() => {
    const chainMap = new Map<number, string>()
    for (const tx of transactions) {
      chainMap.set(tx.chainId, tx.chainName)
    }
    return Array.from(chainMap.entries())
  }, [transactions])

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // Chain filter
      if (chainFilter !== 'all' && tx.chainId !== chainFilter) return false

      // Type filter
      const isOutgoing = tx.from.toLowerCase() === userAddress.toLowerCase()

      switch (filter) {
        case 'sent':
          return isOutgoing && (tx.type === 'send' || tx.type === 'bridge')
        case 'received':
          return !isOutgoing && (tx.type === 'send' || tx.type === 'receive')
        case 'swaps':
          return tx.type === 'swap'
        case 'approvals':
          return tx.type === 'approve'
        default:
          return true
      }
    })
  }, [transactions, filter, chainFilter, userAddress])

  // Group by date
  const groupedTransactions = useMemo(() => {
    const groups: Map<string, Transaction[]> = new Map()

    for (const tx of filteredTransactions) {
      const date = new Date(tx.timestamp)
      const key = date.toDateString()

      const existing = groups.get(key)
      if (existing) {
        existing.push(tx)
      } else {
        groups.set(key, [tx])
      }
    }

    return groups
  }, [filteredTransactions])

  if (loading && transactions.length === 0) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
        <span className="ml-3 text-zinc-400">Loading transactions...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex gap-1 bg-zinc-800 p-1 rounded-lg">
          {(['all', 'sent', 'received', 'swaps', 'approvals'] as const).map(
            (f) => (
              <button
                type="button"
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-sm rounded transition-colors ${
                  filter === f ? 'bg-emerald-600' : 'hover:bg-zinc-700'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ),
          )}
        </div>

        {chains.length > 1 && (
          <select
            value={chainFilter}
            onChange={(e) =>
              setChainFilter(
                e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10),
              )
            }
            className="px-3 py-1.5 text-sm bg-zinc-800 rounded-lg border-none outline-none"
          >
            <option value="all">All Chains</option>
            {chains.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Transaction List */}
      {filteredTransactions.length === 0 ? (
        <div className="p-8 text-center text-zinc-500">
          <p>No transactions found</p>
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
        <div className="space-y-6">
          {Array.from(groupedTransactions.entries()).map(([date, txs]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-zinc-400 mb-2">{date}</h3>
              <div className="space-y-2">
                {txs.map((tx) => {
                  const isOutgoing =
                    tx.from.toLowerCase() === userAddress.toLowerCase()

                  return (
                    <button
                      type="button"
                      key={tx.hash}
                      onClick={() => onTransactionClick?.(tx)}
                      className="w-full p-4 bg-zinc-800 hover:bg-zinc-750 rounded-lg transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <TypeIcon type={tx.type} isOutgoing={isOutgoing} />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium capitalize">
                              {tx.type}
                            </span>
                            <StatusBadge status={tx.status} />
                            <span className="text-xs text-zinc-500">
                              {tx.chainName}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-sm text-zinc-400">
                            {tx.type === 'approve' ? (
                              <span>
                                {tx.token?.symbol || 'Token'} →{' '}
                                {tx.to?.slice(0, 6)}...{tx.to?.slice(-4)}
                              </span>
                            ) : tx.nft ? (
                              <span>
                                {tx.nft.name} #{tx.nft.tokenId}
                              </span>
                            ) : (
                              <span>
                                {isOutgoing ? 'To: ' : 'From: '}
                                {isOutgoing
                                  ? `${tx.to?.slice(0, 6)}...${tx.to?.slice(-4)}`
                                  : `${tx.from.slice(0, 6)}...${tx.from.slice(-4)}`}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right">
                          {tx.type !== 'approve' && (
                            <>
                              <p
                                className={`font-medium ${isOutgoing ? 'text-red-400' : 'text-green-400'}`}
                              >
                                {formatAmount(
                                  tx.valueFormatted,
                                  tx.type,
                                  isOutgoing,
                                )}{' '}
                                {tx.token?.symbol || 'ETH'}
                              </p>
                              {tx.valueUsd !== undefined && (
                                <p className="text-xs text-zinc-500">
                                  ${tx.valueUsd.toFixed(2)}
                                </p>
                              )}
                            </>
                          )}
                          <p className="text-xs text-zinc-500 mt-1">
                            {formatDate(tx.timestamp)}
                          </p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load More */}
      {hasMore && (
        <div className="text-center py-4">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  )
}

export default TransactionHistory
