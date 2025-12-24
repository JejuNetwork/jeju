/**
 * Intent API Hook
 * For managing cross-chain intents via OIF
 */

import { expectValid } from '@jejunetwork/types'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { Address } from 'viem'
import { useAccount } from 'wagmi'
import {
  AllIntentsResponseSchema,
  CreateIntentResponseSchema,
  IntentQuotesResponseSchema,
  IntentsResponseSchema,
  LeaderboardResponseSchema,
  OIFStatsSchema,
  RoutesResponseSchema,
  SolversResponseSchema,
} from '../../lib/validation'
import { OIF_AGGREGATOR_URL } from '../config'
import { OIF_SUPPORTED_CHAINS } from '../config/chains'

export interface Intent {
  id: string
  user: Address
  inputToken: Address
  inputAmount: string
  outputToken: Address
  outputAmount: string
  sourceChainId: number
  destinationChainId: number
  status: 'pending' | 'open' | 'filled' | 'expired' | 'cancelled'
  solver?: Address
  createdAt: number
  filledAt?: number
  txHash?: string
  fillTxHash?: string
}

export interface CreateIntentParams {
  sourceChain: number
  destinationChain: number
  sourceToken: Address
  destinationToken: Address
  amount: bigint
  minReceived: bigint
  recipient?: Address
  deadline: number
}

export interface IntentQuote {
  inputAmount: string
  outputAmount: string
  fee: string
  feePercent?: number
  estimatedFillTimeSeconds?: number
  route?: {
    id: string
    name: string
    steps: {
      protocol: string
      action: string
      inputToken: string
      outputToken: string
      inputAmount: string
      outputAmount: string
      chainId: number
    }[]
    estimatedTime: number
    estimatedGas: string
    fee: string
  }
  solver?: {
    solver: string
    name: string
    reputation: number
    successRate: number
  }
  priceImpact?: number
}

export interface OIFStats {
  totalIntents: number
  last24hIntents: number
  activeSolvers: number
  totalSolvers: number
  successRate: number
  totalVolume: string
  totalVolumeUsd: string
  last24hVolume: string
  totalFeesUsd: string
  avgFillTimeSeconds: number
  activeRoutes: number
  totalSolverStake: string
}

export function useSupportedChains() {
  return useQuery({
    queryKey: ['oif-chains'],
    queryFn: async () => {
      // Could fetch from API, but using static data for now
      return OIF_SUPPORTED_CHAINS
    },
    staleTime: 1000 * 60 * 60, // 1 hour
  })
}

export function useIntentQuote(params: {
  sourceChain: number
  destinationChain: number
  sourceToken: string
  destinationToken: string
  amount: string
}) {
  return useQuery({
    queryKey: ['intent-quote', params],
    queryFn: async (): Promise<IntentQuote[]> => {
      const searchParams = new URLSearchParams({
        sourceChain: params.sourceChain.toString(),
        destinationChain: params.destinationChain.toString(),
        sourceToken: params.sourceToken,
        destinationToken: params.destinationToken,
        amount: params.amount,
      })

      const response = await fetch(
        `${OIF_AGGREGATOR_URL}/quote?${searchParams}`,
      )
      if (!response.ok) {
        throw new Error(
          `Failed to fetch quotes: ${response.status} ${response.statusText}`,
        )
      }
      const json: unknown = await response.json()
      const validated = expectValid(
        IntentQuotesResponseSchema,
        json,
        'intent quotes response',
      )
      if (!validated.quotes) {
        throw new Error('Invalid response: quotes not found')
      }
      return validated.quotes
    },
    enabled: parseFloat(params.amount) > 0,
    staleTime: 1000 * 10, // 10 seconds
  })
}

export function useOIFStats() {
  return useQuery({
    queryKey: ['oif-stats'],
    queryFn: async (): Promise<OIFStats> => {
      const response = await fetch(`${OIF_AGGREGATOR_URL}/stats`)
      if (!response.ok) {
        throw new Error(
          `Failed to fetch OIF stats: ${response.status} ${response.statusText}`,
        )
      }
      const json: unknown = await response.json()
      return expectValid(OIFStatsSchema, json, 'OIF stats response')
    },
    staleTime: 1000 * 30, // 30 seconds
  })
}

