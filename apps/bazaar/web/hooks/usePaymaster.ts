/**
 * usePaymaster Hook
 *
 * React hook for paymaster integration in swap flows.
 * Loads available paymasters, manages gas token selection,
 * and prepares gasless transactions.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { type Address, formatEther } from 'viem'
import { useAccount, useGasPrice } from 'wagmi'

import {
  checkPaymasterApproval,
  estimateSwapGas,
  formatPaymasterCost,
  getAvailablePaymasters,
  getPaymasterOptions,
  hasSufficientGasTokenBalance,
  isPaymasterEnabled,
  type PaymasterInfo,
  preparePaymasterData,
} from '../../lib/paymaster'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface PaymasterState {
  /** Available paymasters */
  paymasters: PaymasterInfo[]
  /** Currently selected paymaster (null = use ETH) */
  selectedPaymaster: PaymasterInfo | null
  /** Whether gasless mode is enabled */
  isGasless: boolean
  /** Loading state */
  isLoading: boolean
  /** Error message */
  error: string | null
}

export interface PaymasterCostEstimate {
  /** Paymaster info */
  paymaster: PaymasterInfo
  /** Estimated cost in token */
  cost: bigint
  /** Formatted cost string */
  costFormatted: string
  /** Whether user has sufficient balance */
  hasSufficientBalance: boolean
  /** Whether this is a recommended option */
  isRecommended: boolean
}

// ═══════════════════════════════════════════════════════════════════════════
// usePaymasterList - Load available paymasters
// ═══════════════════════════════════════════════════════════════════════════

export function usePaymasterList() {
  const [paymasters, setPaymasters] = useState<PaymasterInfo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      if (!isPaymasterEnabled()) {
        setPaymasters([])
        setIsLoading(false)
        return
      }

      try {
        const list = await getAvailablePaymasters()
        setPaymasters(list)
        setError(null)
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load paymasters'
        setError(message)
        setPaymasters([])
      } finally {
        setIsLoading(false)
      }
    }

    load()
  }, [])

  return { paymasters, isLoading, error }
}

// ═══════════════════════════════════════════════════════════════════════════
// usePaymasterCosts - Get cost estimates for all paymasters
// ═══════════════════════════════════════════════════════════════════════════

