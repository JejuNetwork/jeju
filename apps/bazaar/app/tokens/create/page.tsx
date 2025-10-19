'use client'

import { useState } from 'react'
import { useAccount } from 'wagmi'
import { JEJU_CHAIN_ID } from '@/config/chains'
import { toast } from 'sonner'

export default function CreateTokenPage() {
  const { isConnected, chain } = useAccount()
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [initialSupply, setInitialSupply] = useState('1000000')
  const [isCreating, setIsCreating] = useState(false)

  const isCorrectChain = chain?.id === JEJU_CHAIN_ID

  const handleCreate = async () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }

    if (!isCorrectChain) {
      toast.error(`Please switch to Jeju network (Chain ID: ${JEJU_CHAIN_ID})`)
      return
    }

    if (!name || !symbol) {
      toast.error('Please fill in all required fields')
      return
    }

    setIsCreating(true)

    // TODO: Implement token creation with ERC20 factory contract
    toast.promise(
      new Promise((resolve, reject) => {
        setTimeout(() => {
          // Simulate token creation
          resolve({ name, symbol })
        }, 2000)
      }),
      {
        loading: 'Creating token...',
        success: `Token ${symbol} created successfully!`,
        error: 'Failed to create token',
      }
    )

    setIsCreating(false)
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-4xl font-bold mb-2">Create Token</h1>
      <p className="text-slate-400 mb-8">Launch your own ERC20 token on Jeju</p>

      {!isConnected && (
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/50 text-yellow-200 mb-6">
          ⚠️ Please connect your wallet to create a token
        </div>
      )}

      {isConnected && !isCorrectChain && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/50 text-red-200 mb-6">
          ❌ Please switch to Jeju network (Chain ID: {JEJU_CHAIN_ID})
        </div>
      )}

      <div className="p-6 rounded-xl bg-white/5 border border-white/10">
        <div className="space-y-6">
          {/* Token Name */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Token Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Token"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Token Symbol */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Symbol <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="MAT"
              maxLength={10}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your token..."
              rows={4}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500 resize-none"
            />
          </div>

          {/* Initial Supply */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Initial Supply <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              value={initialSupply}
              onChange={(e) => setInitialSupply(e.target.value)}
              placeholder="1000000"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-purple-500"
            />
            <p className="text-sm text-slate-400 mt-1">
              Number of tokens to mint (will use 18 decimals)
            </p>
          </div>

          {/* Features Preview */}
          <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/50">
            <h3 className="font-semibold mb-2">🚀 Features</h3>
            <ul className="text-sm text-slate-300 space-y-1">
              <li>✅ Automatically indexed on Bazaar</li>
              <li>✅ Tradeable on Uniswap V4</li>
              <li>✅ Visible on Jeju Explorer</li>
              <li>✅ Real-time price tracking</li>
            </ul>
          </div>

          {/* Create Button */}
          <button
            onClick={handleCreate}
            disabled={!isConnected || !isCorrectChain || isCreating || !name || !symbol}
            className="w-full py-4 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreating
              ? 'Creating...'
              : !isConnected
              ? 'Connect Wallet'
              : !isCorrectChain
              ? 'Switch to Jeju'
              : 'Create Token'}
          </button>
        </div>
      </div>

      {/* Info Section */}
      <div className="mt-8 p-6 rounded-xl bg-white/5 border border-white/10">
        <h3 className="text-lg font-semibold mb-4">How it works</h3>
        <ol className="space-y-3 text-sm text-slate-300">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold">
              1
            </span>
            <span>Connect your wallet and switch to Jeju network</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold">
              2
            </span>
            <span>Fill in token details (name, symbol, supply)</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold">
              3
            </span>
            <span>Deploy your ERC20 token contract</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold">
              4
            </span>
            <span>Your token appears on Bazaar automatically via the indexer</span>
          </li>
        </ol>
      </div>
    </div>
  )
}



