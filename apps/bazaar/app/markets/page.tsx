'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { fetchPredictionMarkets, type PredictionMarket } from '@/lib/data-client'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { formatUnits } from 'viem'

function formatVolume(volume: bigint): string {
  const n = Number(formatUnits(volume, 18))
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`
  return `$${n.toFixed(2)}`
}

function MarketCard({ market }: { market: PredictionMarket }) {
  const yesPercent = Math.round(market.yesPrice * 100)
  const noPercent = Math.round(market.noPrice * 100)

  return (
    <Link 
      href={`/markets/${market.id}`}
      className="card p-5 hover:scale-[1.02] transition-all"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white shrink-0">
          🔮
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold line-clamp-2 leading-tight" style={{ color: 'var(--text-primary)' }}>
            {market.question}
          </h3>
        </div>
      </div>

      {/* Probability Bars */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-green-400 font-semibold">Yes {yesPercent}%</span>
          <span className="text-red-400 font-semibold">No {noPercent}%</span>
        </div>
        <div className="h-3 rounded-full overflow-hidden flex" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          <div 
            className="h-full bg-gradient-to-r from-green-500 to-green-400"
            style={{ width: `${yesPercent}%` }}
          />
          <div 
            className="h-full bg-gradient-to-r from-red-400 to-red-500"
            style={{ width: `${noPercent}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-sm">
        <div>
          <p style={{ color: 'var(--text-tertiary)' }}>Volume</p>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatVolume(market.totalVolume)}
          </p>
        </div>
        <div className="text-right">
          {market.resolved ? (
            <>
              <p style={{ color: 'var(--text-tertiary)' }}>Outcome</p>
              <p className={`font-semibold ${market.outcome ? 'text-green-400' : 'text-red-400'}`}>
                {market.outcome ? 'Yes ✓' : 'No ✗'}
              </p>
            </>
          ) : (
            <>
              <p style={{ color: 'var(--text-tertiary)' }}>Status</p>
              <p className="font-semibold text-blue-400">Live</p>
            </>
          )}
        </div>
      </div>
    </Link>
  )
}

export default function MarketsPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const { data: markets, isLoading, error, refetch } = useQuery({
    queryKey: ['prediction-markets', filter],
    queryFn: () => fetchPredictionMarkets({
      limit: 50,
      resolved: filter === 'resolved' ? true : filter === 'active' ? false : undefined,
    }),
    refetchInterval: 15000,
    staleTime: 10000,
  })

  // Client-side search filter
  const filteredMarkets = markets?.filter(m =>
    searchQuery === '' || m.question.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
            🔮 Predictions
          </h1>
          <p className="text-sm sm:text-base" style={{ color: 'var(--text-secondary)' }}>
            Bet on real-world outcomes
          </p>
        </div>
        <Link href="/markets/create" className="btn-primary w-full md:w-auto text-center">
          Create Market
        </Link>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search predictions..."
          className="input flex-1"
        />
        
        <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide">
          {(['all', 'active', 'resolved'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                filter === f ? 'bg-bazaar-primary text-white' : ''
              }`}
              style={filter !== f ? { 
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-secondary)'
              } : undefined}
            >
              {f === 'all' ? 'All' : f === 'active' ? '🟢 Live' : '✓ Ended'}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="card p-6 border-red-500/30 bg-red-500/10">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div className="flex-1">
              <p className="font-semibold mb-1 text-red-400">Unable to load markets</p>
              <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                {error instanceof Error ? error.message : 'Network error'}
              </p>
              <button onClick={() => refetch()} className="btn-secondary text-sm">
                Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredMarkets?.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🔮</div>
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            {searchQuery ? 'No Matching Markets' : filter === 'active' ? 'No Live Markets' : filter === 'resolved' ? 'No Resolved Markets' : 'No Markets Yet'}
          </h3>
          <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {searchQuery 
              ? 'Try a different search term'
              : 'Create the first prediction market'}
          </p>
          {!searchQuery && filter === 'all' && (
            <Link href="/markets/create" className="btn-primary">
              Create First Market
            </Link>
          )}
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="btn-secondary">
              Clear Search
            </button>
          )}
        </div>
      )}

      {/* Markets Grid */}
      {!isLoading && !error && filteredMarkets && filteredMarkets.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMarkets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}

      {/* How It Works */}
      {!isLoading && !error && markets?.length === 0 && (
        <div className="card p-6 mt-8">
          <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            How Prediction Markets Work
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <div className="text-2xl mb-2">1️⃣</div>
              <p style={{ color: 'var(--text-primary)' }} className="font-medium mb-1">
                Choose a Market
              </p>
              <p style={{ color: 'var(--text-tertiary)' }}>
                Browse markets on topics you know about
              </p>
            </div>
            <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <div className="text-2xl mb-2">2️⃣</div>
              <p style={{ color: 'var(--text-primary)' }} className="font-medium mb-1">
                Buy Yes or No
              </p>
              <p style={{ color: 'var(--text-tertiary)' }}>
                Shares pay $1 if correct, $0 if wrong
              </p>
            </div>
            <div className="p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <div className="text-2xl mb-2">3️⃣</div>
              <p style={{ color: 'var(--text-primary)' }} className="font-medium mb-1">
                Win or Sell
              </p>
              <p style={{ color: 'var(--text-tertiary)' }}>
                Collect winnings or sell before resolution
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
