'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { hasV4Periphery } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'

export default function SwapPage() {
  const { isConnected, chain } = useAccount()
  const [inputAmount, setInputAmount] = useState('')
  const [outputAmount, setOutputAmount] = useState('')
  const [inputToken, setInputToken] = useState('ETH')
  const [outputToken, setOutputToken] = useState('USDC')

  const hasPeriphery = hasV4Periphery(JEJU_CHAIN_ID)
  const isCorrectChain = chain?.id === JEJU_CHAIN_ID

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-4xl font-bold mb-8">Swap Tokens</h1>

      {!hasPeriphery && (
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/50 text-yellow-200 mb-6">
          ⚠️ V4 Periphery contracts not deployed. Swap functionality unavailable.
        </div>
      )}

      {isConnected && !isCorrectChain && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/50 text-red-200 mb-6">
          ❌ Please switch to Jeju network (Chain ID: {JEJU_CHAIN_ID})
        </div>
      )}

      <div className="p-6 rounded-xl bg-white/5 border border-white/10">
        {/* Input Token */}
        <div className="mb-4">
          <label className="text-sm text-slate-400 mb-2 block">From</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0.0"
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-lg focus:outline-none focus:border-purple-500"
            />
            <select
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500"
            >
              <option value="ETH">ETH</option>
              <option value="USDC">USDC</option>
              <option value="elizaOS">elizaOS</option>
            </select>
          </div>
        </div>

        {/* Swap Icon */}
        <div className="flex justify-center my-2">
          <button className="p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
            ↓
          </button>
        </div>

        {/* Output Token */}
        <div className="mb-6">
          <label className="text-sm text-slate-400 mb-2 block">To</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={outputAmount}
              placeholder="0.0"
              readOnly
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-lg focus:outline-none"
            />
            <select
              value={outputToken}
              onChange={(e) => setOutputToken(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500"
            >
              <option value="USDC">USDC</option>
              <option value="ETH">ETH</option>
              <option value="elizaOS">elizaOS</option>
            </select>
          </div>
        </div>

        {/* Swap Button */}
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
            : 'Swap'}
        </button>
      </div>

      {/* Pool Info (if available) */}
      {hasPeriphery && (
        <div className="mt-6 p-4 rounded-lg bg-white/5 border border-white/10">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-400">Rate</span>
            <span>1 ETH = 3000 USDC</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-400">Price Impact</span>
            <span className="text-green-400">&lt; 0.01%</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Fee</span>
            <span>0.3%</span>
          </div>
        </div>
      )}
    </div>
  )
}

