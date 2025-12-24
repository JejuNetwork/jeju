/**
 * Market Detail Page
 */

import { Link, useParams } from 'react-router-dom'

export default function MarketDetailPage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        to="/markets"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Markets
      </Link>

      <div className="card p-6">
        <div className="mb-6">
          <span className="badge badge-info mb-2">Live</span>
          <h1
            className="text-2xl font-bold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            Market #{id}
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Will this prediction come true?
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            type="button"
            className="card p-4 text-center border-green-500/30 hover:bg-green-500/10"
          >
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Yes
            </p>
            <p className="text-2xl font-bold text-green-400">65%</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              $0.65
            </p>
          </button>
          <button
            type="button"
            className="card p-4 text-center border-red-500/30 hover:bg-red-500/10"
          >
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              No
            </p>
            <p className="text-2xl font-bold text-red-400">35%</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              $0.35
            </p>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="amount-input"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Amount (USDC)
            </label>
            <input
              id="amount-input"
              type="number"
              placeholder="10"
              className="input"
            />
          </div>

          <button type="button" className="btn-primary w-full py-3">
            Place Bet
          </button>
        </div>
      </div>
    </div>
  )
}
