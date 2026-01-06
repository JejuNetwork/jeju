/**
 * Swap Page
 *
 * Full swap functionality:
 * - Token swaps via XLPRouter (when deployed)
 * - Cross-chain swaps via EIL CrossChainPaymaster
 * - Same-chain token swaps via useSameChainSwap
 * - ETH/ERC20 transfers as fallback
 */

import { ArrowDownUp, Clock, Fuel, Loader2, RefreshCw, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type Address,
  erc20Abi,
  formatUnits,
  parseEther,
  parseUnits,
} from 'viem'
import {
  useAccount,
  useBalance,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { CHAIN_ID } from '../../config'
import { InfoCard, PageHeader } from '../components/ui'
import { useCrossChainSwap, useEILConfig } from '../hooks/useEIL'
import { useSameChainSwap } from '../hooks/useSameChainSwap'
import {
  ETH_TOKEN,
  type SwapToken,
  useSwap,
  useSwapRouter,
  useSwapTokens,
} from '../hooks/useSwap'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

// Chain options for cross-chain swaps
const SUPPORTED_CHAINS = [
  { id: CHAIN_ID, name: 'Jeju' },
  { id: 1, name: 'Ethereum' },
  { id: 42161, name: 'Arbitrum' },
  { id: 10, name: 'Optimism' },
  { id: 8453, name: 'Base' },
]

export default function SwapPage() {
  const { address, isConnected, chain } = useAccount()
  const publicClient = usePublicClient()
  const { switchChain } = useSwitchChain()
  const isCorrectChain = chain?.id === CHAIN_ID

  // Token selection
  const { tokens: availableTokens, isLoading: tokensLoading } = useSwapTokens()
  const [inputToken, setInputToken] = useState<SwapToken>(ETH_TOKEN)
  const [outputToken, setOutputToken] = useState<SwapToken>(ETH_TOKEN)
  const [inputAmount, setInputAmount] = useState('')

  // Chain selection for cross-chain
  const [sourceChainId, setSourceChainId] = useState(CHAIN_ID)
  const [destChainId, setDestChainId] = useState(CHAIN_ID)
  const isCrossChain = sourceChainId !== destChainId

  // Recipient for transfers
  const [recipient, setRecipient] = useState('')
  const [showRecipient, setShowRecipient] = useState(false)

  // Balance tracking
  const { data: ethBalance, refetch: refetchEthBalance } = useBalance({
    address,
  })
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n)

  // Swap hooks
  const { isAvailable: routerAvailable } = useSwapRouter()
  const {
    quote,
    getQuote,
    status: swapStatus,
    error: swapError,
    reset: resetSwap,
  } = useSwap()

  // Same-chain swap hook
  const {
    executeSameChainSwap,
    isLoading: isSameChainSwapping,
    hash: sameChainHash,
  } = useSameChainSwap()

  // EIL for cross-chain
  const { isAvailable: eilAvailable, crossChainPaymaster } = useEILConfig()
  const {
    executeCrossChainSwap,
    isLoading: crossChainLoading,
    hash: crossChainHash,
    reset: resetCrossChain,
  } = useCrossChainSwap(crossChainPaymaster)

  // Simple transfer for same-token operations
  const {
    sendTransaction,
    data: sendTxHash,
    isPending: isSendPending,
  } = useSendTransaction()

  const {
    writeContract,
    data: writeTxHash,
    isPending: isWritePending,
  } = useWriteContract()

  const txHash = sendTxHash || writeTxHash || crossChainHash || sameChainHash
  const isPending =
    isSendPending ||
    isWritePending ||
    crossChainLoading ||
    isSameChainSwapping ||
    swapStatus === 'swapping'

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  // Fetch token balance
  useEffect(() => {
    async function fetchBalance() {
      if (!address || !publicClient || inputToken.address === ZERO_ADDRESS) {
        setTokenBalance(0n)
        return
      }

      const balance = await publicClient.readContract({
        address: inputToken.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      })
      setTokenBalance(balance)
    }
    fetchBalance()
  }, [address, inputToken, publicClient])

  // Update quote when input changes
  useEffect(() => {
    if (!inputAmount || !routerAvailable) return

    const amount = parseUnits(inputAmount, inputToken.decimals)
    if (amount <= 0n) return

    const timer = setTimeout(() => {
      if (inputToken.address !== outputToken.address && !isCrossChain) {
        getQuote(inputToken, outputToken, amount)
      }
    }, 500) // Debounce

    return () => clearTimeout(timer)
  }, [
    inputAmount,
    inputToken,
    outputToken,
    routerAvailable,
    isCrossChain,
    getQuote,
  ])

  // Handle success
  useEffect(() => {
    if (isSuccess && txHash) {
      toast.success('Transaction completed successfully')
      setInputAmount('')
      setRecipient('')
      resetSwap()
      resetCrossChain()
      refetchEthBalance()
    }
  }, [isSuccess, txHash, resetSwap, resetCrossChain, refetchEthBalance])

  const currentBalance =
    inputToken.address === ZERO_ADDRESS
      ? (ethBalance?.value ?? 0n)
      : tokenBalance

  const parsedAmount = inputAmount
    ? parseUnits(inputAmount, inputToken.decimals)
    : 0n

  const hasInsufficientBalance = parsedAmount > currentBalance
  const isSameToken = inputToken.symbol === outputToken.symbol
  const canSwap = routerAvailable && !isSameToken && !isCrossChain

  // Calculate output amount
  const getOutputDisplay = () => {
    if (!inputAmount || parseFloat(inputAmount) <= 0) return ''

    if (quote && canSwap) {
      return formatUnits(quote.outputAmount, outputToken.decimals)
    }

    // For transfers, output equals input (minus gas estimate)
    if (isSameToken && !isCrossChain) {
      const estimatedGas = parseEther('0.001')
      const afterGas =
        parsedAmount > estimatedGas ? parsedAmount - estimatedGas : 0n
      return formatUnits(afterGas, outputToken.decimals)
    }

    // Cross-chain: show approximate (fee deducted)
    if (isCrossChain) {
      const fee = parsedAmount / 200n // ~0.5% fee
      return formatUnits(parsedAmount - fee, outputToken.decimals)
    }

    return ''
  }

  const handleSwitchNetwork = async () => {
    if (!switchChain) {
      toast.error('Please switch to the correct network in MetaMask')
      return
    }
    try {
      await switchChain({ chainId: CHAIN_ID })
      toast.success('Switched to Jeju network')
    } catch (error) {
      const err = error as Error
      if (err.message?.includes('reject') || err.message?.includes('denied')) {
        return
      }
      toast.error(err.message || 'Failed to switch network')
    }
  }

  const handleSwap = async () => {
    if (!isConnected || !address) {
      toast.error('Connect your wallet first')
      return
    }

    if (!inputAmount || parsedAmount <= 0n) {
      toast.error('Enter an amount')
      return
    }

    if (hasInsufficientBalance) {
      toast.error('Insufficient balance')
      return
    }

    const to =
      recipient.startsWith('0x') && recipient.length === 42
        ? (recipient as Address)
        : address

    // Cross-chain swap via EIL
    if (isCrossChain && eilAvailable) {
      await executeCrossChainSwap({
        sourceToken: inputToken.address,
        destinationToken: outputToken.address,
        amount: parsedAmount,
        sourceChainId,
        destinationChainId: destChainId,
        recipient: to,
      })
      return
    }

    // Same-chain swap for different tokens
    if (!isSameToken && !isCrossChain) {
      try {
        await executeSameChainSwap({
          sourceToken: inputToken.address,
          destinationToken: outputToken.address,
          amount: parsedAmount,
          sourceDecimals: inputToken.decimals,
          destDecimals: outputToken.decimals,
          rate: 1.0,
        })
        toast.success('Swap executed successfully')
        return
      } catch (error) {
        const err = error as Error
        toast.error(err.message || 'Swap failed')
        return
      }
    }

    // Fallback: Direct transfer (same token)
    if (inputToken.address === ZERO_ADDRESS) {
      sendTransaction({
        to,
        value: parsedAmount,
      })
    } else {
      writeContract({
        address: inputToken.address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to, parsedAmount],
      })
    }
  }

  const swapTokens = useCallback(() => {
    const temp = inputToken
    setInputToken(outputToken)
    setOutputToken(temp)
  }, [inputToken, outputToken])

  const getButtonText = () => {
    if (!isConnected) return 'Connect Wallet'
    if (!isCorrectChain && !isCrossChain) return 'Switch Network'
    if (isPending) return 'Confirm in Wallet...'
    if (isConfirming) return 'Processing...'
    if (!inputAmount) return 'Enter Amount'
    if (hasInsufficientBalance) return 'Insufficient Balance'
    if (isCrossChain)
      return `Bridge to ${SUPPORTED_CHAINS.find((c) => c.id === destChainId)?.name}`
    if (!isSameToken) return 'Swap'
    if (showRecipient && recipient) return 'Send'
    return 'Transfer'
  }

  const getTransactionType = () => {
    if (isCrossChain) return 'Cross-Chain Bridge'
    if (!isSameToken) return 'Swap'
    return 'Transfer'
  }

  const isButtonDisabled =
    !isConnected ||
    (!isCorrectChain && !isCrossChain) ||
    isPending ||
    isConfirming ||
    !inputAmount ||
    hasInsufficientBalance

  return (
    <div className="max-w-lg mx-auto animate-fade-in">
      <PageHeader
        icon="🔄"
        title="Swap"
        description="Swap tokens or bridge across chains"
      />

      {/* Network Warning */}
      {isConnected && !isCorrectChain && !isCrossChain && (
        <div className="mb-6">
          <InfoCard variant="error">
            <div className="flex items-center justify-between gap-4">
              <span>Switch to the correct network to swap</span>
              <button
                type="button"
                onClick={handleSwitchNetwork}
                className="btn-primary px-4 py-2 text-sm"
              >
                Switch Network
              </button>
            </div>
          </InfoCard>
        </div>
      )}

      {/* Swap Card */}
      <div className="card p-5 md:p-6">
        {/* Chain Selector for Cross-Chain */}
        <div className="mb-4 p-3 rounded-xl bg-surface-secondary">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <label
                htmlFor="source-chain"
                className="text-xs text-tertiary block mb-1"
              >
                From Chain
              </label>
              <select
                id="source-chain"
                value={sourceChainId}
                onChange={(e) => setSourceChainId(Number(e.target.value))}
                className="input text-sm py-1.5"
              >
                {SUPPORTED_CHAINS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="pt-5">
              <Zap
                className={`w-4 h-4 ${isCrossChain ? 'text-primary-color' : 'text-tertiary'}`}
              />
            </div>
            <div className="flex-1">
              <label
                htmlFor="dest-chain"
                className="text-xs text-tertiary block mb-1"
              >
                To Chain
              </label>
              <select
                id="dest-chain"
                value={destChainId}
                onChange={(e) => setDestChainId(Number(e.target.value))}
                className="input text-sm py-1.5"
              >
                {SUPPORTED_CHAINS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {isCrossChain && !eilAvailable && (
            <p className="text-xs text-warning mt-2">
              Cross-chain bridge not available on this network
            </p>
          )}
        </div>

        {/* From Section */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="input-amount" className="text-sm text-tertiary">
              You Pay
            </label>
            <button
              type="button"
              onClick={() => {
                if (currentBalance > 0n) {
                  setInputAmount(
                    formatUnits(currentBalance, inputToken.decimals),
                  )
                }
              }}
              className="text-xs text-primary-color hover:underline"
            >
              Balance:{' '}
              {formatUnits(currentBalance, inputToken.decimals).slice(0, 10)}{' '}
              {inputToken.symbol}
            </button>
          </div>
          <div className="flex gap-2">
            <input
              id="input-amount"
              type="number"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              placeholder="0.0"
              min="0"
              step="0.001"
              className={`input flex-1 text-xl font-semibold ${
                hasInsufficientBalance ? 'border-error' : ''
              }`}
            />
            <select
              value={inputToken.symbol}
              onChange={(e) => {
                const token = availableTokens.find(
                  (t) => t.symbol === e.target.value,
                )
                if (token) setInputToken(token)
              }}
              className="input w-28 font-medium"
              disabled={tokensLoading}
            >
              {availableTokens.map((token) => (
                <option key={`in-${token.address}`} value={token.symbol}>
                  {token.symbol}
                </option>
              ))}
            </select>
          </div>
          {hasInsufficientBalance && (
            <p className="text-xs text-error mt-1">Insufficient balance</p>
          )}
        </div>

        {/* Swap Direction Button */}
        <div className="flex justify-center my-3">
          <button
            type="button"
            onClick={swapTokens}
            className="p-2.5 rounded-xl bg-surface-secondary hover:bg-surface-elevated transition-all hover:scale-110 active:scale-95"
            aria-label="Swap tokens"
          >
            <ArrowDownUp className="w-5 h-5 text-primary" />
          </button>
        </div>

        {/* To Section */}
        <div className="mb-4">
          <label
            htmlFor="output-amount"
            className="text-sm text-tertiary block mb-2"
          >
            You Receive
          </label>
          <div className="flex gap-2">
            <input
              id="output-amount"
              type="text"
              value={getOutputDisplay()}
              placeholder="0.0"
              readOnly
              className="input flex-1 text-xl font-semibold bg-surface-secondary"
            />
            <select
              value={outputToken.symbol}
              onChange={(e) => {
                const token = availableTokens.find(
                  (t) => t.symbol === e.target.value,
                )
                if (token) setOutputToken(token)
              }}
              className="input w-28 font-medium"
              disabled={tokensLoading}
            >
              {availableTokens.map((token) => (
                <option key={`out-${token.address}`} value={token.symbol}>
                  {token.symbol}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Optional Recipient */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowRecipient(!showRecipient)}
            className="text-sm text-primary-color hover:underline"
          >
            {showRecipient ? '− Hide recipient' : '+ Send to different address'}
          </button>

          {showRecipient && (
            <div className="mt-2 animate-fade-in">
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x..."
                className="input font-mono text-sm"
              />
            </div>
          )}
        </div>

        {/* Transaction Summary */}
        {inputAmount && parseFloat(inputAmount) > 0 && (
          <div className="mb-4 p-4 rounded-xl bg-surface-secondary animate-fade-in">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-tertiary">Type</dt>
                <dd className="text-primary font-medium">
                  {getTransactionType()}
                </dd>
              </div>

              {quote && canSwap && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-tertiary">Rate</dt>
                    <dd className="text-primary">
                      1 {inputToken.symbol} ={' '}
                      {(
                        (Number(quote.outputAmount) /
                          Number(quote.inputAmount)) *
                        10 ** (inputToken.decimals - outputToken.decimals)
                      ).toFixed(4)}{' '}
                      {outputToken.symbol}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-tertiary">Price Impact</dt>
                    <dd
                      className={
                        quote.priceImpact > 3 ? 'text-warning' : 'text-primary'
                      }
                    >
                      {quote.priceImpact.toFixed(2)}%
                    </dd>
                  </div>
                </>
              )}

              <div className="flex justify-between">
                <dt className="text-tertiary flex items-center gap-1">
                  <Fuel className="w-3 h-3" /> Est. Fee
                </dt>
                <dd className="text-primary">
                  {isCrossChain ? '~0.5%' : '~0.001 ETH'}
                </dd>
              </div>

              {isCrossChain && (
                <div className="flex justify-between">
                  <dt className="text-tertiary flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Est. Time
                  </dt>
                  <dd className="text-primary">~2-5 minutes</dd>
                </div>
              )}

              {recipient && (
                <div className="flex justify-between">
                  <dt className="text-tertiary">Recipient</dt>
                  <dd className="text-primary font-mono text-xs">
                    {recipient.slice(0, 10)}...{recipient.slice(-8)}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {/* Swap Button */}
        <button
          type="button"
          onClick={handleSwap}
          disabled={isButtonDisabled}
          className="btn-primary w-full py-4 text-lg font-semibold flex items-center justify-center gap-2"
        >
          {(isPending || isConfirming) && (
            <Loader2 className="w-5 h-5 animate-spin" />
          )}
          {getButtonText()}
        </button>

        {/* Error Message */}
        {swapError && (
          <div className="mt-4 p-3 rounded-xl border border-error/30 bg-error/10 text-center">
            <p className="text-error text-sm">{swapError}</p>
          </div>
        )}

        {/* Success Message */}
        {isSuccess && txHash && (
          <div className="mt-4 p-4 rounded-xl border border-success/30 bg-success/10 text-center animate-scale-in">
            <p className="text-success font-medium mb-2">
              Transaction Successful
            </p>
            <a
              href={`https://explorer.jejunetwork.org/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary-color hover:underline font-mono"
            >
              View on Explorer →
            </a>
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="mt-6 p-4 rounded-xl bg-surface-secondary/50">
        <div className="flex items-center gap-2 text-sm text-tertiary">
          <RefreshCw className="w-4 h-4" />
          <span>
            {routerAvailable
              ? 'Swaps powered by XLP AMM'
              : 'Swap router deploying soon - transfers available now'}
          </span>
        </div>
        {eilAvailable && (
          <div className="flex items-center gap-2 text-sm text-tertiary mt-2">
            <Zap className="w-4 h-4" />
            <span>Cross-chain bridging powered by EIL</span>
          </div>
        )}
      </div>
    </div>
  )
}
