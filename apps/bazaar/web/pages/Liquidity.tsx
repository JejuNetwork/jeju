/**
 * Add Liquidity Page
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'

export default function LiquidityPage() {
  const [token0Amount, setToken0Amount] = useState('')
  const [token1Amount, setToken1Amount] = useState('')

  return (
    <div className="max-w-lg mx-auto">
      <Link
        to="/pools"
        className="text-sm mb-4 inline-block"
        style={{ color: 'var(--text-secondary)' }}
      >
        ← Back to Pools
      </Link>

      <h1
        className="text-2xl sm:text-3xl font-bold mb-6"
        style={{ color: 'var(--text-primary)' }}
      >
        💧 Add Liquidity
      </h1>

      <div className="card p-6">
        <div className="space-y-4">
          <div>
            <label
              htmlFor="token0-amount"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Token 1
            </label>
            <div className="flex gap-2">
              <input
                id="token0-amount"
                type="number"
                value={token0Amount}
                onChange={(e) => setToken0Amount(e.target.value)}
                placeholder="0.0"
                className="input flex-1"
              />
              <select className="input w-32">
                <option>ETH</option>
                <option>USDC</option>
                <option>JEJU</option>
              </select>
            </div>
          </div>

          <div className="flex justify-center">
            <div
              className="p-2 rounded-xl"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              +
            </div>
          </div>

          <div>
            <label
              htmlFor="token1-amount"
              className="text-sm block mb-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Token 2
            </label>
            <div className="flex gap-2">
              <input
                id="token1-amount"
                type="number"
                value={token1Amount}
                onChange={(e) => setToken1Amount(e.target.value)}
                placeholder="0.0"
                className="input flex-1"
              />
              <select className="input w-32">
                <option>USDC</option>
                <option>ETH</option>
                <option>JEJU</option>
              </select>
            </div>
          </div>

          <div
            className="p-4 rounded-xl"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex justify-between text-sm mb-2">
              <span style={{ color: 'var(--text-tertiary)' }}>Fee Tier</span>
              <span style={{ color: 'var(--text-primary)' }}>0.3%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--text-tertiary)' }}>
                Share of Pool
              </span>
              <span style={{ color: 'var(--text-primary)' }}>--%</span>
            </div>
          </div>

          <button type="button" className="btn-primary w-full py-3">
            Add Liquidity
          </button>
        </div>
      </div>
    </div>
  )
}
