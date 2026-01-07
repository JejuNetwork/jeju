/**
 * usePaymaster Hook
 *
 * React hook for ERC-4337 paymaster integration.
 * Enables gasless transactions by paying gas fees with tokens.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { type Address, formatEther } from 'viem'
import { useGasPrice } from 'wagmi'
import { useNetworkContext } from '../context'
import { requireClient } from './utils'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Paymaster information */
export interface PaymasterInfo {
  /** Paymaster contract address */
  address: Address
  /** Token used for gas payment */
  token: Address
  /** Token symbol */
  tokenSymbol: string
  /** Token decimals */
  tokenDecimals: number
  /** Exchange rate to ETH (scaled by 1e18) */
  exchangeRate: bigint
  /** Whether this paymaster is currently active */
  isActive: boolean
}

/** Cost estimate for a paymaster */
export interface PaymasterCostEstimate {
  paymaster: PaymasterInfo
  /** Estimated cost in token */
  cost: bigint
  /** Formatted cost string */
  costFormatted: string
  /** Whether user has sufficient balance */
  hasSufficientBalance: boolean
  /** Recommended option */
  isRecommended: boolean
}

/** State returned by usePaymaster */
export interface UsePaymasterResult {
  /** Available paymasters */
  paymasters: PaymasterInfo[]
  /** Currently selected paymaster */
  selectedPaymaster: PaymasterInfo | null
  /** Whether gasless mode is enabled */
  isGasless: boolean
  /** Loading state */
  isLoading: boolean
  /** Error message */
  error: string | null
  /** Cost estimates for all paymasters */
  options: PaymasterCostEstimate[]
  /** Best option based on user balances */
  bestOption: PaymasterCostEstimate | null
  /** Current cost estimate */
  currentCostEstimate: { cost: bigint; costFormatted: string } | null
  /** Whether approval is needed */
  approvalNeeded: boolean
  /** Whether feature is enabled */
  isEnabled: boolean
  /** Select a paymaster */
  selectPaymaster: (address: Address | null) => void
  /** Toggle gasless mode */
  setIsGasless: (enabled: boolean) => void
  /** Reset state */
  reset: () => void
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook Implementation
// ═══════════════════════════════════════════════════════════════════════════

export function usePaymaster(): UsePaymasterResult {
  const { client } = useNetworkContext()
  const { data: gasPrice } = useGasPrice()

  // State
  const [paymasters, setPaymasters] = useState<PaymasterInfo[]>([])
  const [selectedPaymaster, setSelectedPaymaster] =
    useState<PaymasterInfo | null>(null)
  const [isGasless, setIsGasless] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [approvalNeeded, setApprovalNeeded] = useState(false)

  // Check if paymaster feature is available via SDK
  const isEnabled = useMemo(() => {
    if (!client) return false
    // Check if SDK has paymaster module
    return 'paymaster' in client
  }, [client])

  // Load available paymasters from SDK
  useEffect(() => {
    async function loadPaymasters() {
      if (!client || !isEnabled) {
        setPaymasters([])
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        // Use SDK's paymaster module if available
        const c = requireClient(client)
        if ('paymaster' in c && typeof c.paymaster === 'object' && c.paymaster !== null) {
          const pm = c.paymaster as { getAvailable?: () => Promise<PaymasterInfo[]> }
          if (pm.getAvailable) {
            const list = await pm.getAvailable()
            setPaymasters(list)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load paymasters')
        setPaymasters([])
      } finally {
        setIsLoading(false)
      }
    }

    loadPaymasters()
  }, [client, isEnabled])

  // Calculate cost estimates
  const options = useMemo<PaymasterCostEstimate[]>(() => {
    if (!gasPrice || paymasters.length === 0) return []

    const estimatedGas = 200_000n // Typical swap gas
    const baseCost = estimatedGas * gasPrice

    return paymasters.map((pm) => {
      // Convert ETH cost to token cost using exchange rate
      const tokenCost = pm.exchangeRate > 0n
        ? (baseCost * BigInt(1e18)) / pm.exchangeRate
        : baseCost

      return {
        paymaster: pm,
        cost: tokenCost,
        costFormatted: `~${(Number(tokenCost) / 10 ** pm.tokenDecimals).toFixed(4)} ${pm.tokenSymbol}`,
        hasSufficientBalance: true, // TODO: Check actual balance
        isRecommended: pm.tokenSymbol === 'USDC' || pm.tokenSymbol === 'DAI',
      }
    })
  }, [gasPrice, paymasters])

  const bestOption = useMemo(() => {
    if (options.length === 0) return null
    return options.find((o) => o.isRecommended && o.hasSufficientBalance) ?? options[0]
  }, [options])

  // Select paymaster
  const selectPaymaster = useCallback(
    (address: Address | null) => {
      if (!address) {
        setSelectedPaymaster(null)
        setIsGasless(false)
        return
      }

      const pm = paymasters.find(
        (p) => p.address.toLowerCase() === address.toLowerCase(),
      )
      if (pm) {
        setSelectedPaymaster(pm)
        setIsGasless(true)
      }
    },
    [paymasters],
  )

  // Current cost estimate
  const currentCostEstimate = useMemo(() => {
    if (!selectedPaymaster) return null
    const opt = options.find(
      (o) => o.paymaster.address.toLowerCase() === selectedPaymaster.address.toLowerCase(),
    )
    return opt ? { cost: opt.cost, costFormatted: opt.costFormatted } : null
  }, [selectedPaymaster, options])

  // Reset
  const reset = useCallback(() => {
    setSelectedPaymaster(null)
    setIsGasless(false)
    setApprovalNeeded(false)
  }, [])

  return {
    paymasters,
    selectedPaymaster,
    isGasless,
    isLoading,
    error,
    options,
    bestOption,
    currentCostEstimate,
    approvalNeeded,
    isEnabled,
    selectPaymaster,
    setIsGasless,
    reset,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility: Format ETH gas cost
// ═══════════════════════════════════════════════════════════════════════════

export function formatEthGasCost(gasEstimate: bigint, gasPrice: bigint | undefined): string {
  if (!gasPrice) return '...'
  const cost = gasEstimate * gasPrice
  const num = parseFloat(formatEther(cost))
  if (num === 0) return '0 ETH'
  if (num < 0.0001) return '<0.0001 ETH'
  return `~${num.toFixed(4)} ETH`
}