export function usePaymasterCosts(
  estimatedGas: bigint,
  tokenBalances?: Map<Address, bigint>,
) {
  const { data: gasPrice } = useGasPrice()
  const { paymasters, isLoading: paymasterLoading } = usePaymasterList()

  const [options, setOptions] = useState<PaymasterCostEstimate[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    async function fetchCosts() {
      if (!gasPrice || paymasters.length === 0 || estimatedGas <= 0n) {
        setOptions([])
        return
      }

      setIsLoading(true)

      try {
        const rawOptions = await getPaymasterOptions(estimatedGas, gasPrice)

        const estimates: PaymasterCostEstimate[] = rawOptions.map((opt) => {
          const balance = tokenBalances?.get(opt.paymaster.token) ?? 0n

          return {
            paymaster: opt.paymaster,
            cost: opt.estimatedCost,
            costFormatted: formatPaymasterCost(opt),
            hasSufficientBalance: hasSufficientGasTokenBalance(
              balance,
              opt.estimatedCost,
            ),
            isRecommended: opt.isRecommended,
          }
        })

        setOptions(estimates)
      } catch {
        setOptions([])
      } finally {
        setIsLoading(false)
      }
    }

    fetchCosts()
  }, [estimatedGas, gasPrice, paymasters, tokenBalances])

  return {
    options,
    isLoading: isLoading || paymasterLoading,
    bestOption:
      options.length > 0
        ? (options.find((o) => o.isRecommended) ?? options[0])
        : null,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// usePaymaster - Main hook for swap integration
// ═══════════════════════════════════════════════════════════════════════════

export function usePaymaster(isCrossChain: boolean = false) {
  const { address: userAddress } = useAccount()
  const { data: gasPrice } = useGasPrice()

  // State
  const [selectedPaymaster, setSelectedPaymaster] =
    useState<PaymasterInfo | null>(null)
  const [isGasless, setIsGasless] = useState(false)
  const [approvalNeeded, setApprovalNeeded] = useState(false)

  // Load paymasters
  const { paymasters, isLoading: paymasterLoading, error } = usePaymasterList()

  // Estimate gas
  const estimatedGas = useMemo(
    () => estimateSwapGas(isCrossChain, approvalNeeded),
    [isCrossChain, approvalNeeded],
  )

  // Get cost estimates
  const { options, bestOption } = usePaymasterCosts(estimatedGas)

  // Check if approval is needed when paymaster selected
  useEffect(() => {
    async function checkApproval() {
      if (!selectedPaymaster || !userAddress || !gasPrice) {
        setApprovalNeeded(false)
        return
      }

      const estimatedCost = (estimatedGas * gasPrice * 120n) / 100n // 20% buffer
      const hasApproval = await checkPaymasterApproval(
        userAddress,
        selectedPaymaster.token,
        selectedPaymaster.address,
        estimatedCost,
      )

      setApprovalNeeded(!hasApproval)
    }

    checkApproval()
  }, [selectedPaymaster, userAddress, gasPrice, estimatedGas])

  // Select a paymaster by address
  const selectPaymaster = useCallback(
    (address: Address | null) => {
      if (!address) {
        setSelectedPaymaster(null)
        setIsGasless(false)
        return
      }

      const paymaster = paymasters.find(
        (pm) => pm.address.toLowerCase() === address.toLowerCase(),
      )

      if (paymaster) {
        setSelectedPaymaster(paymaster)
        setIsGasless(true)
      }
    },
    [paymasters],
  )

  // Get paymaster data for transaction
  const getPaymasterData = useCallback(
    (maxTokenAmount: bigint) => {
      if (!selectedPaymaster) return null

      return preparePaymasterData(
        selectedPaymaster.address,
        selectedPaymaster.token,
        maxTokenAmount,
      )
    },
    [selectedPaymaster],
  )

  // Get the current gas cost estimate
  const currentCostEstimate = useMemo(() => {
    if (!selectedPaymaster || !gasPrice) return null

    const option = options.find(
      (o) =>
        o.paymaster.address.toLowerCase() ===
        selectedPaymaster.address.toLowerCase(),
    )

    if (!option) return null

    return {
      cost: option.cost,
      costFormatted: option.costFormatted,
      tokenSymbol: selectedPaymaster.tokenSymbol,
    }
  }, [selectedPaymaster, options, gasPrice])

  // Reset state
  const reset = useCallback(() => {
    setSelectedPaymaster(null)
    setIsGasless(false)
    setApprovalNeeded(false)
  }, [])

  return {
    // State
    paymasters,
    selectedPaymaster,
    isGasless,
    isLoading: paymasterLoading,
    error,

    // Cost info
    options,
    bestOption,
    currentCostEstimate,
    approvalNeeded,

    // Actions
    selectPaymaster,
    setIsGasless,
    getPaymasterData,
    reset,

    // Feature flag
    isEnabled: isPaymasterEnabled() && paymasters.length > 0,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility: Format ETH gas cost for comparison
// ═══════════════════════════════════════════════════════════════════════════

export function formatEthGasCost(
  gasEstimate: bigint,
  gasPrice: bigint | undefined,
): string {
  if (!gasPrice) return '...'

  const cost = gasEstimate * gasPrice
  const formatted = formatEther(cost)
  const num = parseFloat(formatted)

  if (num === 0) return '0 ETH'
  if (num < 0.0001) return '<0.0001 ETH'
  if (num < 0.01) return `~${num.toFixed(4)} ETH`
  return `~${num.toFixed(4)} ETH`
}
