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
      href={`/tokens/${JEJU_CHAIN_ID}/${address}`}
      className="p-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all hover:scale-105 cursor-pointer"
    >
      <div className="flex items-center gap-4 mb-4">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-2xl font-bold">
          {address.slice(2, 4).toUpperCase()}
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold mb-1">{address.slice(0, 6)}...{address.slice(-4)}</h3>
          <p className="text-sm text-slate-400">ERC20 Token</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-sm">
        <div>
          <p className="text-slate-400">Creator</p>
          <p className="font-mono">{creator.slice(0, 6)}...{creator.slice(-4)}</p>
        </div>
        <div className="text-right">
          <p className="text-slate-400">Created</p>
          <p>{new Date(createdAt).toLocaleDateString()}</p>
        </div>
      </div>
    </Link>
  )
}

export default function TokensPage() {
  const [filter, setFilter] = useState<'all' | 'verified' | 'new'>('all')

  const { data: tokens, isLoading, error } = useQuery({
    queryKey: ['jeju-tokens', filter],
    queryFn: () => getJejuTokens({ limit: 50 }),
    refetchInterval: 10000, // Refresh every 10 seconds
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-4xl font-bold mb-2">Tokens</h1>
          <p className="text-slate-400">Browse and trade tokens on Jeju and beyond</p>
        </div>
        <Link
          href="/tokens/create"
          className="px-6 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 font-semibold transition-all"
        >
          Create Token
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === 'all'
              ? 'bg-purple-600 text-white'
              : 'bg-white/5 text-slate-400 hover:bg-white/10'
          }`}
        >
          All Tokens
        </button>
        <button
          onClick={() => setFilter('verified')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === 'verified'
              ? 'bg-purple-600 text-white'
              : 'bg-white/5 text-slate-400 hover:bg-white/10'
          }`}
        >
          Verified
        </button>
        <button
          onClick={() => setFilter('new')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === 'new'
              ? 'bg-purple-600 text-white'
              : 'bg-white/5 text-slate-400 hover:bg-white/10'
          }`}
        >
          New
        </button>
      </div>

      {/* Token Grid */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {error && (
        <div className="p-6 rounded-lg bg-red-500/10 border border-red-500/50 text-red-200">
          <p className="font-semibold mb-2">Failed to load tokens</p>
          <p className="text-sm">{error.message}</p>
        </div>
      )}

      {tokens && tokens.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🪙</div>
          <h3 className="text-2xl font-semibold mb-2">No Tokens Yet</h3>
          <p className="text-slate-400 mb-6">Be the first to create a token on Jeju!</p>
          <Link
            href="/tokens/create"
            className="inline-block px-6 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 font-semibold transition-all"
          >
            Create First Token
          </Link>
        </div>
      )}

      {tokens && tokens.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {tokens.map((token) => (
            <TokenCard
              key={token.id}
              address={token.address}
              creator={token.creator.address}
              createdAt={token.firstSeenAt}
            />
          ))}
        </div>
      )}
    </div>
  )
}



