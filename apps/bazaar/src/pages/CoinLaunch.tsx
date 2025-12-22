/**
 * Token Launch Page
 */

import { Link } from 'react-router-dom'

export default function CoinLaunchPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <Link
        to="/coins"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Coins
      </Link>

      <h1
        className="text-2xl sm:text-3xl font-bold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        🚀 Launch Token
      </h1>
      <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
        Launch your token with a bonding curve
      </p>

      <div className="card p-6">
        <form className="space-y-4">
          <div>
            <label
              htmlFor="token-name"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Token Name
            </label>
            <input
              id="token-name"
              type="text"
              placeholder="My Token"
              className="input"
            />
          </div>

          <div>
            <label
              htmlFor="symbol"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Symbol
            </label>
            <input
              id="symbol"
              type="text"
              placeholder="MTK"
              className="input"
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Description
            </label>
            <textarea
              id="description"
              placeholder="Describe your token..."
              className="input min-h-[100px]"
            />
          </div>

          <div>
            <label
              htmlFor="initial-liquidity"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Initial Liquidity (ETH)
            </label>
            <input
              id="initial-liquidity"
              type="number"
              placeholder="0.1"
              step="0.01"
              className="input"
            />
          </div>

          <button type="submit" className="btn-primary w-full py-3">
            Launch Token
          </button>
        </form>
      </div>
    </div>
  )
}
