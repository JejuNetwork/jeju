/**
 * Real-time balance updates hook
 *
 * Provides automatic balance refresh with configurable polling interval
 * and immediate update after transactions.
 */

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { type Address, formatEther, formatUnits } from 'viem'
import { useAccount, useBalance, useReadContracts } from 'wagmi'
import { IERC20_ABI } from '../lib/constants'

interface TokenBalance {
  address: Address
  symbol: string
  decimals: number
  balance: bigint
  formatted: string
}

interface RealtimeBalanceConfig {
  /** Polling interval in milliseconds (default: 15000) */
  pollingInterval?: number
  /** Whether to refetch on window focus (default: true) */
  refetchOnFocus?: boolean
  /** List of token addresses to track */
  tokens?: Array<{
    address: Address
    symbol: string
    decimals: number
  }>
}

/**
 * Hook for real-time ETH balance updates
 */
export function useRealtimeETHBalance(config?: RealtimeBalanceConfig) {
  const { address } = useAccount()
  const queryClient = useQueryClient()
  const lastBalanceRef = useRef<bigint | undefined>(undefined)

  const {
    data: balance,
    isLoading,
    error,
    refetch,
  } = useBalance({
    address,
    query: {
      refetchInterval: config?.pollingInterval ?? 15000,
      refetchOnWindowFocus: config?.refetchOnFocus ?? true,
      enabled: Boolean(address),
    },
  })

  // Track balance changes
  useEffect(() => {
    if (
      balance?.value !== undefined &&
      lastBalanceRef.current !== undefined &&
      balance.value !== lastBalanceRef.current
    ) {
      // Balance changed - could trigger a notification here
      console.debug(
        `ETH balance changed: ${formatEther(lastBalanceRef.current)} -> ${formatEther(balance.value)}`,
      )
    }
    lastBalanceRef.current = balance?.value
  }, [balance?.value])

  // Function to trigger immediate refresh (call after transactions)
  const forceRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['balance', { address }] })
    refetch()
  }

  return {
    balance: balance?.value ?? 0n,
    formatted: balance?.formatted ?? '0',
    symbol: balance?.symbol ?? 'ETH',
    isLoading,
    error: error as Error | null,
    refetch: forceRefresh,
  }
}

/**
 * Hook for real-time ERC20 token balance updates
 */
export function useRealtimeTokenBalance(
  tokenAddress: Address | undefined,
  decimals = 18,
  symbol = 'TOKEN',
  config?: RealtimeBalanceConfig,
) {
  const { address: userAddress } = useAccount()
  const queryClient = useQueryClient()
  const lastBalanceRef = useRef<bigint | undefined>(undefined)

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts:
      tokenAddress && userAddress
        ? [
            {
              address: tokenAddress,
              abi: IERC20_ABI,
              functionName: 'balanceOf',
              args: [userAddress],
            },
          ]
        : [],
    query: {
      refetchInterval: config?.pollingInterval ?? 15000,
      refetchOnWindowFocus: config?.refetchOnFocus ?? true,
      enabled: Boolean(tokenAddress && userAddress),
    },
  })

  const balance = (data?.[0]?.result as bigint) ?? 0n

  // Track balance changes
  useEffect(() => {
    if (
      lastBalanceRef.current !== undefined &&
      balance !== lastBalanceRef.current
    ) {
      console.debug(
        `${symbol} balance changed: ${formatUnits(lastBalanceRef.current, decimals)} -> ${formatUnits(balance, decimals)}`,
      )
    }
    lastBalanceRef.current = balance
  }, [balance, decimals, symbol])

  // Function to trigger immediate refresh
  const forceRefresh = () => {
    queryClient.invalidateQueries({
      queryKey: ['readContracts', { address: tokenAddress }],
    })
    refetch()
  }

  return {
    balance,
    formatted: formatUnits(balance, decimals),
    symbol,
    isLoading,
    error: error as Error | null,
    refetch: forceRefresh,
  }
}

/**
 * Hook for tracking multiple token balances in real-time
 */
export function useRealtimeTokenBalances(
  tokens: Array<{ address: Address; symbol: string; decimals: number }>,
  config?: RealtimeBalanceConfig,
) {
  const { address: userAddress } = useAccount()
  const queryClient = useQueryClient()

  const contracts = tokens.map((token) => ({
    address: token.address,
    abi: IERC20_ABI,
    functionName: 'balanceOf' as const,
    args: userAddress ? [userAddress] : undefined,
  }))

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: userAddress ? contracts : [],
    query: {
      refetchInterval: config?.pollingInterval ?? 15000,
      refetchOnWindowFocus: config?.refetchOnFocus ?? true,
      enabled: Boolean(userAddress) && tokens.length > 0,
    },
  })

  const balances: TokenBalance[] = tokens.map((token, i) => ({
    address: token.address,
    symbol: token.symbol,
    decimals: token.decimals,
    balance: (data?.[i]?.result as bigint) ?? 0n,
    formatted: formatUnits((data?.[i]?.result as bigint) ?? 0n, token.decimals),
  }))

  // Force refresh all balances
  const forceRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['readContracts'] })
    await refetch()
  }

  return {
    balances,
    isLoading,
    error: error as Error | null,
    refetch: forceRefresh,
    getBalance: (tokenAddress: Address) =>
      balances.find(
        (b) => b.address.toLowerCase() === tokenAddress.toLowerCase(),
      ),
  }
}

/**
 * Combined hook for ETH and token balances with real-time updates
 */
export function useRealtimeBalances(config?: RealtimeBalanceConfig) {
  const eth = useRealtimeETHBalance(config)
  const tokens = useRealtimeTokenBalances(config?.tokens ?? [], config)

  // Refresh all balances
  const refreshAll = async () => {
    await Promise.all([eth.refetch(), tokens.refetch()])
  }

  return {
    eth,
    tokens: tokens.balances,
    isLoading: eth.isLoading || tokens.isLoading,
    refetchAll: refreshAll,
  }
}

/**
 * Hook that listens for transaction confirmations and auto-refreshes balances
 */
export function useBalanceRefreshOnTransaction() {
  const queryClient = useQueryClient()

  const refreshBalances = async () => {
    // Invalidate all balance-related queries
    await queryClient.invalidateQueries({ queryKey: ['balance'] })
    await queryClient.invalidateQueries({ queryKey: ['readContracts'] })
  }

  return { refreshBalances }
}
