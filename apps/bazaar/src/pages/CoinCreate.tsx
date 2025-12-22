/**
 * Coin Create Page
 */

import { Link } from 'react-router-dom'

export default function CoinCreatePage() {
  return (
    <div className="max-w-xl mx-auto">
      <Link
        to="/coins"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Coins
      </Link>

      <h1
        className="text-2xl sm:text-3xl font-bold mb-6"
        style={{ color: 'var(--text-primary)' }}
      >
        🪙 Create Token
      </h1>

      <div className="card p-6">
        <form className="space-y-4">
          <div>
            <label
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Token Name
            </label>
            <input type="text" placeholder="My Token" className="input" />
          </div>

          <div>
            <label
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Symbol
            </label>
            <input type="text" placeholder="MTK" className="input" />
          </div>

          <div>
            <label
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Initial Supply
            </label>
            <input type="number" placeholder="1000000" className="input" />
          </div>

          <button type="submit" className="btn-primary w-full py-3">
            Create Token
          </button>
        </form>
      </div>
    </div>
  )
}