export function useIntentAPI() {
  const { address } = useAccount()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createIntent = useCallback(
    async (params: CreateIntentParams): Promise<Intent | null> => {
      if (!address) {
        setError('Wallet not connected')
        return null
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`${OIF_AGGREGATOR_URL}/intents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...params,
            creator: address,
            recipient: params.recipient || address,
            amount: params.amount.toString(),
            minReceived: params.minReceived.toString(),
          }),
        })

        if (!response.ok) {
          throw new Error('Failed to create intent')
        }

        const json: unknown = await response.json()
        const validated = expectValid(
          CreateIntentResponseSchema,
          json,
          'create intent response',
        )
        // Return the intent if available, otherwise construct from response
        if (validated.intent) {
          return validated.intent
        }
        return null
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [address],
  )

  const getIntents = useCallback(async (): Promise<Intent[]> => {
    if (!address) {
      throw new Error('Wallet not connected')
    }

    const response = await fetch(
      `${OIF_AGGREGATOR_URL}/intents?creator=${address}`,
    )
    if (!response.ok) {
      throw new Error(
        `Failed to fetch intents: ${response.status} ${response.statusText}`,
      )
    }
    const json: unknown = await response.json()
    const validated = expectValid(
      IntentsResponseSchema,
      json,
      'intents response',
    )
    if (!validated.intents) {
      throw new Error('Invalid response: intents not found')
    }
    return validated.intents
  }, [address])

  const cancelIntent = useCallback(
    async (intentId: string): Promise<boolean> => {
      if (!address) {
        setError('Wallet not connected')
        return false
      }

      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(
          `${OIF_AGGREGATOR_URL}/intents/${intentId}/cancel`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creator: address }),
          },
        )

        return response.ok
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [address],
  )

  return {
    createIntent,
    getIntents,
    cancelIntent,
    isLoading,
    error,
  }
}

export function useIntents() {
  const { getIntents } = useIntentAPI()
  const [intents, setIntents] = useState<Intent[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    const data = await getIntents()
    setIntents(data)
    setIsLoading(false)
  }, [getIntents])

  return {
    intents,
    isLoading,
    refresh,
  }
}

interface AllIntentsParams {
  status?: string
  limit?: number
}

// AllIntentsIntent has additional fields for display
interface AllIntentsIntent {
  id: string
  intentId?: string
  user: Address
  inputToken: Address
  inputAmount: string
  outputToken: Address
  outputAmount: string
  sourceChainId: number
  destinationChainId: number
  status: 'pending' | 'open' | 'filled' | 'expired' | 'cancelled'
  solver?: Address
  createdAt: number
  filledAt?: number
  txHash?: string
  fillTxHash?: string
  inputs?: Array<{ amount: string; chainId: number }>
  outputs?: Array<{ amount: string; chainId: number }>
}

export function useAllIntents(params: AllIntentsParams = {}) {
  return useQuery({
    queryKey: ['all-intents', params],
    queryFn: async (): Promise<AllIntentsIntent[]> => {
      const searchParams = new URLSearchParams()
      if (params.status) searchParams.set('status', params.status)
      if (params.limit) searchParams.set('limit', params.limit.toString())

      const response = await fetch(
        `${OIF_AGGREGATOR_URL}/intents?${searchParams}`,
      )
      if (!response.ok) {
        throw new Error(
          `Failed to fetch intents: ${response.status} ${response.statusText}`,
        )
      }
      const json: unknown = await response.json()
      const validated = expectValid(
        AllIntentsResponseSchema,
        json,
        'all intents response',
      )
      if (!validated.intents) {
        throw new Error('Invalid response: intents not found')
      }
      return validated.intents
    },
    staleTime: 1000 * 10, // 10 seconds
  })
}

// Routes hook
export interface Route {
  id: string
  name: string
  steps: {
    protocol: string
    action: string
    inputToken: string
    outputToken: string
    inputAmount: string
    outputAmount: string
    chainId: number
  }[]
  estimatedTime: number
  estimatedGas: string
  fee: string
}

export function useRoutes() {
  return useQuery({
    queryKey: ['oif-routes'],
    queryFn: async (): Promise<Route[]> => {
      const response = await fetch(`${OIF_AGGREGATOR_URL}/routes`)
      if (!response.ok) {
        throw new Error(
          `Failed to fetch routes: ${response.status} ${response.statusText}`,
        )
      }
      const json: unknown = await response.json()
      const validated = expectValid(
        RoutesResponseSchema,
        json,
        'routes response',
      )
      if (!validated.routes) {
        throw new Error('Invalid response: routes not found')
      }
      return validated.routes
    },
    staleTime: 1000 * 30,
  })
}

// Solvers hook
export interface Solver {
  solver: string
  name: string
  reputation: number
  successRate: number
  filledIntents?: number
  totalVolume?: string
  avgFillTime?: number
  stake?: string
}

export function useSolvers() {
  return useQuery({
    queryKey: ['oif-solvers'],
    queryFn: async (): Promise<Solver[]> => {
      const response = await fetch(`${OIF_AGGREGATOR_URL}/solvers`)
      if (!response.ok) {
        throw new Error(
          `Failed to fetch solvers: ${response.status} ${response.statusText}`,
        )
      }
      const json: unknown = await response.json()
      const validated = expectValid(
        SolversResponseSchema,
        json,
        'solvers response',
      )
      if (!validated.solvers) {
        throw new Error('Invalid response: solvers not found')
      }
      return validated.solvers
    },
    staleTime: 1000 * 30,
  })
}

export interface LeaderboardEntry {
  address: string
  name?: string
  score: number
  rank: number
  totalIntents: number
  successfulIntents: number
  filledIntents?: number
  successRate?: number
  totalVolume: string
}

export function useSolverLeaderboard() {
  return useQuery({
    queryKey: ['solver-leaderboard'],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const response = await fetch(`${OIF_AGGREGATOR_URL}/leaderboard`)
      if (!response.ok) {
        throw new Error(
          `Failed to fetch leaderboard: ${response.status} ${response.statusText}`,
        )
      }
      const json: unknown = await response.json()
      const validated = expectValid(
        LeaderboardResponseSchema,
        json,
        'leaderboard response',
      )
      // Support both 'leaderboard' and 'entries' field names
      const entries = validated.leaderboard ?? validated.entries
      if (!entries) {
        throw new Error('Invalid response: leaderboard entries not found')
      }
      return entries
    },
    staleTime: 1000 * 60,
  })
}
