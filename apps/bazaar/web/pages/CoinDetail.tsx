/**
 * Coin Detail Page
 */

import { Link, useParams } from 'react-router-dom'

export default function CoinDetailPage() {
  const { chainId, address } = useParams<{ chainId: string; address: string }>()

  if (!chainId || !address) {
    return (
      <div className="text-center py-12">
        <p style={{ color: 'var(--text-secondary)' }}>Invalid token URL</p>
      </div>
    )
  }

  return (
    <div>
      <Link
        to="/coins"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Coins
      </Link>

      <div className="card p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-bazaar-primary to-bazaar-purple flex items-center justify-center text-2xl font-bold text-white">
            TK
          </div>
          <div>
            <h1
              className="text-2xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              Token
            </h1>
            <p
              className="text-sm font-mono"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {address.slice(0, 10)}...{address.slice(-8)}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Chain ID: {chainId}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div
            className="p-4 rounded-xl"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Price
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              $0.00
            </p>
          </div>
          <div
            className="p-4 rounded-xl"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Market Cap
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              $0
            </p>
          </div>
          <div
            className="p-4 rounded-xl"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              24h Volume
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              $0
            </p>
          </div>
          <div
            className="p-4 rounded-xl"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Holders
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              0
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
