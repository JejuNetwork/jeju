/**
 * usePaymaster Hook
 *
 * React hook for ERC-4337 paymaster integration.
 * Enables gasless transactions by paying gas fees with tokens.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { type Address, formatEther, formatUnits } from 'viem'
import { useGasPrice } from 'wagmi'
import { useNetworkContext } from '../context'
import { requireClient } from './utils'

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Paymaster information */
interface RawPaymasterInfo {
  /** Paymaster contract address */
  address: Address
  /** Token used for gas payment */
  token: Address
  /** Token symbol */
  tokenSymbol: string
  /** Token decimals */
  tokenDecimals?: number
  /** Exchange rate to ETH (scaled by 1e18) */
  exchangeRate: bigint
  /** Whether this paymaster is currently active */
  isActive?: boolean
  /** Whether this paymaster is currently active (SDK naming) */
  active?: boolean
  entryPointBalance: bigint
  vaultLiquidity: bigint
}

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

type PaymasterModuleLike =
  | {
      listPaymasters: () => Promise<RawPaymasterInfo[]>
      getTokenBalances?: (tokens: Address[]) => Promise<Map<Address, bigint>>
      getTokenBalance?: (token: Address) => Promise<bigint>
    }
  | {
      getAvailable: () => Promise<RawPaymasterInfo[]>
      getTokenBalances?: (tokens: Address[]) => Promise<Map<Address, bigint>>
      getTokenBalance?: (token: Address) => Promise<bigint>
    }
  | null

type PaymasterTokenBalances = Record<string, bigint>

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
  const [tokenBalances, setTokenBalances] = useState<PaymasterTokenBalances>({})

  // Check if paymaster feature is available via SDK
  const isEnabled = useMemo(() => {
    if (!client) return false
    // Check if SDK has legacy paymaster module or current payments module
    return 'payments' in client || 'paymaster' in client
  }, [client])

  const normalizePaymaster = useCallback(
    (paymaster: RawPaymasterInfo): PaymasterInfo => ({
      ...paymaster,
      tokenDecimals: paymaster.tokenDecimals ?? 18,
      isActive: paymaster.isActive ?? paymaster.active ?? false,
    }),
    [],
  )

  const resolvePaymasterModule = useCallback((): PaymasterModuleLike => {
    const c = requireClient(client)
    const isValidModule = (module: unknown): module is PaymasterModuleLike =>
      typeof module === 'object' &&
      module !== null &&
      (('listPaymasters' in module &&
        typeof (module as { listPaymasters?: () => unknown }).listPaymasters ===
          'function') ||
        ('getAvailable' in module &&
          typeof (module as { getAvailable?: () => unknown }).getAvailable ===
            'function'))

    if (
      'payments' in c &&
      c.payments &&
      typeof c.payments === 'object' &&
      isValidModule(c.payments)
    ) {
      return c.payments as PaymasterModuleLike
    }

    if ('paymaster' in c && c.paymaster && isValidModule(c.paymaster)) {
      return c.paymaster as PaymasterModuleLike
    }

    return null
  }, [client])

  // Load available paymasters from SDK
  useEffect(() => {
    async function loadPaymasters() {
      if (!client || !isEnabled) {
        setPaymasters([])
        setTokenBalances({})
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const paymasterModule = resolvePaymasterModule()

        if (!paymasterModule) {
          setPaymasters([])
          return
        }

        let paymastersRaw: RawPaymasterInfo[]
        if (
          'listPaymasters' in paymasterModule &&
          typeof paymasterModule.listPaymasters === 'function'
        ) {
          paymastersRaw = await paymasterModule.listPaymasters()
        } else if (
          'getAvailable' in paymasterModule &&
          typeof paymasterModule.getAvailable === 'function'
        ) {
          paymastersRaw = await paymasterModule.getAvailable()
        } else {
          throw new Error('Paymaster module does not support listing methods')
        }
        const normalized = paymastersRaw.map(normalizePaymaster)
        setPaymasters(normalized)

        const tokenAddrs = normalized.map((p) => p.token)
        if (tokenAddrs.length > 0) {
          try {
            if (
              'getTokenBalances' in paymasterModule &&
              typeof paymasterModule.getTokenBalances === 'function'
            ) {
              const balances = await paymasterModule.getTokenBalances(tokenAddrs)
              const next = Array.from(balances.entries()).reduce<
                PaymasterTokenBalances
              >((acc, [token, balance]) => {
                acc[token.toLowerCase()] = balance
                return acc
              }, {})
              setTokenBalances(next)
            } else if (
              'getTokenBalance' in paymasterModule &&
              typeof paymasterModule.getTokenBalance === 'function'
            ) {
              const balances = await Promise.all(
                tokenAddrs.map((token) =>
                  paymasterModule.getTokenBalance
                    ? paymasterModule.getTokenBalance(token)
                    : 0n,
                ),
              )
              const next = tokenAddrs.reduce<PaymasterTokenBalances>(
                (acc, token, index) => {
                  acc[token.toLowerCase()] = balances[index] ?? 0n
                  return acc
                },
                {},
              )
              setTokenBalances(next)
            }
          } catch {
            // Keep paymasters available even if balance query fails; feature remains usable.
            setTokenBalances({})
          }
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load paymasters',
        )
        setPaymasters([])
        setTokenBalances({})
      } finally {
        setIsLoading(false)
      }
    }

    loadPaymasters().catch((err) => {
      setError(
        err instanceof Error ? err.message : 'Failed to load paymasters',
      )
      setPaymasters([])
      setTokenBalances({})
      setIsLoading(false)
    })
  }, [client, isEnabled, resolvePaymasterModule, normalizePaymaster])

  // Calculate cost estimates
  const options = useMemo<PaymasterCostEstimate[]>(() => {
    if (!gasPrice || paymasters.length === 0) return []

    const estimatedGas = 200_000n // Typical swap gas
    const baseCost = estimatedGas * gasPrice

    return paymasters.map((pm) => {
      // Convert ETH cost to token cost using exchange rate
      const tokenCost =
        pm.exchangeRate > 0n
          ? (baseCost * BigInt(1e18)) / pm.exchangeRate
          : baseCost

      return {
        paymaster: pm,
        cost: tokenCost,
        costFormatted: `~${Number(formatUnits(tokenCost, pm.tokenDecimals)).toFixed(
          4,
        )} ${pm.tokenSymbol}`,
        hasSufficientBalance:
          tokenBalances[pm.token.toLowerCase()] === undefined
            ? false
            : tokenBalances[pm.token.toLowerCase()] >= tokenCost,
        isRecommended: pm.tokenSymbol === 'USDC' || pm.tokenSymbol === 'DAI',
      }
    })
  }, [gasPrice, paymasters, tokenBalances])

  const bestOption = useMemo(() => {
    if (options.length === 0) return null
    return (
      options.find((o) => o.isRecommended && o.hasSufficientBalance) ??
      options[0]
    )
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
      (o) =>
        o.paymaster.address.toLowerCase() ===
        selectedPaymaster.address.toLowerCase(),
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

export function formatEthGasCost(
  gasEstimate: bigint,
  gasPrice: bigint | undefined,
): string {
  if (!gasPrice) return '...'
  const cost = gasEstimate * gasPrice
  const num = parseFloat(formatEther(cost))
  if (num === 0) return '0 ETH'
  if (num < 0.0001) return '<0.0001 ETH'
  return `~${num.toFixed(4)} ETH`
}
