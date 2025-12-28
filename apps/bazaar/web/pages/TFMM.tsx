import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

const AVAILABLE_STRATEGIES = [
  {
    type: 'momentum',
    name: 'Momentum',
    description: 'Allocates more to assets with positive price momentum',
    color: 'purple',
  },
  {
    type: 'mean_reversion',
    name: 'Mean Reversion',
    description: 'Rebalances when assets deviate from historical averages',
    color: 'blue',
  },
  {
    type: 'trend_following',
    name: 'Trend Following',
    description: 'Follows medium-term price trends using moving averages',
    color: 'green',
  },
  {
    type: 'volatility_targeting',
    name: 'Volatility Targeting',
    description: 'Adjusts allocations to maintain target portfolio volatility',
    color: 'orange',
  },
]

export default function TFMMPage() {
  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          🎯 Smart Pools
        </h1>
        <p
          className="text-sm sm:text-base"
          style={{ color: 'var(--text-secondary)' }}
        >
          Auto-rebalancing pools powered by TFMM
        </p>
      </div>

      <div className="card p-6 border-purple-500/30 bg-gradient-to-r from-purple-500/10 to-blue-500/10 mb-6">
        <div className="flex items-start gap-4">
          <div className="text-3xl">🎯</div>
          <div>
            <h3
              className="font-semibold mb-1"
              style={{ color: 'var(--text-primary)' }}
            >
              Time-Weighted Function Market Maker
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Smart pools automatically adjust weights based on market trends,
              using Pyth, Chainlink, and TWAP oracles for optimal pricing.
            </p>
          </div>
        </div>
      </div>

      <div className="card p-6 mb-6">
        <div className="text-center">
          <div className="text-5xl mb-4">🔧</div>
          <h3
            className="text-lg font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Contracts Pending Deployment
          </h3>
          <p
            className="text-sm mb-4"
            style={{ color: 'var(--text-secondary)' }}
          >
            TFMM smart pool contracts are currently being audited and will be
            deployed soon.
          </p>
        </div>
      </div>

      <h2
        className="text-xl font-bold mb-4"
        style={{ color: 'var(--text-primary)' }}
      >
        Available Strategies
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {AVAILABLE_STRATEGIES.map((strategy) => (
          <div key={strategy.type} className="card p-5">
            <div className="flex items-start justify-between gap-2 mb-3">
              <h3
                className="font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {strategy.name}
              </h3>
              <span
                className={`px-2 py-0.5 rounded-full text-xs bg-${strategy.color}-500/20 text-${strategy.color}-400`}
              >
                {strategy.type}
              </span>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {strategy.description}
            </p>
          </div>
        ))}
      </div>

      <div className="card p-6">
        <h3
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Trade Now
        </h3>
        <div className="space-y-3">
          <Link
            to="/pools"
            className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">💧</span>
              <div>
                <div
                  className="font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Liquidity Pools
                </div>
                <div
                  className="text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Provide liquidity and earn fees
                </div>
              </div>
            </div>
            <ArrowRight
              className="h-5 w-5"
              style={{ color: 'var(--text-tertiary)' }}
            />
          </Link>

          <Link
            to="/swap"
            className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">💱</span>
              <div>
                <div
                  className="font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Swap
                </div>
                <div
                  className="text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Exchange tokens instantly
                </div>
              </div>
            </div>
            <ArrowRight
              className="h-5 w-5"
              style={{ color: 'var(--text-tertiary)' }}
            />
          </Link>
        </div>
      </div>
    </div>
  )
}
