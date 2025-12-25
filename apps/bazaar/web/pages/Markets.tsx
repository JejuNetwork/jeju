/**
 * Prediction Markets Page
 */

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatUnits } from 'viem'
import {
  fetchPredictionMarkets,
  type PredictionMarket,
} from '../../lib/data-client'
import { LoadingSpinner } from '../components/LoadingSpinner'

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
      to={`/markets/${market.id}`}
      className="card p-5 hover:scale-[1.02] transition-all"
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white shrink-0">
          🔮
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className="font-semibold line-clamp-2 leading-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            {market.question}
          </h3>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-green-400 font-semibold">
            Yes {yesPercent}%
          </span>
          <span className="text-red-400 font-semibold">No {noPercent}%</span>
        </div>
        <div
          className="h-3 rounded-full overflow-hidden flex"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
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

      <div className="flex items-center justify-between text-sm">
        <div>
          <p style={{ color: 'var(--text-tertiary)' }}>Volume</p>
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {formatVolume(market.totalVolume)}
          </p>
        </div>
        <div className="text-right">
          <p style={{ color: 'var(--text-tertiary)' }}>Status</p>
          <p
            className={`font-semibold ${market.resolved ? 'text-gray-400' : 'text-blue-400'}`}
          >
            {market.resolved ? 'Ended' : 'Live'}
          </p>
        </div>
      </div>
    </Link>
  )
}

export default function MarketsPage() {
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const {
    data: markets,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['prediction-markets', filter],
    queryFn: () =>
      fetchPredictionMarkets({
        limit: 50,
        resolved:
          filter === 'resolved'
            ? true
            : filter === 'active'
              ? false
              : undefined,
      }),
    refetchInterval: 15000,
    staleTime: 10000,
  })

  const filteredMarkets = markets?.filter(
    (m) =>
      searchQuery === '' ||
      m.question.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1
            className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
            style={{ color: 'var(--text-primary)' }}
          >
            🔮 Predictions
          </h1>
          <p
            className="text-sm sm:text-base"
            style={{ color: 'var(--text-secondary)' }}
          >
            Bet on real-world outcomes
          </p>
        </div>
        <Link
          to="/markets/create"
          className="btn-primary w-full md:w-auto text-center"
        >
          Create Market
        </Link>
      </div>

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
              {f === 'all' ? 'All' : f === 'active' ? '🟢 Live' : '✓ Ended'}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {error && (
        <div className="card p-6 border-red-500/30 bg-red-500/10">
          <p className="font-semibold mb-1 text-red-400">
            Unable to load markets
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="btn-secondary text-sm"
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !error && filteredMarkets?.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🔮</div>
          <h3
            className="text-lg font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            No Markets Yet
          </h3>
          <p
            className="mb-4 text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            Create the first prediction market
          </p>
        </div>
      )}

      {!isLoading &&
        !error &&
        filteredMarkets &&
        filteredMarkets.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMarkets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
        )}
    </div>
  )
}
