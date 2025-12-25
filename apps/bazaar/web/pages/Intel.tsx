/**
 * Intel Page - AI-powered market analysis
 *
 * Market intelligence requires integration with data providers.
 * This page indicates that the feature is pending.
 */

import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function IntelPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          🔮 Intel
        </h1>
        <p
          className="text-sm sm:text-base"
          style={{ color: 'var(--text-secondary)' }}
        >
          AI-powered market intelligence and analysis
        </p>
      </div>

      <div className="card p-6 mb-6">
        <div className="text-center">
          <div className="text-5xl mb-4">🔧</div>
          <h3
            className="text-lg font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Data Integration Pending
          </h3>
          <p
            className="text-sm mb-4"
            style={{ color: 'var(--text-secondary)' }}
          >
            Market intelligence requires integration with on-chain analytics and
            social data providers. This feature is currently being developed.
          </p>
        </div>
      </div>

      <div className="card p-6">
        <h3
          className="text-lg font-semibold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Explore Markets
        </h3>
        <div className="space-y-3">
          <Link
            to="/charts"
            className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">📊</span>
              <div>
                <div
                  className="font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Charts
                </div>
                <div
                  className="text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  View token price charts
                </div>
              </div>
            </div>
            <ArrowRight
              className="h-5 w-5"
              style={{ color: 'var(--text-tertiary)' }}
            />
          </Link>

          <Link
            to="/coins"
            className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🪙</span>
              <div>
                <div
                  className="font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  Coins
                </div>
                <div
                  className="text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Browse tokens and their metrics
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
        </div>
      </div>
    </div>
  )
}
