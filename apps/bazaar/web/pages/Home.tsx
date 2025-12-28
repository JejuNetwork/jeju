import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { fetchMarketStats } from '../../lib/data-client'

const features = [
  { href: '/swap', icon: '🔄', title: 'Swap' },
  { href: '/pools', icon: '💧', title: 'Pools' },
  { href: '/perps', icon: '📈', title: 'Perps' },
  { href: '/coins', icon: '🪙', title: 'Coins' },
  { href: '/markets', icon: '🔮', title: 'Predictions' },
  { href: '/items', icon: '🖼️', title: 'Items' },
]

function formatVolume(value: number): string {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}

export default function HomePage() {
  const { isConnected } = useAccount()

  const { data: stats } = useQuery({
    queryKey: ['market-stats'],
    queryFn: () => fetchMarketStats(),
    staleTime: 60000,
    refetchInterval: 60000,
  })

  const quickStats = [
    { label: 'Total Volume', value: stats ? formatVolume(stats.totalVolumeUSD24h) : '—', icon: '📊' },
    { label: '24h Swaps', value: stats?.totalSwaps24h?.toLocaleString() ?? '—', icon: '🔄' },
    { label: 'Tokens', value: stats?.totalTokens?.toLocaleString() ?? '—', icon: '🪙' },
  ]

  return (
    <div className="min-h-[80vh] flex flex-col">
      {/* Hero Section */}
      <section className="text-center py-8 md:py-16 animate-fade-in">
        {/* Island emoji with float animation */}
        <div
          className="text-6xl md:text-8xl mb-6 animate-float"
          aria-hidden="true"
        >
          🏝️
        </div>

        {/* Main headline */}
        <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold mb-4">
          <span className="text-gradient">Bazaar</span>
        </h1>

        {/* Tagline */}
        <p className="text-lg sm:text-xl text-secondary max-w-lg mx-auto mb-8 px-4">
          Trade tokens, collectibles, and predictions
        </p>

        {/* CTA buttons */}
        <div className="flex gap-3 justify-center px-4">
          {isConnected ? (
            <>
              <Link to="/swap" className="btn-primary">
                Start Trading
              </Link>
              <Link to="/portfolio" className="btn-secondary">
                Portfolio
              </Link>
            </>
          ) : (
            <>
              <Link to="/coins" className="btn-primary">
                Explore
              </Link>
              <Link to="/markets" className="btn-secondary">
                Markets
              </Link>
            </>
          )}
        </div>
      </section>

      {/* Quick Stats */}
      <section className="py-8" aria-label="Platform statistics">
        <div className="flex flex-wrap justify-center gap-6 md:gap-12">
          {quickStats.map((stat, index) => (
            <div
              key={stat.label}
              className={`text-center animate-fade-in-up stagger-${index + 1}`}
            >
              <div className="text-3xl mb-1" aria-hidden="true">
                {stat.icon}
              </div>
              <div className="text-2xl md:text-3xl font-bold text-primary">
                {stat.value}
              </div>
              <div className="text-sm text-tertiary">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features Grid */}
      <section className="flex-1 py-8 md:py-12">
        <h2 className="sr-only">Features</h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 md:gap-4 max-w-4xl mx-auto px-4">
          {features.map((feature) => (
            <Link key={feature.href} to={feature.href} className="group">
              <div className="card p-4 text-center hover:scale-105 transition-all duration-200">
                <div className="text-3xl md:text-4xl mb-2 group-hover:scale-110 transition-transform">
                  {feature.icon}
                </div>
                <span className="text-sm font-semibold text-primary">
                  {feature.title}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-8 text-center">
        <div className="flex flex-wrap gap-3 justify-center">
          <Link to="/coins/launch" className="btn-primary">
            Launch a Token
          </Link>
          <Link to="/rewards" className="btn-secondary">
            Earn Rewards
          </Link>
        </div>
      </section>
    </div>
  )
}
