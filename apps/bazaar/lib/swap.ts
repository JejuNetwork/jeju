/**
 * Swap business logic
 * Pure functions for swap calculations, validation, and quote generation
 *
 * Note: Token addresses and pricing are loaded from config.
 * Price rates should come from on-chain oracles when available.
 */

import { type Address, formatEther, parseEther } from 'viem'
import type {
  SwapFeeEstimate,
  SwapQuote,
  SwapToken,
  SwapValidationResult,
} from '../schemas/swap'

// Re-export from API (single source of truth)
export { SWAP_TOKENS } from '../api/swap'

export const DEFAULT_FEE_BPS = 30n
export const BASE_NETWORK_FEE = parseEther('0.001')
export const CROSS_CHAIN_PREMIUM = parseEther('0.0005')
export const XLP_FEE_BPS = 5n

export function getTokenBySymbol(
  symbol: string,
  tokens: SwapToken[] = SWAP_TOKENS,
): SwapToken | undefined {
  return tokens.find((t) => t.symbol === symbol)
}

/**
 * Find token by address
 */
export function getTokenByAddress(
  address: Address,
  tokens: SwapToken[] = SWAP_TOKENS,
): SwapToken | undefined {
  return tokens.find((t) => t.address.toLowerCase() === address.toLowerCase())
}

/**
 * Get exchange rate between tokens
 * Returns 1 for same token, throws for unknown pairs (no oracle data)
 */
export function getExchangeRate(fromSymbol: string, toSymbol: string): number {
  if (fromSymbol === toSymbol) return 1

  // No oracle integration yet - throw error for unknown pairs
  throw new Error(
    `Exchange rate not available for ${fromSymbol}/${toSymbol} - oracle integration pending`,
  )
}

/**
 * Format rate for display
 */
export function formatRate(
  fromSymbol: string,
  toSymbol: string,
  rate: number,
): string {
  if (rate >= 1) {
    return `1 ${fromSymbol} = ${rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${toSymbol}`
  }
  const inverse = 1 / rate
  return `1 ${toSymbol} = ${inverse.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${fromSymbol}`
}

export function isCrossChain(
  sourceChainId: number,
  destChainId: number,
): boolean {
  return sourceChainId !== destChainId
}

/**
 * Calculate swap fees
 */
export function calculateSwapFees(
  amount: bigint,
  sourceChainId: number,
  destChainId: number,
): SwapFeeEstimate {
  // XLP fee: 0.05% of amount
  const xlpFee = (amount * XLP_FEE_BPS) / 10000n

  // Network fee with cross-chain premium
  const crossChainPremium = isCrossChain(sourceChainId, destChainId)
    ? CROSS_CHAIN_PREMIUM
    : 0n
  const networkFee = BASE_NETWORK_FEE + crossChainPremium

  // Estimated time in seconds
  const estimatedTime = isCrossChain(sourceChainId, destChainId) ? 10 : 0

  return {
    networkFee,
    xlpFee,
    totalFee: networkFee + xlpFee,
    estimatedTime,
  }
}

export function calculateOutputAmount(
  inputAmount: bigint,
  inputSymbol: string,
  outputSymbol: string,
  fees: SwapFeeEstimate,
  feeBps: bigint = DEFAULT_FEE_BPS,
): bigint {
  if (inputAmount <= 0n) return 0n

  // Deduct fees
  const afterFees = inputAmount - fees.totalFee
  if (afterFees <= 0n) return 0n

  // Apply swap fee (0.3%)
  const afterSwapFee = afterFees - (afterFees * feeBps) / 10000n
  if (afterSwapFee <= 0n) return 0n

  // Get exchange rate - will throw if no oracle data available
  const rate = getExchangeRate(inputSymbol, outputSymbol)

  // Convert to output token
  const outputValue =
    (afterSwapFee * BigInt(Math.floor(rate * 1e18))) / parseEther('1')

  return outputValue > 0n ? outputValue : 0n
}

/**
 * Generate a complete swap quote
 */
export function generateSwapQuote(
  inputAmountWei: bigint,
  inputSymbol: string,
  outputSymbol: string,
  sourceChainId: number,
  destChainId: number,
  feeBps: bigint = DEFAULT_FEE_BPS,
): SwapQuote {
  const fees = calculateSwapFees(inputAmountWei, sourceChainId, destChainId)
  const outputAmount = calculateOutputAmount(
    inputAmountWei,
    inputSymbol,
    outputSymbol,
    fees,
    feeBps,
  )
  const rate = getExchangeRate(inputSymbol, outputSymbol)
  const rateDisplay = formatRate(inputSymbol, outputSymbol, rate)

  return {
    inputAmount: inputAmountWei,
    outputAmount,
    rate,
    rateDisplay,
    feePercent: Number(feeBps) / 100,
    fees,
    isCrossChain: isCrossChain(sourceChainId, destChainId),
  }
}

export function validateSwap(
  isConnected: boolean,
  inputAmount: string,
  inputToken: string,
  outputToken: string,
  sourceChainId: number,
  destChainId: number,
  isCorrectChain: boolean,
  eilAvailable: boolean,
): SwapValidationResult {
  if (!isConnected) {
    return { valid: false, error: 'Connect your wallet first' }
  }

  if (!inputAmount || parseFloat(inputAmount) <= 0) {
    return { valid: false, error: 'Enter an amount' }
  }

  const isXChain = isCrossChain(sourceChainId, destChainId)

  // Same token on same chain is not allowed
  if (inputToken === outputToken && !isXChain) {
    return { valid: false, error: 'Select different tokens' }
  }

  // Cross-chain requires EIL
  if (isXChain && !eilAvailable) {
    return { valid: false, error: 'Cross-chain swaps not available yet' }
  }

  // Same-chain requires correct network
  if (!isXChain && !isCorrectChain) {
    return { valid: false, error: 'Switch to the correct network' }
  }

  return { valid: true }
}

/**
 * Parse input amount safely
 */
export function parseSwapAmount(input: string): bigint {
  if (!input || input.trim() === '') return 0n
  const parsed = parseFloat(input)
  if (Number.isNaN(parsed) || parsed <= 0) return 0n
  return parseEther(input)
}

export function formatSwapAmount(amount: bigint): string {
  if (amount <= 0n) return ''
  return formatEther(amount)
}

/**
 * Get button text based on current state
 */
export function getSwapButtonText(
  isConnected: boolean,
  isSwapping: boolean,
  isCorrectChain: boolean,
  hasInput: boolean,
  isCrossChainSwap: boolean,
  destChainName: string,
): string {
  if (!isConnected) return 'Connect Wallet'
  if (isSwapping) return 'Swapping...'
  if (!hasInput) return 'Enter Amount'
  if (isCrossChainSwap) return `Swap to ${destChainName}`
  if (!isCorrectChain) return 'Switch Network'
  return 'Swap'
}

export function isSwapButtonDisabled(
  isConnected: boolean,
  isSwapping: boolean,
  isCorrectChain: boolean,
  hasInput: boolean,
  isCrossChainSwap: boolean,
): boolean {
  if (!isConnected) return true
  if (isSwapping) return true
  if (!hasInput) return true
  if (!isCrossChainSwap && !isCorrectChain) return true
  return false
}
