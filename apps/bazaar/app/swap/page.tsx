'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { parseEther, formatEther, type Address } from 'viem'
import { JEJU_CHAIN_ID } from '@/config/chains'
import { toast } from 'sonner'
import { 
  useEILConfig, 
  useCrossChainSwap, 
  useSwapFeeEstimate,
  SUPPORTED_CHAINS,
  isCrossChainSwap as checkCrossChain
} from '@/hooks/useEIL'

const TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', icon: '⟠', address: '0x0000000000000000000000000000000000000000' as Address },
  { symbol: 'USDC', name: 'USD Coin', icon: '💵', address: '0x0000000000000000000000000000000000000001' as Address },
  { symbol: 'JEJU', name: 'Jeju Token', icon: '🏝️', address: '0x0000000000000000000000000000000000000002' as Address },
]

export default function SwapPage() {
  const { isConnected, chain, address } = useAccount()
  const [inputAmount, setInputAmount] = useState('')
  const [outputAmount, setOutputAmount] = useState('')
  const [inputToken, setInputToken] = useState('ETH')
  const [outputToken, setOutputToken] = useState('USDC')
  const [sourceChainId, setSourceChainId] = useState(JEJU_CHAIN_ID)
  const [destChainId, setDestChainId] = useState(JEJU_CHAIN_ID)

  const isCorrectChain = chain?.id === JEJU_CHAIN_ID

  const { isAvailable: eilAvailable, crossChainPaymaster } = useEILConfig()
  const { executeCrossChainSwap, swapStatus, isLoading: isSwapping, hash } = useCrossChainSwap(crossChainPaymaster)
  
  const isCrossChain = checkCrossChain(sourceChainId, destChainId)
  const amount = inputAmount ? parseEther(inputAmount) : 0n
  const feeEstimate = useSwapFeeEstimate(sourceChainId, destChainId, amount)

  const sourceChain = SUPPORTED_CHAINS.find(c => c.id === sourceChainId)
  const destChain = SUPPORTED_CHAINS.find(c => c.id === destChainId)
  const inputTokenInfo = TOKENS.find(t => t.symbol === inputToken)
  const outputTokenInfo = TOKENS.find(t => t.symbol === outputToken)

  useEffect(() => {
    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      setOutputAmount('')
      return
    }
    
    const inputValue = parseEther(inputAmount)
    const fee = feeEstimate.totalFee
    const outputValue = inputValue - fee - (inputValue * 30n / 10000n)
    
    let output = outputValue
    if (inputToken === 'ETH' && outputToken === 'USDC') {
      output = outputValue * 3000n / parseEther('1')
    } else if (inputToken === 'USDC' && outputToken === 'ETH') {
      output = outputValue * parseEther('1') / 3000n
    }
    
    setOutputAmount(formatEther(output > 0n ? output : 0n))
  }, [inputAmount, inputToken, outputToken, feeEstimate.totalFee])

  const handleSwap = async () => {
    if (!isConnected) {
      toast.error('Connect your wallet first')
      return
    }

    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      toast.error('Enter an amount')
      return
    }

    if (inputToken === outputToken && !isCrossChain) {
      toast.error('Select different tokens')
      return
    }

    const sourceTokenInfo = TOKENS.find(t => t.symbol === inputToken)
    const destTokenInfo = TOKENS.find(t => t.symbol === outputToken)

    if (!sourceTokenInfo || !destTokenInfo) return

    if (isCrossChain) {
      if (!eilAvailable) {
        toast.error('Cross-chain swaps not available yet')
        return
      }

      await executeCrossChainSwap({
        sourceToken: sourceTokenInfo.address,
        destinationToken: destTokenInfo.address,
        amount: parseEther(inputAmount),
        sourceChainId,
        destinationChainId: destChainId
      })
    } else {
      if (!isCorrectChain) {
        toast.error('Switch to the correct network')
        return
      }

      await executeCrossChainSwap({
        sourceToken: sourceTokenInfo.address,
        destinationToken: destTokenInfo.address,
        amount: parseEther(inputAmount),
        sourceChainId: JEJU_CHAIN_ID,
        destinationChainId: JEJU_CHAIN_ID,
        recipient: address
      })
    }
  }

  const swapTokens = () => {
    setInputToken(outputToken)
    setOutputToken(inputToken)
    const temp = sourceChainId
    setSourceChainId(destChainId)
    setDestChainId(temp)
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-6 md:mb-8 text-center" style={{ color: 'var(--text-primary)' }}>
        🔄 Swap
      </h1>

      {isConnected && !isCorrectChain && !isCrossChain && (
        <div className="card p-4 mb-4 border-red-500/30 bg-red-500/10">
          <p className="text-red-400 text-sm text-center">Switch to the correct network to swap</p>
        </div>
      )}

      <div className="card p-5 md:p-6">
        {/* From Section */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm" style={{ color: 'var(--text-tertiary)' }}>From</label>
            {eilAvailable && (
              <select
                value={sourceChainId}
                onChange={(e) => setSourceChainId(Number(e.target.value))}
                className="text-xs px-2 py-1 rounded-lg border-0"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                {SUPPORTED_CHAINS.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0.0"
              className="input flex-1 text-xl font-semibold"
            />
            <select
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              className="input w-32 font-medium"
            >
              {TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>
                  {token.icon} {token.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Swap Button */}
        <div className="flex justify-center my-3">
          <button 
            className="p-2.5 rounded-xl transition-all hover:scale-110 active:scale-95"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
            onClick={swapTokens}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {/* To Section */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm" style={{ color: 'var(--text-tertiary)' }}>To</label>
            {eilAvailable && (
              <select
                value={destChainId}
                onChange={(e) => setDestChainId(Number(e.target.value))}
                className="text-xs px-2 py-1 rounded-lg border-0"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                {SUPPORTED_CHAINS.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              value={outputAmount}
              placeholder="0.0"
              readOnly
              className="input flex-1 text-xl font-semibold"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
            <select
              value={outputToken}
              onChange={(e) => setOutputToken(e.target.value)}
              className="input w-32 font-medium"
            >
              {TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>
                  {token.icon} {token.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cross-chain Info */}
        {isCrossChain && (
          <div className="mb-4 p-3 rounded-xl text-sm" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🌉</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Cross-Chain Swap</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Route</span>
                <span style={{ color: 'var(--text-primary)' }}>{sourceChain?.icon} → {destChain?.icon}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Time</span>
                <span style={{ color: 'var(--text-primary)' }}>~{feeEstimate.estimatedTime}s</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Bridge Fee</span>
                <span style={{ color: 'var(--text-primary)' }}>{formatEther(feeEstimate.totalFee)} ETH</span>
              </div>
            </div>
          </div>
        )}

        {/* Swap Summary */}
        {inputAmount && outputAmount && !isCrossChain && (
          <div className="mb-4 p-3 rounded-xl text-sm space-y-1.5" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Rate</span>
              <span style={{ color: 'var(--text-primary)' }}>
                1 {inputToken} = {inputToken === 'ETH' ? '3,000' : '0.00033'} {outputToken}
              </span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Fee</span>
              <span style={{ color: 'var(--text-primary)' }}>0.3%</span>
            </div>
          </div>
        )}

        {/* Swap Button */}
        <button
          onClick={handleSwap}
          disabled={!isConnected || isSwapping || (!isCorrectChain && !isCrossChain) || !inputAmount}
          className="btn-primary w-full py-4 text-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {!isConnected 
            ? 'Connect Wallet' 
            : isSwapping 
            ? 'Swapping...' 
            : isCrossChain
            ? `Swap to ${destChain?.name}`
            : 'Swap'
          }
        </button>

        {/* Success Message */}
        {swapStatus === 'complete' && hash && (
          <div className="mt-4 p-3 rounded-xl border border-green-500/30 bg-green-500/10 text-center">
            <span className="text-sm text-green-400">✓ Swap initiated successfully</span>
          </div>
        )}
      </div>
    </div>
  )
}

