import { BondingCurveAbi } from '@jejunetwork/contracts'
import { AddressSchema } from '@jejunetwork/types'
import { type Address, formatEther, parseEther } from 'viem'
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import {
  type BondingCurveStats,
  parseBondingCurveStats,
} from '../../lib/launchpad'
import { expect, expectPositive } from '../../lib/validation'

export type { BondingCurveStats }

export interface BondingCurveQuote {
  tokensOut: bigint
  ethOut: bigint
  priceImpact: number
}

/**
 * Hook to interact with a bonding curve token
 */
export function useBondingCurve(bondingCurveAddress: Address | null) {
  const { isConnected } = useAccount()
  const enabled = !!bondingCurveAddress

  // Write contract hook
  const {
    writeContract,
    data: txHash,
    isPending: isWritePending,
    error: writeError,
    reset,
  } = useWriteContract()

  // Wait for transaction
  const {
    isLoading: isConfirming,
    isSuccess,
    data: receipt,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  // Read current stats
  const { data: stats, refetch: refetchStats } = useReadContract({
    address: bondingCurveAddress ?? undefined,
    abi: BondingCurveAbi,
    functionName: 'getStats',
    query: {
      enabled,
      refetchInterval: 5000, // Refresh every 5 seconds
    },
  })

  // Read token address
  const { data: tokenAddress } = useReadContract({
    address: bondingCurveAddress ?? undefined,
    abi: BondingCurveAbi,
    functionName: 'token',
    query: { enabled },
  })

  // Read graduation status
  const { data: graduated } = useReadContract({
    address: bondingCurveAddress ?? undefined,
    abi: BondingCurveAbi,
    functionName: 'graduated',
    query: { enabled },
  })

  // Read LP pair (after graduation)
  const { data: lpPair } = useReadContract({
    address: bondingCurveAddress ?? undefined,
    abi: BondingCurveAbi,
    functionName: 'lpPair',
    query: { enabled: enabled && graduated === true },
  })

  // Read graduation target
  const { data: graduationTarget } = useReadContract({
    address: bondingCurveAddress ?? undefined,
    abi: BondingCurveAbi,
    functionName: 'graduationTarget',
    query: { enabled },
  })

  // Parse stats using typed parser
  const parsedStats: BondingCurveStats | undefined = stats
    ? parseBondingCurveStats(
        stats as readonly [bigint, bigint, bigint, bigint, boolean],
      )
    : undefined

  /**
   * Buy tokens with ETH
   */
  const buy = (ethAmount: string, minTokensOut: string = '0') => {
    const validatedAddress = expect(
      bondingCurveAddress,
      'No bonding curve address',
    )
    AddressSchema.parse(validatedAddress)
    expectPositive(parseFloat(ethAmount), 'ETH amount must be positive')

    reset()
    writeContract({
      address: validatedAddress,
      abi: BondingCurveAbi,
      functionName: 'buy',
      args: [parseEther(minTokensOut)],
      value: parseEther(ethAmount),
    })
  }

  /**
   * Sell tokens for ETH
   */
  const sell = (tokenAmount: string, minEthOut: string = '0') => {
    const validatedAddress = expect(
      bondingCurveAddress,
      'No bonding curve address',
    )
    AddressSchema.parse(validatedAddress)
    expectPositive(parseFloat(tokenAmount), 'Token amount must be positive')

    reset()
    writeContract({
      address: validatedAddress,
      abi: BondingCurveAbi,
      functionName: 'sell',
      args: [parseEther(tokenAmount), parseEther(minEthOut)],
    })
  }

  return {
    // State
    isConnected,
    bondingCurveAddress,
    tokenAddress: tokenAddress as Address | undefined,
    graduated: graduated as boolean | undefined,
    lpPair: lpPair as Address | undefined,
    graduationTarget: graduationTarget as bigint | undefined,
    stats: parsedStats,

    // Transaction state
    txHash,
    isPending: isWritePending || isConfirming,
    isSuccess,
    receipt,
    error: writeError,

    // Actions
    buy,
    sell,
    refetchStats,
    reset,
  }
}

/**
 * Hook to get a quote for buying tokens
 */
export function useBondingCurveQuote(
  bondingCurveAddress: Address | null,
  ethAmount: string,
  direction: 'buy' | 'sell' = 'buy',
) {
  const enabled =
    !!bondingCurveAddress && !!ethAmount && parseFloat(ethAmount) > 0

  // Quote for buying
  const { data: tokensOut } = useReadContract({
    address: bondingCurveAddress ?? undefined,
    abi: BondingCurveAbi,
    functionName: 'getTokensOut',
    args: enabled && direction === 'buy' ? [parseEther(ethAmount)] : undefined,
    query: { enabled: enabled && direction === 'buy' },
  })

  // Quote for selling (ethAmount is actually tokenAmount in this case)
  const { data: ethOut } = useReadContract({
    address: bondingCurveAddress ?? undefined,
    abi: BondingCurveAbi,
    functionName: 'getEthOut',
    args: enabled && direction === 'sell' ? [parseEther(ethAmount)] : undefined,
    query: { enabled: enabled && direction === 'sell' },
  })

  // Get current price for impact calculation
  const { data: currentPrice } = useReadContract({
    address: bondingCurveAddress ?? undefined,
    abi: BondingCurveAbi,
    functionName: 'getCurrentPrice',
    query: { enabled },
  })

  // Calculate price impact
  let priceImpact = 0
  if (
    direction === 'buy' &&
    tokensOut &&
    currentPrice &&
    parseFloat(ethAmount) > 0
  ) {
    const tokens = Number(formatEther(tokensOut as bigint))
    const eth = parseFloat(ethAmount)
    const effectivePrice = eth / tokens
    const marketPrice = Number(formatEther(currentPrice as bigint))
    priceImpact = ((effectivePrice - marketPrice) / marketPrice) * 100
  }

  return {
    tokensOut: tokensOut as bigint | undefined,
    ethOut: ethOut as bigint | undefined,
    currentPrice: currentPrice as bigint | undefined,
    priceImpact,
  }
}
