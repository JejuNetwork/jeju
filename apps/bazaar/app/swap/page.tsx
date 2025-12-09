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
  { symbol: 'ETH', name: 'Ethereum', address: '0x0000000000000000000000000000000000000000' as Address },
  { symbol: 'USDC', name: 'USD Coin', address: '0x0000000000000000000000000000000000000001' as Address },
  { symbol: 'elizaOS', name: 'elizaOS Token', address: '0x0000000000000000000000000000000000000002' as Address },
]

export default function SwapPage() {
  const { isConnected, chain, address } = useAccount()
  const [inputAmount, setInputAmount] = useState('')
  const [outputAmount, setOutputAmount] = useState('')
  const [inputToken, setInputToken] = useState('ETH')
  const [outputToken, setOutputToken] = useState('USDC')
  const [sourceChainId, setSourceChainId] = useState(JEJU_CHAIN_ID)
  const [destChainId, setDestChainId] = useState(JEJU_CHAIN_ID)
  const [showCrossChain, setShowCrossChain] = useState(false)

  const isCorrectChain = chain?.id === JEJU_CHAIN_ID

  const { isAvailable: eilAvailable, crossChainPaymaster } = useEILConfig()
  const { executeCrossChainSwap, swapStatus, isLoading: isSwapping, hash } = useCrossChainSwap(crossChainPaymaster)
  
  const isCrossChain = showCrossChain && checkCrossChain(sourceChainId, destChainId)
  const amount = inputAmount ? parseEther(inputAmount) : 0n
  const feeEstimate = useSwapFeeEstimate(sourceChainId, destChainId, amount)

  const sourceChain = SUPPORTED_CHAINS.find(c => c.id === sourceChainId)
  const destChain = SUPPORTED_CHAINS.find(c => c.id === destChainId)

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
      toast.error('Connect wallet')
      return
    }

    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      toast.error('Enter amount')
      return
    }

    if (inputToken === outputToken && !isCrossChain) {
      toast.error('Same token')
      return
    }

    const sourceTokenInfo = TOKENS.find(t => t.symbol === inputToken)
    const destTokenInfo = TOKENS.find(t => t.symbol === outputToken)

    if (!sourceTokenInfo || !destTokenInfo) return

    if (isCrossChain) {
      if (!eilAvailable) {
        toast.error('Cross-chain unavailable')
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
        toast.error('Switch to Jeju')
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

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-3xl md:text-4xl font-bold mb-8 text-center" style={{ color: 'var(--text-primary)' }}>
        🔄 Swap
      </h1>

      {isConnected && !isCorrectChain && !isCrossChain && (
        <div className="card p-4 mb-6 border-bazaar-error/50 bg-bazaar-error/10">
          <p className="text-bazaar-error text-sm">Switch to Jeju (Chain {JEJU_CHAIN_ID})</p>
        </div>
      )}

      <div className="card p-5 md:p-6">
        {eilAvailable && (
          <div className="flex items-center justify-between mb-4 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Cross-Chain</span>
            <button
              onClick={() => setShowCrossChain(!showCrossChain)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
                showCrossChain ? 'bg-bazaar-accent text-white' : ''
              }`}
              style={{ 
                backgroundColor: showCrossChain ? undefined : 'var(--bg-secondary)',
                color: showCrossChain ? undefined : 'var(--text-secondary)'
              }}
            >
              {showCrossChain ? 'ON' : 'OFF'}
            </button>
          </div>
        )}

        {showCrossChain && (
          <div className="grid grid-cols-2 gap-3 mb-4 p-4 rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-tertiary)' }}>From</label>
              <select
                value={sourceChainId}
                onChange={(e) => setSourceChainId(Number(e.target.value))}
                className="input py-2 text-sm"
              >
                {SUPPORTED_CHAINS.map((chain) => (
                  <option key={chain.id} value={chain.id}>{chain.icon} {chain.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-tertiary)' }}>To</label>
              <select
                value={destChainId}
                onChange={(e) => setDestChainId(Number(e.target.value))}
                className="input py-2 text-sm"
              >
                {SUPPORTED_CHAINS.map((chain) => (
                  <option key={chain.id} value={chain.id}>{chain.icon} {chain.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>From</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0.0"
              className="input flex-1 text-lg"
            />
            <select
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              className="input w-28"
            >
              {TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>{token.symbol}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-center my-2">
          <button 
            className="p-2.5 rounded-xl transition-all hover:scale-110"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
            onClick={() => {
              setInputToken(outputToken)
              setOutputToken(inputToken)
              if (showCrossChain) {
                const temp = sourceChainId
                setSourceChainId(destChainId)
                setDestChainId(temp)
              }
            }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        </div>

        <div className="mb-6">
          <label className="text-sm mb-2 block" style={{ color: 'var(--text-secondary)' }}>To</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={outputAmount}
              placeholder="0.0"
              readOnly
              className="input flex-1 text-lg"
              style={{ backgroundColor: 'var(--bg-tertiary)' }}
            />
            <select
              value={outputToken}
              onChange={(e) => setOutputToken(e.target.value)}
              className="input w-28"
            >
              {TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>{token.symbol}</option>
              ))}
            </select>
          </div>
        </div>

        {isCrossChain && (
          <div className="mb-4 p-3 rounded-xl text-xs space-y-1" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Route</span>
              <span>{sourceChain?.icon} → {destChain?.icon}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Time</span>
              <span>~{feeEstimate.estimatedTime}s</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Fee</span>
              <span>{formatEther(feeEstimate.totalFee)} ETH</span>
            </div>
          </div>
        )}

        <button
          onClick={handleSwap}
          disabled={!isConnected || isSwapping || (!isCorrectChain && !isCrossChain)}
          className="btn-primary w-full py-4 text-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {!isConnected ? 'Connect Wallet' : isSwapping ? 'Swapping...' : 'Swap'}
        </button>

        {swapStatus === 'complete' && hash && (
          <div className="mt-4 p-3 rounded-xl border border-bazaar-success/30 bg-bazaar-success/10">
            <span className="text-sm text-bazaar-success">✓ Swap initiated</span>
          </div>
        )}
      </div>

      <div className="card p-4 mt-4 text-sm space-y-2">
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-tertiary)' }}>Rate</span>
          <span>1 {inputToken} = {inputToken === 'ETH' ? '3000' : '0.00033'} {outputToken}</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: 'var(--text-tertiary)' }}>Fee</span>
          <span>{formatEther(feeEstimate.totalFee)} ETH</span>
        </div>
      </div>
    </div>
  )
}
