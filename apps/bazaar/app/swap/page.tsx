'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { formatEther, parseEther } from 'viem'
import { useAccount } from 'wagmi'
import { JEJU_CHAIN_ID } from '@/config/chains'
import {
  isCrossChainSwap as checkCrossChain,
  SUPPORTED_CHAINS,
  useCrossChainSwap,
  useEILConfig,
  useSwapFeeEstimate,
} from '@/hooks/useEIL'
import {
  formatSwapAmount,
  generateSwapQuote,
  getSwapButtonText,
  getTokenBySymbol,
  isSwapButtonDisabled,
  SWAP_TOKENS,
  validateSwap,
} from '@/lib/swap'

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
  const {
    executeCrossChainSwap,
    swapStatus,
    isLoading: isSwapping,
    hash,
  } = useCrossChainSwap(crossChainPaymaster)

  const isCrossChainSwap = checkCrossChain(sourceChainId, destChainId)
  const amount = inputAmount ? parseEther(inputAmount) : 0n
  const feeEstimate = useSwapFeeEstimate(sourceChainId, destChainId, amount)

  const sourceChain = SUPPORTED_CHAINS.find((c) => c.id === sourceChainId)
  const destChain = SUPPORTED_CHAINS.find((c) => c.id === destChainId)

  useEffect(() => {
    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      setOutputAmount('')
      return
    }

    const quote = generateSwapQuote(
      parseEther(inputAmount),
      inputToken,
      outputToken,
      sourceChainId,
      destChainId,
    )

    setOutputAmount(formatSwapAmount(quote.outputAmount))
  }, [inputAmount, inputToken, outputToken, sourceChainId, destChainId])

  const handleSwap = async () => {
    const validation = validateSwap(
      isConnected,
      inputAmount,
      inputToken,
      outputToken,
      sourceChainId,
      destChainId,
      isCorrectChain,
      eilAvailable,
    )

    if (!validation.valid) {
      toast.error(validation.error)
      return
    }

    const sourceTokenInfo = getTokenBySymbol(inputToken)
    const destTokenInfo = getTokenBySymbol(outputToken)

    if (!sourceTokenInfo || !destTokenInfo) return

    if (isCrossChainSwap) {
      await executeCrossChainSwap({
        sourceToken: sourceTokenInfo.address,
        destinationToken: destTokenInfo.address,
        amount: parseEther(inputAmount),
        sourceChainId,
        destinationChainId: destChainId,
      })
    } else {
      await executeCrossChainSwap({
        sourceToken: sourceTokenInfo.address,
        destinationToken: destTokenInfo.address,
        amount: parseEther(inputAmount),
        sourceChainId: JEJU_CHAIN_ID,
        destinationChainId: JEJU_CHAIN_ID,
        recipient: address,
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

  const buttonText = getSwapButtonText(
    isConnected,
    isSwapping,
    isCorrectChain,
    Boolean(inputAmount),
    isCrossChainSwap,
    destChain?.name ?? 'Unknown',
  )

  const buttonDisabled = isSwapButtonDisabled(
    isConnected,
    isSwapping,
    isCorrectChain,
    Boolean(inputAmount),
    isCrossChainSwap,
  )

  return (
    <div className="max-w-lg mx-auto">
      <h1
        className="text-2xl sm:text-3xl md:text-4xl font-bold mb-6 md:mb-8 text-center"
        style={{ color: 'var(--text-primary)' }}
      >
        🔄 Swap
      </h1>

      {isConnected && !isCorrectChain && !isCrossChainSwap && (
        <div className="card p-4 mb-4 border-red-500/30 bg-red-500/10">
          <p className="text-red-400 text-sm text-center">
            Switch to the correct network to swap
          </p>
        </div>
      )}

      <div className="card p-5 md:p-6">
        {/* From Section */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <label
              className="text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              From
            </label>
            {eilAvailable && (
              <select
                value={sourceChainId}
                onChange={(e) => setSourceChainId(Number(e.target.value))}
                className="text-xs px-2 py-1 rounded-lg border-0"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                }}
              >
                {SUPPORTED_CHAINS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
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
              {SWAP_TOKENS.map((token) => (
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
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"
              />
            </svg>
          </button>
        </div>

        {/* To Section */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label
              className="text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              To
            </label>
            {eilAvailable && (
              <select
                value={destChainId}
                onChange={(e) => setDestChainId(Number(e.target.value))}
                className="text-xs px-2 py-1 rounded-lg border-0"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                }}
              >
                {SUPPORTED_CHAINS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
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
              {SWAP_TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>
                  {token.icon} {token.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Cross-chain Info */}
        {isCrossChainSwap && (
          <div
            className="mb-4 p-3 rounded-xl text-sm"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">🌉</span>
              <span
                className="font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                Cross-Chain Swap
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Route</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {sourceChain?.icon} → {destChain?.icon}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>Time</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  ~{feeEstimate.estimatedTime}s
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-tertiary)' }}>
                  Bridge Fee
                </span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {formatEther(feeEstimate.totalFee)} ETH
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Swap Summary */}
        {inputAmount && outputAmount && !isCrossChainSwap && (
          <div
            className="mb-4 p-3 rounded-xl text-sm space-y-1.5"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-tertiary)' }}>Rate</span>
              <span style={{ color: 'var(--text-primary)' }}>
                1 {inputToken} = {inputToken === 'ETH' ? '3,000' : '0.00033'}{' '}
                {outputToken}
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
          disabled={buttonDisabled}
          className="btn-primary w-full py-4 text-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {buttonText}
        </button>

        {/* Success Message */}
        {swapStatus === 'complete' && hash && (
          <div className="mt-4 p-3 rounded-xl border border-green-500/30 bg-green-500/10 text-center">
            <span className="text-sm text-green-400">
              ✓ Swap initiated successfully
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
