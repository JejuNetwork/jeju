/**
 * Perpetuals Page
 *
 * Perpetual trading is not yet available as contracts are pending deployment.
 * This page shows the current status and links to other trading options.
 */

import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function PerpsPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          📈 Perpetuals
        </h1>
        <p
          className="text-sm sm:text-base"
          style={{ color: 'var(--text-secondary)' }}
        >
          Trade perpetual futures with up to 50x leverage
        </p>
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
            Perpetual trading contracts are currently being audited and will be
            deployed soon.
          </p>
        </div>
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

          <Link
            to="/markets"
            className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🎯</span>
              <div>
                <div
                  className="font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Prediction Markets
                </div>
                <div
                  className="text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Trade on outcomes
                </div>
              </div>
            </div>
            <ArrowRight
              className="h-5 w-5"
              style={{ color: 'var(--text-tertiary)' }}
            />
          </Link>

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
        </div>
      </div>
    </div>
  )
}
