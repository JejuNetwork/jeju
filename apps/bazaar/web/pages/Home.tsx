import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { type Address, formatUnits } from 'viem'
import { useAccount } from 'wagmi'
import {
  fetchMarketStats,
  fetchNewTokens,
  fetchPredictionMarkets,
  fetchTopGainers,
  fetchTopLosers,
  fetchTrendingTokens,
  type PredictionMarket,
  type Token,
} from '../../lib/data-client'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { JEJU_CHAIN_ID } from '../config/chains'

function formatPrice(price: number | undefined): string {
  if (!price) return '$0.00'
  if (price < 0.0001) return `$${price.toExponential(2)}`
  if (price < 1) return `$${price.toFixed(4)}`
  if (price < 1000) return `$${price.toFixed(2)}`
  return `$${(price / 1000).toFixed(1)}K`
}

function formatVolume(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}

function formatChange(change: number | undefined): string {
  if (!change) return '0.0%'
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(1)}%`
}

function formatTimeAgo(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true })
}

// Token row for trending/gainers/losers
function TokenRow({
  token,
  rank,
  showChange = true,
}: {
  token: Token
  rank?: number
  showChange?: boolean
}) {
  const change = token.priceChange24h
  const isPositive = (change ?? 0) >= 0
  const initials = token.symbol.slice(0, 2).toUpperCase()

  return (
    <Link
      to={`/coins/${JEJU_CHAIN_ID}/${token.address}`}
      className="group flex items-center gap-3 p-3 rounded-xl hover:bg-surface-secondary/50 transition-all duration-200"
    >
      {rank && (
        <span className="w-6 text-center text-sm font-mono text-tertiary">
          {rank}
        </span>
      )}

      {token.logoUrl ? (
        <img
          src={token.logoUrl}
          alt=""
          className="w-9 h-9 rounded-xl shrink-0"
        />
      ) : (
        <div className="w-9 h-9 rounded-xl gradient-warm flex items-center justify-center text-xs font-bold text-white shrink-0">
          {initials}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-primary truncate">
            {token.symbol}
          </span>
          {token.verified && <span className="text-blue-400 text-xs">✓</span>}
        </div>
        <span className="text-xs text-tertiary truncate block">
          {token.name}
        </span>
      </div>

      <div className="text-right">
        <div className="font-mono text-sm text-primary">
          {formatPrice(token.priceUSD)}
        </div>
        {showChange && (
          <div
            className={`text-xs font-semibold ${
              isPositive ? 'text-success' : 'text-error'
            }`}
          >
            {formatChange(change)}
          </div>
        )}
      </div>
    </Link>
  )
}

// Mini market card for predictions
function MarketCard({ market }: { market: PredictionMarket }) {
  const yesPercent = Math.round(market.yesPrice * 100)

  return (
    <Link to={`/markets/${market.id}`} className="group block">
      <div className="card-static p-4 hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-0.5 transition-all duration-200">
        <p className="text-sm font-medium text-primary line-clamp-2 mb-3 min-h-[2.5rem]">
          {market.question}
        </p>

        {/* Compact probability bar */}
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 h-2 rounded-full overflow-hidden bg-surface-secondary">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-green-400"
              style={{ width: `${yesPercent}%` }}
            />
          </div>
          <span className="text-xs font-bold text-success w-10 text-right">
            {yesPercent}%
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-tertiary">
          <span>
            Vol: {formatVolume(Number(formatUnits(market.totalVolume, 18)))}
          </span>
          <span className={market.resolved ? 'text-tertiary' : 'text-success'}>
            {market.resolved ? 'Ended' : '● Live'}
          </span>
        </div>
      </div>
    </Link>
  )
}

// New token launch card
function LaunchCard({ token }: { token: Token }) {
  const initials = token.symbol.slice(0, 2).toUpperCase()

  return (
    <Link
      to={`/coins/${JEJU_CHAIN_ID}/${token.address}`}
      className="group flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] hover:border-[var(--color-accent)] hover:bg-surface-secondary/30 transition-all duration-200"
    >
      {token.logoUrl ? (
        <img
          src={token.logoUrl}
          alt=""
          className="w-10 h-10 rounded-xl shrink-0"
        />
      ) : (
        <div className="w-10 h-10 rounded-xl gradient-cool flex items-center justify-center text-sm font-bold text-white shrink-0">
          {initials}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-primary truncate">
            {token.symbol}
          </span>
          <span className="badge-info text-[10px] px-1.5 py-0.5">NEW</span>
        </div>
        <span className="text-xs text-tertiary">
          {formatTimeAgo(token.createdAt)}
        </span>
      </div>

      <div className="text-right text-xs text-tertiary">
        {token.holders ? `${token.holders} holders` : ''}
      </div>
    </Link>
  )
}

// Quick swap widget
function QuickSwapWidget() {
  const navigate = useNavigate()
  const [amount, setAmount] = useState('')

  const handleSwap = () => {
    navigate('/swap')
  }

  return (
    <div className="card-static p-4 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-2xl">⚡</span>
        <h3 className="font-semibold text-primary">Quick Swap</h3>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 p-3 rounded-xl bg-surface-secondary">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1 bg-transparent text-lg font-mono text-primary focus:outline-none"
          />
          <button
            type="button"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-elevated transition-colors"
          >
            <span className="text-lg">Ξ</span>
            <span className="font-semibold text-sm">ETH</span>
          </button>
        </div>

        <button
          type="button"
          onClick={handleSwap}
          className="btn-primary w-full"
        >
          Swap Now
        </button>
      </div>
    </div>
  )
}

// Activity feed item
interface Activity {
  type: 'swap' | 'launch' | 'bet'
  token?: string
  amount?: string
  time: Date
  address: Address
}

function ActivityFeed({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-tertiary">
        <span className="text-3xl mb-2 block">📡</span>
        <p className="text-sm">Waiting for activity...</p>
      </div>
    )
  }

  return (
    <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-hide">
      {activities.map((activity, idx) => (
        <div
          key={idx}
          className="flex items-center gap-3 p-2 rounded-lg text-sm animate-fade-in-up"
          style={{ animationDelay: `${idx * 50}ms` }}
        >
          <span className="text-lg shrink-0">
            {activity.type === 'swap' && '🔄'}
            {activity.type === 'launch' && '🚀'}
            {activity.type === 'bet' && '🎲'}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-primary font-medium">
              {activity.address.slice(0, 6)}...{activity.address.slice(-4)}
            </span>
            <span className="text-tertiary">
              {activity.type === 'swap' && ` swapped ${activity.amount}`}
              {activity.type === 'launch' && ` launched ${activity.token}`}
              {activity.type === 'bet' && ` bet on ${activity.token}`}
            </span>
          </div>
          <span className="text-xs text-tertiary shrink-0">
            {formatTimeAgo(activity.time)}
          </span>
        </div>
      ))}
    </div>
  )
}

// Stats bar
function StatsBar({
  stats,
}: {
  stats:
    | {
        totalVolumeUSD24h: number
        totalSwaps24h: number
        totalTokens: number
        totalPools: number
      }
    | undefined
}) {
  const statItems = [
    {
      label: '24h Volume',
      value: stats ? formatVolume(stats.totalVolumeUSD24h) : '—',
      icon: '📊',
    },
    {
      label: '24h Trades',
      value: stats?.totalSwaps24h?.toLocaleString() ?? '—',
      icon: '⚡',
    },
    {
      label: 'Tokens',
      value: stats?.totalTokens?.toLocaleString() ?? '—',
      icon: '🪙',
    },
    {
      label: 'Pools',
      value: stats?.totalPools?.toLocaleString() ?? '—',
      icon: '💧',
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {statItems.map((stat) => (
        <div key={stat.label} className="card-static p-4 text-center">
          <span className="text-2xl mb-1 block">{stat.icon}</span>
          <div className="text-xl md:text-2xl font-bold text-primary">
            {stat.value}
          </div>
          <div className="text-xs text-tertiary">{stat.label}</div>
        </div>
      ))}
    </div>
  )
}

// Tab selector for token views
function TokenTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: 'trending' | 'gainers' | 'losers'
  onTabChange: (tab: 'trending' | 'gainers' | 'losers') => void
}) {
  const tabs = [
    { id: 'trending' as const, label: '🔥 Hot' },
    { id: 'gainers' as const, label: '📈 Gainers' },
    { id: 'losers' as const, label: '📉 Losers' },
  ]

  return (
    <div className="flex gap-1 p-1 rounded-xl bg-surface-secondary">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
            activeTab === tab.id
              ? 'bg-surface text-primary shadow-sm'
              : 'text-tertiary hover:text-secondary'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export default function HomePage() {
  const { isConnected } = useAccount()
  const [tokenTab, setTokenTab] = useState<'trending' | 'gainers' | 'losers'>(
    'trending',
  )

  // Fetch market stats
  const { data: stats } = useQuery({
    queryKey: ['market-stats'],
    queryFn: () => fetchMarketStats(),
    staleTime: 30000,
    refetchInterval: 30000,
  })

  // Fetch trending tokens
  const { data: trendingTokens, isLoading: loadingTrending } = useQuery({
    queryKey: ['trending-tokens'],
    queryFn: () => fetchTrendingTokens({ limit: 10 }),
    staleTime: 15000,
    refetchInterval: 15000,
  })

  // Fetch top gainers
  const { data: gainers, isLoading: loadingGainers } = useQuery({
    queryKey: ['top-gainers'],
    queryFn: () => fetchTopGainers({ limit: 10 }),
    staleTime: 15000,
    refetchInterval: 15000,
  })

  // Fetch top losers
  const { data: losers, isLoading: loadingLosers } = useQuery({
    queryKey: ['top-losers'],
    queryFn: () => fetchTopLosers({ limit: 10 }),
    staleTime: 15000,
    refetchInterval: 15000,
  })

  // Fetch new tokens
  const { data: newTokens, isLoading: loadingNew } = useQuery({
    queryKey: ['new-tokens'],
    queryFn: () => fetchNewTokens({ limit: 6, hours: 24 }),
    staleTime: 30000,
    refetchInterval: 30000,
  })

  // Fetch prediction markets
  const { data: markets, isLoading: loadingMarkets } = useQuery({
    queryKey: ['prediction-markets-home'],
    queryFn: () => fetchPredictionMarkets({ limit: 6, resolved: false }),
    staleTime: 15000,
    refetchInterval: 15000,
  })

  // Get active token list based on tab
  const activeTokens =
    tokenTab === 'trending'
      ? trendingTokens
      : tokenTab === 'gainers'
        ? gainers
        : losers
  const isLoadingTokens =
    tokenTab === 'trending'
      ? loadingTrending
      : tokenTab === 'gainers'
        ? loadingGainers
        : loadingLosers

  // Mock activity for now - would be real websocket data
  const mockActivities: Activity[] = []

  return (
    <div className="animate-fade-in space-y-8 pb-8">
      {/* Hero Section - Compact */}
      <section className="text-center py-6">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-secondary text-sm mb-4 animate-fade-in-up">
          <span className="animate-pulse-soft">🟢</span>
          <span className="text-secondary">Live on Jeju Network</span>
        </div>

        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-3">
          <span className="text-gradient">Trade Everything</span>
        </h1>
        <p className="text-secondary max-w-md mx-auto mb-6">
          Tokens, predictions, and collectibles — all in one place
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap gap-3 justify-center">
          {isConnected ? (
            <>
              <Link to="/swap" className="btn-primary">
                Start Trading
              </Link>
              <Link to="/coins/launch" className="btn-accent">
                Launch Token
              </Link>
            </>
          ) : (
            <>
              <Link to="/coins" className="btn-primary">
                Explore Tokens
              </Link>
              <Link to="/markets" className="btn-secondary">
                Predictions
              </Link>
            </>
          )}
        </div>
      </section>

      {/* Stats Bar */}
      <StatsBar stats={stats} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Tokens */}
        <div className="lg:col-span-2 space-y-6">
          {/* Token Tabs */}
          <div className="card-static p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-primary">Tokens</h2>
              <Link
                to="/coins"
                className="text-sm text-secondary hover:text-primary transition-colors"
              >
                View All →
              </Link>
            </div>

            <TokenTabs activeTab={tokenTab} onTabChange={setTokenTab} />

            <div className="mt-4 -mx-3">
              {isLoadingTokens ? (
                <div className="flex justify-center py-12">
                  <LoadingSpinner size="md" />
                </div>
              ) : activeTokens && activeTokens.length > 0 ? (
                <div className="divide-y divide-[var(--border)]">
                  {activeTokens.slice(0, 8).map((token, idx) => (
                    <TokenRow
                      key={token.address}
                      token={token}
                      rank={idx + 1}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-tertiary">
                  <span className="text-3xl mb-2 block">🪙</span>
                  <p>No tokens found</p>
                </div>
              )}
            </div>
          </div>

          {/* Prediction Markets */}
          <div className="card-static p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔮</span>
                <h2 className="text-lg font-semibold text-primary">
                  Predictions
                </h2>
              </div>
              <Link
                to="/markets"
                className="text-sm text-secondary hover:text-primary transition-colors"
              >
                View All →
              </Link>
            </div>

            {loadingMarkets ? (
              <div className="flex justify-center py-12">
                <LoadingSpinner size="md" />
              </div>
            ) : markets && markets.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {markets.slice(0, 4).map((market) => (
                  <MarketCard key={market.id} market={market} />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-tertiary">
                <span className="text-3xl mb-2 block">🔮</span>
                <p className="mb-4">No active markets</p>
                <Link to="/markets/create" className="btn-secondary text-sm">
                  Create First Market
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Quick Swap */}
          <QuickSwapWidget />

          {/* New Launches */}
          <div className="card-static p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-xl">🚀</span>
                <h2 className="text-lg font-semibold text-primary">
                  New Launches
                </h2>
              </div>
              <Link
                to="/coins?filter=new"
                className="text-sm text-secondary hover:text-primary transition-colors"
              >
                All →
              </Link>
            </div>

            {loadingNew ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner size="sm" />
              </div>
            ) : newTokens && newTokens.length > 0 ? (
              <div className="space-y-2">
                {newTokens.slice(0, 5).map((token) => (
                  <LaunchCard key={token.address} token={token} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-tertiary">
                <span className="text-2xl mb-2 block">🌱</span>
                <p className="text-sm mb-3">No recent launches</p>
                <Link
                  to="/coins/launch"
                  className="text-sm text-[var(--color-primary)] hover:underline"
                >
                  Be the first →
                </Link>
              </div>
            )}
          </div>

          {/* Live Activity */}
          <div className="card-static p-4 md:p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">⚡</span>
              <h2 className="text-lg font-semibold text-primary">Activity</h2>
              <span className="w-2 h-2 rounded-full bg-success animate-pulse-soft" />
            </div>

            <ActivityFeed activities={mockActivities} />
          </div>

          {/* Quick Actions */}
          <div className="card-static p-4 md:p-6">
            <h3 className="font-semibold text-primary mb-4">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <Link
                to="/coins/launch"
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-colors text-center group"
              >
                <span className="text-2xl group-hover:scale-110 transition-transform">
                  🚀
                </span>
                <span className="text-sm font-medium text-primary">
                  Launch Token
                </span>
              </Link>
              <Link
                to="/markets/create"
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-colors text-center group"
              >
                <span className="text-2xl group-hover:scale-110 transition-transform">
                  🔮
                </span>
                <span className="text-sm font-medium text-primary">
                  Create Market
                </span>
              </Link>
              <Link
                to="/items/mint"
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-colors text-center group"
              >
                <span className="text-2xl group-hover:scale-110 transition-transform">
                  🖼️
                </span>
                <span className="text-sm font-medium text-primary">
                  Mint NFT
                </span>
              </Link>
              <Link
                to="/portfolio"
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-colors text-center group"
              >
                <span className="text-2xl group-hover:scale-110 transition-transform">
                  💼
                </span>
                <span className="text-sm font-medium text-primary">
                  Portfolio
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <section className="text-center py-8">
        <div className="inline-block p-6 md:p-8 rounded-2xl bg-gradient-to-br from-[var(--color-primary)]/10 via-[var(--color-purple)]/10 to-[var(--color-accent)]/10 border border-[var(--border)]">
          <h2 className="text-2xl font-bold text-primary mb-2">
            Ready to trade?
          </h2>
          <p className="text-secondary mb-4">
            Join the decentralized marketplace
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/swap" className="btn-primary">
              Swap Tokens
            </Link>
            <Link to="/rewards" className="btn-secondary">
              Earn Rewards
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
