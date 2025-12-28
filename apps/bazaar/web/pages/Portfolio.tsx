import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { EmptyState, Grid, StatCard } from '../components/ui'

export default function PortfolioPage() {
  const { address } = useAccount()

  if (!address) {
    return (
      <EmptyState
        icon="📊"
        title="Portfolio"
        description="Connect your wallet to view your tokens, collectibles, and trading activity."
      />
    )
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gradient-warm flex items-center gap-3 mb-2">
          <span
            className="text-3xl md:text-4xl animate-bounce-subtle"
            aria-hidden="true"
          >
            📊
          </span>
          <span>Portfolio</span>
        </h1>
        <p className="text-sm font-mono text-tertiary">
          {address.slice(0, 10)}...{address.slice(-8)}
        </p>
      </header>

      {/* Stats Grid */}
      <Grid cols={4} className="mb-8">
        <StatCard icon="💰" label="Total Value" value="$0.00" />
        <StatCard
          icon="📈"
          label="24h Change"
          value="—"
          trend={{ value: '0%', positive: true }}
        />
        <StatCard icon="🪙" label="Tokens" value="0" />
        <StatCard icon="🖼️" label="Items" value="0" />
      </Grid>

      {/* Holdings Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Tokens */}
        <section className="card p-5">
          <header className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-primary flex items-center gap-2">
              <span aria-hidden="true">🪙</span>
              Tokens
            </h2>
            <Link
              to="/coins"
              className="text-sm text-primary-color hover:underline"
            >
              Browse →
            </Link>
          </header>
          <div className="text-center py-8">
            <div className="text-4xl mb-3 animate-float" aria-hidden="true">
              🪙
            </div>
            <p className="text-tertiary mb-4">No tokens found</p>
            <Link to="/swap" className="btn-secondary text-sm">
              Get Your First Token
            </Link>
          </div>
        </section>

        {/* Collectibles */}
        <section className="card p-5">
          <header className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-primary flex items-center gap-2">
              <span aria-hidden="true">🖼️</span>
              Collectibles
            </h2>
            <Link
              to="/items"
              className="text-sm text-primary-color hover:underline"
            >
              Browse →
            </Link>
          </header>
          <div className="text-center py-8">
            <div className="text-4xl mb-3 animate-float" aria-hidden="true">
              🖼️
            </div>
            <p className="text-tertiary mb-4">No collectibles found</p>
            <Link to="/items" className="btn-secondary text-sm">
              Explore Items
            </Link>
          </div>
        </section>
      </div>

      {/* Recent Activity */}
      <section className="card p-5">
        <header className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-primary flex items-center gap-2">
            <span aria-hidden="true">📜</span>
            Recent Activity
          </h2>
        </header>
        <div className="text-center py-8">
          <div className="text-4xl mb-3 animate-float" aria-hidden="true">
            📜
          </div>
          <p className="text-tertiary">No recent activity</p>
        </div>
      </section>
    </div>
  )
}
