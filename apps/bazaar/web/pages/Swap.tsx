/**
 * Swap Page
 *
 * Token swaps require oracle integration for price discovery.
 * Currently only same-token swaps (ETH to ETH cross-chain) are supported.
 */

import { SUPPORTED_CHAINS } from '@jejunetwork/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { formatEther, parseEther } from 'viem'
import { useAccount } from 'wagmi'
import {
  getSwapButtonText,
  getTokenBySymbol,
  isSwapButtonDisabled,
  SWAP_TOKENS,
  validateSwap,
} from '../../api/swap'
import { InfoCard } from '../components/ui'
import { JEJU_CHAIN_ID } from '../config/chains'
import {
  type ChainInfo,
  isCrossChainSwap as checkCrossChain,
  useCrossChainSwap,
  useEILConfig,
  useSwapFeeEstimate,
} from '../hooks/useEIL'

export default function SwapPage() {
  const { isConnected, chain, address } = useAccount()
  const [inputAmount, setInputAmount] = useState('')
  const [inputToken, setInputToken] = useState('ETH')
  const [outputToken, setOutputToken] = useState('ETH')
  const [sourceChainId, setSourceChainId] = useState(JEJU_CHAIN_ID)
  const [destChainId, setDestChainId] = useState(JEJU_CHAIN_ID)

  const isCorrectChain = chain?.id === JEJU_CHAIN_ID

  const eilConfig = useEILConfig()
  const eilAvailable = eilConfig?.isAvailable ?? false
  const crossChainPaymaster = eilConfig?.crossChainPaymaster
  const {
    executeCrossChainSwap,
    swapStatus,
    isLoading: isSwapping,
    hash,
  } = useCrossChainSwap(crossChainPaymaster)

  const isCrossChainSwap = checkCrossChain(sourceChainId, destChainId)
  const amount = inputAmount ? parseEther(inputAmount) : 0n
  const feeEstimate = useSwapFeeEstimate(sourceChainId, destChainId, amount)

  const sourceChain = SUPPORTED_CHAINS.find(
    (c: ChainInfo) => c.id === sourceChainId,
  )
  const destChain = SUPPORTED_CHAINS.find(
    (c: ChainInfo) => c.id === destChainId,
  )

  // Calculate output - for same token, output equals input minus fees
  const outputAmount =
    inputAmount && inputToken === outputToken
      ? formatEther(
          amount > feeEstimate.totalFee ? amount - feeEstimate.totalFee : 0n,
        )
      : ''

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

    if (!sourceTokenInfo || !destTokenInfo) {
      toast.error('Token not supported')
      return
    }

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
    <div className="max-w-lg mx-auto animate-fade-in">
      {/* Page Header */}
      <header className="text-center mb-8">
        <div className="text-5xl mb-3 animate-float" aria-hidden="true">
          🔄
        </div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gradient-warm mb-2">
          Swap
        </h1>
        <p className="text-secondary">
          Trade tokens instantly with the best rates
        </p>
      </header>

      {/* Warnings */}
      <div className="space-y-3 mb-6">
        {!eilAvailable && (
          <InfoCard variant="warning">
            Cross-chain swaps require EIL integration. Only same-chain ETH
            transfers are available.
          </InfoCard>
        )}

        {isConnected && !isCorrectChain && !isCrossChainSwap && (
          <InfoCard variant="error">
            Switch to the correct network to swap
          </InfoCard>
        )}
      </div>

      {/* Swap Card */}
      <div className="card p-5 md:p-6">
        {/* From Section */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor="swap-input-amount"
              className="text-sm text-tertiary"
            >
              From
            </label>
            {eilAvailable && (
              <select
                value={sourceChainId}
                onChange={(e) => setSourceChainId(Number(e.target.value))}
                className="text-xs px-2 py-1 rounded-lg border-0 bg-surface-secondary text-secondary"
                aria-label="Source chain"
              >
                {SUPPORTED_CHAINS.map((c: ChainInfo) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <input
              id="swap-input-amount"
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0.0"
              className="input flex-1 text-xl font-semibold"
              aria-label="Amount to swap"
            />
            <select
              value={inputToken}
              onChange={(e) => setInputToken(e.target.value)}
              className="input w-28 sm:w-32 font-medium"
              aria-label="Token to swap from"
            >
              {SWAP_TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>
                  {token.icon} {token.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Swap Direction Button */}
        <div className="flex justify-center my-3">
          <button
            type="button"
            className="p-2.5 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-all hover:scale-110 active:scale-95 focus-ring"
            onClick={swapTokens}
            aria-label="Swap tokens"
          >
            <svg
              className="w-5 h-5 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
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
              htmlFor="swap-output-amount"
              className="text-sm text-tertiary"
            >
              To
            </label>
            {eilAvailable && (
              <select
                value={destChainId}
                onChange={(e) => setDestChainId(Number(e.target.value))}
                className="text-xs px-2 py-1 rounded-lg border-0 bg-surface-secondary text-secondary"
                aria-label="Destination chain"
              >
                {SUPPORTED_CHAINS.map((c: ChainInfo) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex gap-2">
            <input
              id="swap-output-amount"
              type="number"
              value={outputAmount}
              placeholder="0.0"
              readOnly
              className="input flex-1 text-xl font-semibold bg-surface-secondary"
              aria-label="Amount you will receive"
            />
            <select
              value={outputToken}
              onChange={(e) => setOutputToken(e.target.value)}
              className="input w-28 sm:w-32 font-medium"
              aria-label="Token to receive"
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
          <div className="mb-4 p-4 rounded-xl bg-surface-secondary animate-fade-in">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg" aria-hidden="true">
                🌉
              </span>
              <span className="font-medium text-primary">
                Cross-Chain Transfer
              </span>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-tertiary">Route</dt>
                <dd className="text-primary">
                  {sourceChain?.icon} → {destChain?.icon}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-tertiary">Estimated Time</dt>
                <dd className="text-primary">~{feeEstimate.estimatedTime}s</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-tertiary">Bridge Fee</dt>
                <dd className="text-primary">
                  {formatEther(feeEstimate.totalFee)} ETH
                </dd>
              </div>
            </dl>
          </div>
        )}

        {/* Same-chain Summary */}
        {inputAmount && outputAmount && !isCrossChainSwap && (
          <div className="mb-4 p-4 rounded-xl bg-surface-secondary animate-fade-in">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-tertiary">Rate</dt>
                <dd className="text-primary">1:1 (same token)</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-tertiary">Network Fee</dt>
                <dd className="text-primary">
                  {formatEther(feeEstimate.totalFee)} ETH
                </dd>
              </div>
            </dl>
          </div>
        )}

        {/* Swap Button */}
        <button
          type="button"
          onClick={handleSwap}
          disabled={buttonDisabled}
          className="btn-primary w-full py-4 text-lg font-semibold"
        >
          {buttonText}
        </button>

        {/* Success Message */}
        {swapStatus === 'complete' && hash && (
          <div className="mt-4 p-4 rounded-xl border border-green-500/30 bg-green-500/10 text-center animate-scale-in">
            <span className="text-success font-medium">
              ✓ Transfer initiated successfully
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
