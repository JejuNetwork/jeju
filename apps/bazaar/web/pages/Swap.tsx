/**
 * Swap Page
 *
 * Current capabilities:
 * - ETH transfers between addresses
 * - Token transfers (ERC20) on same chain
 *
 * Future (when contracts deployed):
 * - Uniswap V4 pool swaps via SwapRouter
 * - Cross-chain swaps via EIL bridge
 */

import { ArrowDownUp, Fuel, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
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
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import { CHAIN_ID } from '../../config'
import { InfoCard, PageHeader } from '../components/ui'

interface Token {
  symbol: string
  name: string
  address: Address
  decimals: number
  logoUrl?: string
}

// Native ETH
const ETH_TOKEN: Token = {
  symbol: 'ETH',
  name: 'Ether',
  address: '0x0000000000000000000000000000000000000000',
  decimals: 18,
}

// Common tokens - can be extended from indexer
const COMMON_TOKENS: Token[] = [ETH_TOKEN]

export default function SwapPage() {
  const { address, isConnected, chain } = useAccount()
  const publicClient = usePublicClient()
  const isCorrectChain = chain?.id === CHAIN_ID

  // Form state
  const [inputAmount, setInputAmount] = useState('')
  const [inputToken, setInputToken] = useState<Token>(ETH_TOKEN)
  const [outputToken, setOutputToken] = useState<Token>(ETH_TOKEN)
  const [recipient, setRecipient] = useState('')
  const [showRecipient, setShowRecipient] = useState(false)

  // Balance
  const { data: ethBalance } = useBalance({ address })
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n)

  // ETH transfer
  const {
    sendTransaction,
    data: sendTxHash,
    isPending: isSendPending,
  } = useSendTransaction()

  // ERC20 transfer
  const {
    writeContract,
    data: writeTxHash,
    isPending: isWritePending,
  } = useWriteContract()

  const txHash = sendTxHash || writeTxHash
  const isPending = isSendPending || isWritePending

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  // Fetch token balance
  useEffect(() => {
    async function fetchBalance() {
      if (
        !address ||
        !publicClient ||
        inputToken.address === ETH_TOKEN.address
      ) {
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

  // Handle success
  useEffect(() => {
    if (isSuccess && txHash) {
      toast.success('Transfer completed successfully')
      setInputAmount('')
      setRecipient('')
    }
  }, [isSuccess, txHash])

  const currentBalance =
    inputToken.address === ETH_TOKEN.address
      ? (ethBalance?.value ?? 0n)
      : tokenBalance

  const parsedAmount = inputAmount
    ? parseUnits(inputAmount, inputToken.decimals)
    : 0n

  const hasInsufficientBalance = parsedAmount > currentBalance
  const isTransfer = inputToken.symbol === outputToken.symbol

  // Calculate output - for same token it's 1:1 minus gas
  const estimatedGas = parseEther('0.001') // ~21k gas at 50 gwei
  const outputAmount =
    isTransfer && parsedAmount > estimatedGas
      ? formatUnits(parsedAmount - estimatedGas, outputToken.decimals)
      : ''

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

    if (inputToken.address === ETH_TOKEN.address) {
      // Send ETH
      sendTransaction({
        to,
        value: parsedAmount,
      })
    } else {
      // Transfer ERC20
      writeContract({
        address: inputToken.address,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [to, parsedAmount],
      })
    }
  }

  const getButtonText = () => {
    if (!isConnected) return 'Connect Wallet'
    if (!isCorrectChain) return 'Switch Network'
    if (isPending) return 'Confirm in Wallet...'
    if (isConfirming) return 'Processing...'
    if (!inputAmount) return 'Enter Amount'
    if (hasInsufficientBalance) return 'Insufficient Balance'
    if (showRecipient && recipient) return 'Send'
    return isTransfer ? 'Transfer' : 'Swap'
  }

  const isButtonDisabled =
    !isConnected ||
    !isCorrectChain ||
    isPending ||
    isConfirming ||
    !inputAmount ||
    hasInsufficientBalance

  return (
    <div className="max-w-lg mx-auto animate-fade-in">
      <PageHeader
        icon="🔄"
        title="Swap"
        description="Transfer tokens on the Jeju Network"
      />

      {/* Info Cards */}
      <div className="space-y-3 mb-6">
        {!isTransfer && (
          <InfoCard variant="warning">
            <p className="font-medium mb-1">DEX Not Available</p>
            <p className="text-sm opacity-80">
              Token swaps require the SwapRouter contract. Currently only
              same-token transfers are supported.
            </p>
          </InfoCard>
        )}

        {isConnected && !isCorrectChain && (
          <InfoCard variant="error">
            Please switch to the Jeju network to continue.
          </InfoCard>
        )}
      </div>

      {/* Swap Card */}
      <div className="card p-5 md:p-6">
        {/* From Section */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="input-amount" className="text-sm text-tertiary">
              From
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
                const token = COMMON_TOKENS.find(
                  (t) => t.symbol === e.target.value,
                )
                if (token) setInputToken(token)
              }}
              className="input w-28 font-medium"
            >
              {COMMON_TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>
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
            onClick={() => {
              const temp = inputToken
              setInputToken(outputToken)
              setOutputToken(temp)
            }}
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
            To
          </label>
          <div className="flex gap-2">
            <input
              id="output-amount"
              type="text"
              value={outputAmount}
              placeholder="0.0"
              readOnly
              className="input flex-1 text-xl font-semibold bg-surface-secondary"
            />
            <select
              value={outputToken.symbol}
              onChange={(e) => {
                const token = COMMON_TOKENS.find(
                  (t) => t.symbol === e.target.value,
                )
                if (token) setOutputToken(token)
              }}
              className="input w-28 font-medium"
            >
              {COMMON_TOKENS.map((token) => (
                <option key={token.symbol} value={token.symbol}>
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
                  {isTransfer ? 'Transfer' : 'Swap'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-tertiary flex items-center gap-1">
                  <Fuel className="w-3 h-3" /> Estimated Gas
                </dt>
                <dd className="text-primary">~0.001 ETH</dd>
              </div>
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

        {/* Success Message */}
        {isSuccess && txHash && (
          <div className="mt-4 p-4 rounded-xl border border-success/30 bg-success/10 text-center animate-scale-in">
            <p className="text-success font-medium mb-2">Transfer Successful</p>
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

      {/* Feature Status */}
      <div className="mt-6 card p-4">
        <h3 className="text-sm font-medium text-primary mb-3">
          Available Features
        </h3>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <span className="text-success">✓</span>
            <span className="text-secondary">ETH transfers</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-success">✓</span>
            <span className="text-secondary">ERC20 token transfers</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-tertiary">○</span>
            <span className="text-tertiary">
              Token swaps (requires SwapRouter)
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span className="text-tertiary">○</span>
            <span className="text-tertiary">
              Cross-chain swaps (requires EIL)
            </span>
          </li>
        </ul>
      </div>
    </div>
  )
}
