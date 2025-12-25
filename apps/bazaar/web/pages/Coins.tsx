/**
 * Coins Page
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatUnits } from 'viem'
import { fetchTokensWithMarketData, type Token } from '../../lib/data-client'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { JEJU_CHAIN_ID } from '../config/chains'

function formatNumber(num: number | bigint): string {
  const n = typeof num === 'bigint' ? Number(num) : num
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return n.toFixed(2)
}

function TokenCard({ token }: { token: Token }) {
  const initials = token.symbol.slice(0, 2).toUpperCase()
  const supplyFormatted = formatNumber(
    Number(formatUnits(token.totalSupply, token.decimals)),
  )

  return (
    <Link
      to={`/coins/${JEJU_CHAIN_ID}/${token.address}`}
      className="card p-5 group hover:scale-[1.02] transition-all"
    >
      <div className="flex items-center gap-3 mb-4">
        {token.logoUrl ? (
          <img
            src={token.logoUrl}
            alt={token.symbol}
            className="w-12 h-12 rounded-2xl"
          />
        ) : (
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-lg font-bold text-white group-hover:scale-110 transition-transform">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3
              className="text-lg font-semibold truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {token.name}
            </h3>
            {token.verified && <span className="text-blue-400 text-sm">✓</span>}
          </div>
          <p
            className="text-sm font-mono"
            style={{ color: 'var(--text-tertiary)' }}
          >
            ${token.symbol}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p style={{ color: 'var(--text-tertiary)' }}>Supply</p>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {supplyFormatted}
          </p>
        </div>
        <div>
          <p style={{ color: 'var(--text-tertiary)' }}>Holders</p>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {token.holders ? formatNumber(token.holders) : '—'}
          </p>
        </div>
      </div>
    </Link>
  )
}

export default function CoinsPage() {
  const [filter, setFilter] = useState<'all' | 'verified' | 'new'>('all')
  const [orderBy, setOrderBy] = useState<'volume' | 'recent' | 'holders'>(
    'recent',
  )

  const {
    data: tokens,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['tokens', filter, orderBy],
    queryFn: () =>
      fetchTokensWithMarketData({
        limit: 50,
        verified: filter === 'verified' ? true : undefined,
        orderBy,
      }),
    refetchInterval: 15000,
    staleTime: 10000,
  })

  const filteredTokens =
    filter === 'new' && tokens
      ? tokens.filter(
          (t) => t.createdAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        )
      : tokens

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1
            className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
            style={{ color: 'var(--text-primary)' }}
          >
            🪙 Coins
          </h1>
          <p
            className="text-sm sm:text-base"
            style={{ color: 'var(--text-secondary)' }}
          >
            Browse and trade tokens on the network
          </p>
        </div>
        <Link
          to="/coins/launch"
          className="btn-primary w-full md:w-auto text-center"
        >
          Create Token
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
          {(['all', 'verified', 'new'] as const).map((f) => (
            <button
              type="button"
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                filter === f ? 'bg-bazaar-primary text-white' : ''
              }`}
              style={
                filter !== f
                  ? {
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-secondary)',
                    }
                  : undefined
              }
            >
              {f === 'all' ? 'All' : f === 'verified' ? '✓ Verified' : '🆕 New'}
            </button>
          ))}
        </div>

        <div className="flex gap-2 sm:ml-auto">
          <select
            value={orderBy}
            onChange={(e) => setOrderBy(e.target.value as typeof orderBy)}
            className="input text-sm py-2"
          >
            <option value="recent">Most Recent</option>
            <option value="volume">Top Volume</option>
            <option value="holders">Most Holders</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {error && (
        <div className="card p-6 border-red-500/30 bg-red-500/10">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1">
              <p className="font-semibold mb-1 text-red-400">
                Unable to load tokens
              </p>
              <p
                className="text-sm mb-3"
                style={{ color: 'var(--text-secondary)' }}
              >
                {error instanceof Error ? error.message : 'Network error'}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="btn-secondary text-sm"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {!isLoading && !error && filteredTokens?.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🪙</div>
          <h3
            className="text-lg font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            No Tokens Yet
          </h3>
          <p
            className="mb-4 text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            Be the first to create a token on the network
          </p>
          <Link to="/coins/launch" className="btn-primary">
            Create First Token
          </Link>
        </div>
      )}

      {!isLoading && !error && filteredTokens && filteredTokens.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTokens.map((token) => (
            <TokenCard key={token.address} token={token} />
          ))}
        </div>
      )}
    </div>
  )
}
