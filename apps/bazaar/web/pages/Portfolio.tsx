/**
 * Portfolio Page
 */

import { useAccount } from 'wagmi'

export default function PortfolioPage() {
  const { address } = useAccount()

  if (!address) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="text-6xl mb-4">📊</div>
        <h1
          className="text-2xl font-bold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Portfolio
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Connect your wallet to view your portfolio
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          📊 Portfolio
        </h1>
        <p
          className="text-sm font-mono"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {address.slice(0, 10)}...{address.slice(-8)}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="card p-4">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Total Value
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            $0.00
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            24h Change
          </p>
          <p className="text-2xl font-bold text-gray-400">--</p>
        </div>
        <div className="card p-4">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Tokens
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            0
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            NFTs
          </p>
          <p
            className="text-2xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            0
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            🪙 Tokens
          </h2>
          <div className="text-center py-8">
            <div className="text-4xl mb-2">🪙</div>
            <p style={{ color: 'var(--text-tertiary)' }}>No tokens found</p>
          </div>
        </div>

        <div className="card p-5">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            🖼️ NFTs
          </h2>
          <div className="text-center py-8">
            <div className="text-4xl mb-2">🖼️</div>
            <p style={{ color: 'var(--text-tertiary)' }}>No NFTs found</p>
          </div>
        </div>
      </div>

      <div className="card p-5 mt-6">
        <h2
          className="text-lg font-bold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          📜 Recent Activity
        </h2>
        <div className="text-center py-8">
          <div className="text-4xl mb-2">📜</div>
          <p style={{ color: 'var(--text-tertiary)' }}>No recent activity</p>
        </div>
      </div>
    </div>
  )
}
