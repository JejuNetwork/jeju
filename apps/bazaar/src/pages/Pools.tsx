/**
 * Pools Page - Re-exported from app directory
 * TODO: Migrate full logic from app/pools/page.tsx
 */

import { Link } from 'react-router-dom'

export default function PoolsPage() {
  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1
            className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
            style={{ color: 'var(--text-primary)' }}
          >
            💧 Pools
          </h1>
          <p
            className="text-sm sm:text-base"
            style={{ color: 'var(--text-secondary)' }}
          >
            Provide liquidity and earn fees on every trade
          </p>
        </div>
        <Link
          to="/liquidity"
          className="btn-primary w-full md:w-auto text-center"
        >
          Add Liquidity
        </Link>
      </div>

      <div className="card p-6 text-center">
        <div className="text-5xl mb-4">🏊</div>
        <h3
          className="text-lg font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Pools Coming Soon
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Uniswap V4 pools will be available shortly
        </p>
      </div>
    </div>
  )
}
