'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { getJejuTokens } from '@/lib/indexer-client'
import { JEJU_CHAIN_ID } from '@/config/chains'
import { LoadingSpinner } from '@/components/LoadingSpinner'

interface TokenCardProps {
  address: string
  creator: string
  createdAt: string
}

function TokenCard({ address, creator, createdAt }: TokenCardProps) {
  return (
    <Link
      href={`/coins/${JEJU_CHAIN_ID}/${address}`}
      className="card p-5 md:p-6 group"
    >
      <div className="flex items-center gap-3 md:gap-4 mb-4">
        <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-lg md:text-xl font-bold text-white group-hover:scale-110 transition-transform">
          {address.slice(2, 4).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base md:text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {address.slice(0, 6)}...{address.slice(-4)}
          </h3>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>ERC20 Coin</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div>
          <p style={{ color: 'var(--text-tertiary)' }}>Creator</p>
          <p className="font-mono text-xs md:text-sm" style={{ color: 'var(--text-secondary)' }}>
            {creator.slice(0, 6)}...{creator.slice(-4)}
          </p>
        </div>
        <div className="text-right">
          <p style={{ color: 'var(--text-tertiary)' }}>Created</p>
          <p style={{ color: 'var(--text-secondary)' }}>{new Date(createdAt).toLocaleDateString()}</p>
        </div>
      </div>
    </Link>
  )
}

export default function TokensPage() {
  const [filter, setFilter] = useState<'all' | 'verified' | 'new'>('all')

  const { data: coins, isLoading, error } = useQuery({
    queryKey: ['jeju-coins', filter],
    queryFn: () => getJejuTokens({ limit: 50 }),
    refetchInterval: 10000,
  })

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            🪙 Coins
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Browse and trade coins on Jeju and beyond</p>
        </div>
        <Link href="/coins/create" className="btn-primary w-full md:w-auto text-center">
          Create Coin
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2 md:gap-3 mb-6 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0">
        {(['all', 'verified', 'new'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              filter === f
                ? 'bg-bazaar-primary text-white'
                : 'hover:bg-[var(--bg-tertiary)]'
            }`}
            style={{ 
              backgroundColor: filter === f ? undefined : 'var(--bg-secondary)',
              color: filter === f ? undefined : 'var(--text-secondary)'
            }}
          >
            {f === 'all' ? 'All Coins' : f === 'verified' ? 'Verified' : 'New'}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="card p-6 border-bazaar-error/50 bg-bazaar-error/10">
          <p className="font-semibold mb-2 text-bazaar-error">Failed to load coins</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error.message}</p>
        </div>
      )}

      {/* Empty State */}
      {coins && coins.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl md:text-7xl mb-4">🪙</div>
          <h3 className="text-xl md:text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No Coins Yet
          </h3>
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            Be the first to create a coin on Jeju.
          </p>
          <Link href="/coins/create" className="btn-primary">
            Create First Coin
          </Link>
        </div>
      )}

      {/* Coins Grid */}
      {coins && coins.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {coins.map((coin) => (
            <TokenCard
              key={coin.id}
              address={coin.address}
              creator={coin.creator.address}
              createdAt={coin.firstSeenAt}
            />
          ))}
        </div>
      )}
    </div>
  )
}
