import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatUnits } from 'viem'
import {
  fetchPredictionMarkets,
  type PredictionMarket,
} from '../../lib/data-client'
import { LoadingSpinner } from '../components/LoadingSpinner'
import {
  EmptyState,
  ErrorState,
  FilterTabs,
  Grid,
  PageHeader,
} from '../components/ui'

type FilterType = 'all' | 'active' | 'resolved'

const FILTER_OPTIONS = [
  { value: 'all' as const, label: 'All Markets' },
  { value: 'active' as const, label: 'Live', icon: '🟢' },
  { value: 'resolved' as const, label: 'Ended', icon: '✓' },
]

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
      className="group block animate-fade-in-up"
    >
      <article className="card p-5 h-full hover:scale-[1.02] transition-all duration-300">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-xl gradient-cool flex items-center justify-center text-white shrink-0"
            aria-hidden="true"
          >
            🔮
          </div>
          <h3 className="font-semibold text-primary line-clamp-2 leading-tight">
            {market.question}
          </h3>
        </div>

        {/* Probability Bar */}
        <div
          className="mb-4"
          role="img"
          aria-label={`Yes ${yesPercent}%, No ${noPercent}%`}
        >
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-success font-semibold">
              Yes {yesPercent}%
            </span>
            <span className="text-error font-semibold">No {noPercent}%</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden flex bg-surface-secondary">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-green-400 transition-all duration-500"
              style={{ width: `${yesPercent}%` }}
            />
            <div
              className="h-full bg-gradient-to-r from-red-400 to-red-500 transition-all duration-500"
              style={{ width: `${noPercent}%` }}
            />
          </div>
        </div>

        {/* Stats */}
        <dl className="flex items-center justify-between text-sm">
          <div>
            <dt className="text-tertiary">Volume</dt>
            <dd className="font-semibold text-primary">
              {formatVolume(market.totalVolume)}
            </dd>
          </div>
          <div className="text-right">
            <dt className="text-tertiary">Status</dt>
            <dd
              className={`font-semibold ${
                market.resolved ? 'text-tertiary' : 'text-info'
              }`}
            >
              {market.resolved ? 'Ended' : 'Live'}
            </dd>
          </div>
        </dl>
      </article>
    </Link>
  )
}

export default function MarketsPage() {
  const [filter, setFilter] = useState<FilterType>('all')
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

  const filteredMarkets = useMemo(() => {
    if (!markets) return []
    if (!searchQuery) return markets
    return markets.filter((m) =>
      m.question.toLowerCase().includes(searchQuery.toLowerCase()),
    )
  }, [markets, searchQuery])

  return (
    <div className="animate-fade-in">
      <PageHeader
        icon="🔮"
        title="Predictions"
        description="Bet on real-world outcomes and earn from your insights"
        action={{ label: 'Create Market', href: '/markets/create' }}
      />

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-tertiary">
            🔍
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search predictions..."
            className="input pl-11 w-full"
            aria-label="Search predictions"
          />
        </div>

        <FilterTabs
          options={FILTER_OPTIONS}
          value={filter}
          onChange={setFilter}
        />
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {/* Error State */}
      {error && (
        <ErrorState
          message={
            error instanceof Error ? error.message : 'Failed to load markets'
          }
          onRetry={() => refetch()}
        />
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredMarkets.length === 0 && (
        <EmptyState
          icon="🔮"
          title={searchQuery ? 'No Results Found' : 'No Markets Yet'}
          description={
            searchQuery
              ? 'Try adjusting your search terms or create a new market.'
              : 'Be the first to create a prediction market and challenge the community.'
          }
          action={
            !searchQuery
              ? { label: 'Create First Market', href: '/markets/create' }
              : undefined
          }
        />
      )}

      {/* Markets Grid */}
      {!isLoading && !error && filteredMarkets.length > 0 && (
        <Grid cols={3}>
          {filteredMarkets.map((market, index) => (
            <div key={market.id} className={`stagger-${(index % 6) + 1}`}>
              <MarketCard market={market} />
            </div>
          ))}
        </Grid>
      )}
    </div>
  )
}
