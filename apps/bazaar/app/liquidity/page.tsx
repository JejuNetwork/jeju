'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { hasV4Periphery } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'

export default function LiquidityPage() {
  const { isConnected, chain } = useAccount()
  const [token0Amount, setToken0Amount] = useState('')
  const [token1Amount, setToken1Amount] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  const hasPeriphery = hasV4Periphery(JEJU_CHAIN_ID)
  const isCorrectChain = chain?.id === JEJU_CHAIN_ID

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">Add Liquidity</h1>

      {!hasPeriphery && (
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/50 text-yellow-200 mb-6">
          ⚠️ V4 Periphery contracts not deployed. Liquidity features unavailable.
        </div>
      )}

      {isConnected && !isCorrectChain && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/50 text-red-200 mb-6">
          ❌ Please switch to Jeju network (Chain ID: {JEJU_CHAIN_ID})
        </div>
      )}

      <div className="p-6 rounded-xl bg-white/5 border border-white/10">
        {/* Token Pair Selection */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-4">Select Pair</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Token A</label>
              <input
                type="number"
                value={token0Amount}
                onChange={(e) => setToken0Amount(e.target.value)}
                placeholder="0.0"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500"
              />
              <select className="w-full mt-2 bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500">
                <option value="ETH">ETH</option>
                <option value="USDC">USDC</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Token B</label>
              <input
                type="number"
                value={token1Amount}
                onChange={(e) => setToken1Amount(e.target.value)}
                placeholder="0.0"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500"
              />
              <select className="w-full mt-2 bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500">
                <option value="USDC">USDC</option>
                <option value="ETH">ETH</option>
              </select>
            </div>
          </div>
        </div>

        {/* Price Range */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-4">Set Price Range</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Min Price</label>
              <input
                type="number"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                placeholder="0.0"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Max Price</label>
              <input
                type="number"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                placeholder="0.0"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>
        </div>

        {/* Hook Selection (V4 Feature) */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-4">Select Hook (Optional)</h3>
          <select className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500">
            <option value="">No Hook</option>
            <option value="twamm">TWAMM Hook</option>
            <option value="limit-order">Limit Order Hook</option>
            <option value="custom">Custom Hook</option>
          </select>
          <p className="text-sm text-slate-400 mt-2">
            Hooks enable custom logic like TWAMM, limit orders, or dynamic fees
          </p>
        </div>

        {/* Add Liquidity Button */}
        <button
          disabled={!isConnected || !hasPeriphery || !isCorrectChain}
          className="w-full py-4 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {!isConnected
            ? 'Connect Wallet'
            : !isCorrectChain
            ? 'Switch to Jeju'
            : !hasPeriphery
            ? 'Contracts Not Deployed'
            : 'Add Liquidity'}
        </button>
      </div>

      {/* Positions */}
      <div className="mt-8">
        <h3 className="text-2xl font-semibold mb-4">Your Positions</h3>
        <div className="p-8 rounded-xl bg-white/5 border border-white/10 text-center">
          <div className="text-4xl mb-2">📊</div>
          <p className="text-slate-400">No positions yet</p>
        </div>
      </div>
    </div>
  )
}

