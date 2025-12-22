/**
 * Bazaar API Hooks
 *
 * React Query hooks for the Bazaar API.
 * Provides type-safe, cached API calls with loading/error states.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address } from 'viem'
import { ApiError, api, queryKeys } from '../lib/client'

// ============================================================================
// Health
// ============================================================================

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health(),
    queryFn: () => api.health.get(),
    staleTime: 30_000,
  })
}

export function useFaucetInfo() {
  return useQuery({
    queryKey: queryKeys.faucet.info(),
    queryFn: () => api.faucet.getInfo(),
    staleTime: 60_000,
  })
}

export function useFaucetStatus(address: Address | undefined) {
  return useQuery({
    queryKey: queryKeys.faucet.status(address || ''),
    queryFn: () => {
      if (!address) throw new Error('Address required')
      return api.faucet.getStatus(address)
    },
    enabled: !!address,
    staleTime: 10_000,
  })
}

export function useFaucetClaim() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (address: Address) => api.faucet.claim(address),
    onSuccess: (_data, address) => {
      // Invalidate faucet status after claim
      queryClient.invalidateQueries({
        queryKey: queryKeys.faucet.status(address),
      })
    },
  })
}

// ============================================================================
// TFMM Hooks
// ============================================================================

export function useTFMMPools() {
  return useQuery({
    queryKey: queryKeys.tfmm.pools(),
    queryFn: () => api.tfmm.getPools(),
    staleTime: 30_000,
  })
}

export function useTFMMPool(poolAddress: Address | undefined) {
  return useQuery({
    queryKey: queryKeys.tfmm.pool(poolAddress || ''),
    queryFn: () => {
      if (!poolAddress) throw new Error('Pool address required')
      return api.tfmm.getPool(poolAddress)
    },
    enabled: !!poolAddress,
    staleTime: 30_000,
  })
}

export function useTFMMStrategies() {
  return useQuery({
    queryKey: queryKeys.tfmm.strategies(),
    queryFn: () => api.tfmm.getStrategies(),
    staleTime: 300_000, // Strategies don't change often
  })
}

export function useTFMMOracles() {
  return useQuery({
    queryKey: queryKeys.tfmm.oracles(),
    queryFn: () => api.tfmm.getOracles(),
    staleTime: 60_000,
  })
}

export function useTFMMCreatePool() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      tokens: Address[]
      initialWeights: number[]
      strategy: string
    }) => api.tfmm.createPool(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tfmm.pools() })
    },
  })
}

export function useTFMMUpdateStrategy() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { poolAddress: Address; newStrategy: string }) =>
      api.tfmm.updateStrategy(params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tfmm.pool(variables.poolAddress),
      })
    },
  })
}

export function useTFMMTriggerRebalance() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { poolAddress: Address }) =>
      api.tfmm.triggerRebalance(params),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tfmm.pool(variables.poolAddress),
      })
    },
  })
}

export function useA2AInfo() {
  return useQuery({
    queryKey: queryKeys.a2a.info(),
    queryFn: () => api.a2a.getInfo(),
    staleTime: 300_000,
  })
}

export function useA2AAgentCard() {
  return useQuery({
    queryKey: queryKeys.a2a.card(),
    queryFn: () => api.a2a.getAgentCard(),
    staleTime: 300_000,
  })
}

// ============================================================================
// MCP Hooks
// ============================================================================

export function useMCPInfo() {
  return useQuery({
    queryKey: queryKeys.mcp.info(),
    queryFn: () => api.mcp.getInfo(),
    staleTime: 300_000,
  })
}

export { ApiError }
