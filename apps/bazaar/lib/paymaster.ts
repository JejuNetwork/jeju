/**
 * Paymaster business logic
 *
 * Re-exports shared paymaster utilities and adds Bazaar-specific helpers
 * for gas token selection in swaps.
 *
 * Paymasters enable gasless transactions by paying gas fees in ERC-20 tokens
 * instead of ETH. Users can swap without holding ETH.
 */

import type { Address } from 'viem'
import { formatEther } from 'viem'

// Re-export from shared package
export {
  checkPaymasterApproval,
  estimateTokenCost,
  generatePaymasterData,
  getApprovalTxData,
  getAvailablePaymasters,
  getPaymasterForToken,
  getPaymasterOptions,
  type PaymasterConfig,
  type PaymasterInfo,
  type PaymasterOption,
  preparePaymasterData,
} from '@jejunetwork/shared'

// ═══════════════════════════════════════════════════════════════════════════
// Feature flag
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if paymaster feature is enabled
 * Can be controlled via environment variable
 */
export function isPaymasterEnabled(): boolean {
  // Default to enabled unless explicitly disabled
  if (
    typeof process !== 'undefined' &&
    process.env?.DISABLE_PAYMASTER === 'true'
  ) {
    return false
  }
  return true
}

// ═══════════════════════════════════════════════════════════════════════════
// Bazaar-specific helpers
// ═══════════════════════════════════════════════════════════════════════════

// Type imports for local use
import type { PaymasterInfo, PaymasterOption } from '@jejunetwork/shared'

// Preferred tokens for gas payment (in order)
const PREFERRED_GAS_TOKENS = ['JEJU', 'USDC', 'USDT', 'DAI']

/**
 * Get the best paymaster option for a swap
 * Prefers JEJU > USDC > others by cost
 */
export function getBestPaymasterForSwap(
  options: PaymasterOption[],
  preferredToken?: Address,
): PaymasterOption | null {
  if (options.length === 0) return null

  // If user specified a preference, try to use it
  if (preferredToken) {
    const preferred = options.find(
      (opt) =>
        opt.paymaster.token.toLowerCase() === preferredToken.toLowerCase(),
    )
    if (preferred) return preferred
  }

  // Sort by preference then by cost
  const sorted = [...options].sort((a, b) => {
    const aIndex = PREFERRED_GAS_TOKENS.indexOf(a.paymaster.tokenSymbol)
    const bIndex = PREFERRED_GAS_TOKENS.indexOf(b.paymaster.tokenSymbol)

    // Preferred tokens first
    if (aIndex !== -1 && bIndex === -1) return -1
    if (aIndex === -1 && bIndex !== -1) return 1
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex

    // Then by cost
    return Number(a.estimatedCost - b.estimatedCost)
  })

  return sorted[0]
}

/**
 * Format paymaster cost for display
 */
export function formatPaymasterCost(option: PaymasterOption): string {
  const { estimatedCost, paymaster } = option
  const formatted = formatEther(estimatedCost)

  // Truncate to reasonable precision
  const num = parseFloat(formatted)
  if (num === 0) return `0 ${paymaster.tokenSymbol}`
  if (num < 0.0001) return `<0.0001 ${paymaster.tokenSymbol}`
  if (num < 1) return `~${num.toFixed(4)} ${paymaster.tokenSymbol}`
  return `~${num.toFixed(2)} ${paymaster.tokenSymbol}`
}

/**
 * Get display info for a paymaster
 */
export function getPaymasterDisplayInfo(paymaster: PaymasterInfo): {
  symbol: string
  name: string
  isRecommended: boolean
} {
  return {
    symbol: paymaster.tokenSymbol,
    name: paymaster.tokenName,
    isRecommended: PREFERRED_GAS_TOKENS.includes(paymaster.tokenSymbol),
  }
}

/**
 * Check if user has sufficient balance for gas payment
 */
export function hasSufficientGasTokenBalance(
  tokenBalance: bigint,
  estimatedCost: bigint,
  buffer: bigint = 10n, // 10% buffer
): boolean {
  const costWithBuffer = estimatedCost + (estimatedCost * buffer) / 100n
  return tokenBalance >= costWithBuffer
}

/**
 * Default gas estimates for swap operations
 */
export const SWAP_GAS_ESTIMATES = {
  sameChainSwap: 150_000n,
  crossChainSwap: 300_000n,
  tokenApproval: 50_000n,
} as const

/**
 * Estimate gas for a swap operation
 */
export function estimateSwapGas(
  isCrossChain: boolean,
  needsApproval: boolean,
): bigint {
  let gas = isCrossChain
    ? SWAP_GAS_ESTIMATES.crossChainSwap
    : SWAP_GAS_ESTIMATES.sameChainSwap

  if (needsApproval) {
    gas += SWAP_GAS_ESTIMATES.tokenApproval
  }

  return gas
}
