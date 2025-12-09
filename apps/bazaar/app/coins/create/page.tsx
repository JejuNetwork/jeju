'use client'

import { useState, useEffect, useRef } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { JEJU_CHAIN_ID } from '@/config/chains'
import { getTokenFactoryContracts, hasTokenFactory } from '@/config/contracts'
import { toast } from 'sonner'
import { parseEther } from 'viem'
import factoryAbi from '@/lib/abis/SimpleERC20Factory.json'

export default function CreateTokenPage() {
  const { isConnected, chain } = useAccount()
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [initialSupply, setInitialSupply] = useState('1000000')
  const [decimals, setDecimals] = useState('18')
  const successToastShown = useRef(false)

  const isCorrectChain = chain?.id === JEJU_CHAIN_ID || chain?.id === 1337
  const factoryContracts = getTokenFactoryContracts(chain?.id || JEJU_CHAIN_ID)
  const hasFactory = hasTokenFactory(chain?.id || JEJU_CHAIN_ID)

  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  })

  useEffect(() => {
    if (isSuccess && hash && !successToastShown.current) {
      successToastShown.current = true
      toast.success(`Token ${symbol} created successfully.`, {
        description: 'Your token will appear in the tokens list shortly',
        action: {
          label: 'View Tokens',
          onClick: () => window.location.href = '/coins',
        },
      })
    }
  }, [isSuccess, hash, symbol])

  useEffect(() => {
    if (error) {
      toast.error('Transaction failed', {
        description: error.message,
      })
    }
  }, [error])

  const handleCreate = () => {
    if (!isConnected) {
      toast.error('Please connect your wallet')
      return
    }

    if (!isCorrectChain) {
      toast.error(`Please switch to Jeju network`)
      return
    }

    if (!name || !symbol) {
      toast.error('Please fill in all required fields')
      return
    }

    if (!hasFactory || !factoryContracts) {
      toast.error('Token factory not deployed on this network')
      return
    }

    successToastShown.current = false
    const supply = parseEther(initialSupply || '0')
    
    writeContract({
      address: factoryContracts.erc20Factory,
      abi: factoryAbi,
      functionName: 'createToken',
      args: [name, symbol, parseInt(decimals), supply],
    })
    
    toast.success(`Creating token ${symbol}...`, {
      description: 'Please confirm the transaction in your wallet',
    })
  }

  const isCreating = isPending || isConfirming

  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          🪙 Create Token
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>Launch your own ERC20 token on Jeju</p>
      </div>

      {/* Alerts */}
      {!isConnected && (
        <div className="card p-4 mb-6 border-bazaar-warning/50 bg-bazaar-warning/10">
          <p className="text-bazaar-warning">Please connect your wallet to create a token</p>
        </div>
      )}

      {isConnected && !isCorrectChain && (
        <div className="card p-4 mb-6 border-bazaar-error/50 bg-bazaar-error/10">
          <p className="text-bazaar-error">Please switch to Jeju network (Chain ID: {JEJU_CHAIN_ID})</p>
        </div>
      )}

      {/* Form */}
      <div className="card p-5 md:p-6">
        <div className="space-y-5 md:space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              Token Name <span className="text-bazaar-error">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Token"
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              Symbol <span className="text-bazaar-error">*</span>
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="MAT"
              maxLength={10}
              className="input"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your token..."
              rows={4}
              className="input resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              Initial Supply <span className="text-bazaar-error">*</span>
            </label>
            <input
              type="number"
              value={initialSupply}
              onChange={(e) => setInitialSupply(e.target.value)}
              placeholder="1000000"
              className="input"
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Number of tokens to mint (full tokens, will use {decimals} decimals)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              Decimals
            </label>
            <select
              value={decimals}
              onChange={(e) => setDecimals(e.target.value)}
              className="input"
            >
              <option value="6">6 (like USDC)</option>
              <option value="8">8 (like Bitcoin)</option>
              <option value="18">18 (standard)</option>
            </select>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Standard is 18 decimals (like ETH)
            </p>
          </div>

          {/* Features Preview */}
          <div className="p-4 rounded-xl border border-bazaar-primary/30 bg-bazaar-primary/5">
            <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>🚀 Features</h3>
            <ul className="text-sm space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>✅ Automatically indexed on Bazaar</li>
              <li>✅ Tradeable on Uniswap V4</li>
              <li>✅ Visible on Jeju Explorer</li>
              <li>✅ Real-time price tracking</li>
            </ul>
          </div>

          <button
            onClick={handleCreate}
            disabled={!isConnected || !isCorrectChain || isCreating || !name || !symbol}
            className="btn-primary w-full py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* How It Works */}
      <div className="card p-5 md:p-6 mt-6">
        <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          How it works
        </h3>
        <ol className="space-y-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
          {[
            'Connect your wallet and switch to Jeju network',
            'Fill in token details (name, symbol, supply)',
            'Deploy your ERC20 token contract',
            'Your token appears on Bazaar automatically via the indexer'
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-bazaar-primary text-white flex items-center justify-center text-xs font-bold">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
