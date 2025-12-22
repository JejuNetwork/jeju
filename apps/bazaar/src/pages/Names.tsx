/**
 * JNS Names Page
 */

import { useState } from 'react'
import { useAccount } from 'wagmi'

export default function NamesPage() {
  const { isConnected } = useAccount()
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-2xl sm:text-3xl md:text-4xl font-bold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          🏷️ Names
        </h1>
        <p
          className="text-sm sm:text-base"
          style={{ color: 'var(--text-secondary)' }}
        >
          Register your .jeju name
        </p>
      </div>

      <div className="max-w-xl mx-auto">
        <div className="card p-6 mb-6">
          <label
            className="text-sm block mb-2"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Search for a name
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="yourname"
              className="input flex-1"
            />
            <span
              className="flex items-center px-4 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              .jeju
            </span>
          </div>

          {searchQuery && (
            <div
              className="mt-4 p-4 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span
                  className="font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {searchQuery}.jeju
                </span>
                <span className="badge badge-success">Available</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text-tertiary)' }}>
                  Registration Fee
                </span>
                <span style={{ color: 'var(--text-primary)' }}>0.01 ETH</span>
              </div>
            </div>
          )}

          <button
            className="btn-primary w-full py-3 mt-4"
            disabled={!isConnected || !searchQuery}
          >
            {isConnected ? 'Register Name' : 'Connect Wallet to Register'}
          </button>
        </div>

        <div className="card p-5">
          <h3
            className="font-semibold mb-3"
            style={{ color: 'var(--text-primary)' }}
          >
            Your Names
          </h3>
          {isConnected ? (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              You don't own any .jeju names yet
            </p>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Connect your wallet to view your names
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
