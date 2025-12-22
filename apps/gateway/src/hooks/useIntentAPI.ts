import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { OIF_AGGREGATOR_URL } from '../config'

const API_BASE = OIF_AGGREGATOR_URL

// Zod schemas for API response validation
const IntentSchema = z.object({
  intentId: z.string(),
  user: z.string(),
  nonce: z.string(),
  sourceChainId: z.number(),
  openDeadline: z.number(),
  fillDeadline: z.number(),
  inputs: z.array(
    z.object({
      token: z.string(),
      amount: z.string(),
      chainId: z.number(),
    }),
  ),
  outputs: z.array(
    z.object({
      token: z.string(),
      amount: z.string(),
      recipient: z.string(),
      chainId: z.number(),
    }),
  ),
  signature: z.string(),
  status: z.string(),
  createdAt: z.number(),
  filledAt: z.number().nullable(),
  solver: z.string().nullable(),
})

const IntentQuoteSchema = z.object({
  quoteId: z.string(),
  sourceChainId: z.number(),
  destinationChainId: z.number(),
  sourceToken: z.string(),
  destinationToken: z.string(),
  inputAmount: z.string(),
  outputAmount: z.string(),
  fee: z.string(),
  feePercent: z.number(),
  priceImpact: z.number(),
  estimatedFillTimeSeconds: z.number(),
  validUntil: z.number(),
  solver: z.string(),
  solverReputation: z.number(),
})

const IntentRouteSchema = z.object({
  routeId: z.string(),
  sourceChainId: z.number(),
  destinationChainId: z.number(),
  isActive: z.boolean(),
  totalVolume: z.string(),
  totalIntents: z.number(),
  avgFillTimeSeconds: z.number().nullable(),
  successRate: z.number().nullable(),
  oracle: z.string().nullable(),
  activeSolvers: z.number().nullable(),
  avgFeePercent: z.number().nullable(),
})

const SolverSchema = z.object({
  address: z.string(),
  name: z.string().nullable(),
  stakedAmount: z.string(),
  totalFills: z.number(),
  successfulFills: z.number(),
  supportedChains: z.array(z.number()),
  isActive: z.boolean(),
  reputation: z.number(),
  avgFillTimeMs: z.number().nullable(),
  successRate: z.number().nullable(),
  totalVolumeUsd: z.string().nullable(),
})

const SolverLeaderboardEntrySchema = z.object({
  address: z.string(),
  solver: z.string().nullable(),
  rank: z.number().nullable(),
  name: z.string().nullable(),
  totalVolume: z.string(),
  totalFills: z.number(),
  successRate: z.number(),
  reputation: z.number(),
  avgFillTimeMs: z.number().nullable(),
  totalFeesEarned: z.string().nullable(),
})

const ChainStatsSchema = z.object({
  chainId: z.number(),
  totalIntents: z.number(),
  totalVolume: z.string(),
  activeRoutes: z.number(),
  activeSolvers: z.number(),
})

const SupportedTokenSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  decimals: z.number(),
})

const OIFStatsSchema = z.object({
  totalIntents: z.number(),
  totalVolume: z.string(),
  totalVolumeUsd: z.string().nullable(),
  totalSolvers: z.number(),
  activeSolvers: z.number().nullable(),
  totalRoutes: z.number(),
  activeRoutes: z.number().nullable(),
  last24hIntents: z.number(),
  last24hVolume: z.string(),
  successRate: z.number().nullable(),
  totalFeesUsd: z.string().nullable(),
  avgFillTimeSeconds: z.number().nullable(),
  totalSolverStake: z.string().nullable(),
})

// Infer types from schemas
export type Intent = z.infer<typeof IntentSchema>
export type IntentQuote = z.infer<typeof IntentQuoteSchema>
export type IntentRoute = z.infer<typeof IntentRouteSchema>
export type Solver = z.infer<typeof SolverSchema>
export type SolverLeaderboardEntry = z.infer<
  typeof SolverLeaderboardEntrySchema
>
export type ChainStats = z.infer<typeof ChainStatsSchema>
export type OIFStats = z.infer<typeof OIFStatsSchema>

async function fetchJSON<T>(path: string, schema?: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok)
    throw new Error(`Failed to fetch ${path}: ${res.status} ${res.statusText}`)
  const data = await res.json()
  if (!schema) return data as T
  const result = schema.safeParse(data)
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join(', ')
    throw new Error(`Invalid API response from ${path}: ${errors}`)
  }
  return result.data
}

export function useIntents(filters?: {
  status?: string
  sourceChain?: number
  destinationChain?: number
  limit?: number
}) {
  return useQuery({
    queryKey: ['intents', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters?.status) params.set('status', filters.status)
      if (filters?.sourceChain)
        params.set('sourceChain', filters.sourceChain.toString())
      if (filters?.destinationChain)
        params.set('destinationChain', filters.destinationChain.toString())
      if (filters?.limit) params.set('limit', filters.limit.toString())
      return fetchJSON(`/intents?${params}`, z.array(IntentSchema)) as Promise<
        Intent[]
      >
    },
  })
}

export function useIntent(intentId: string) {
  const IntentResponseSchema = z.object({
    intent: IntentSchema,
    status: z.string(),
  })
  return useQuery({
    queryKey: ['intent', intentId],
    queryFn: () =>
      fetchJSON(`/intents/${intentId}`, IntentResponseSchema) as Promise<{
        intent: Intent
        status: string
      }>,
    enabled: !!intentId,
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
    queryKey: ['quote', params],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/intents/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok)
        throw new Error(
          `Failed to fetch quote: ${res.status} ${res.statusText}`,
        )
      const data = await res.json()
      const result = z.array(IntentQuoteSchema).safeParse(data)
      if (!result.success) {
        const errors = result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join(', ')
        throw new Error(`Invalid quote response: ${errors}`)
      }
      return result.data as IntentQuote[]
    },
    enabled:
      !!params.sourceChain && !!params.destinationChain && !!params.amount,
  })
}

export function useRoutes(filters?: {
  sourceChain?: number
  destinationChain?: number
  active?: boolean
}) {
  return useQuery({
    queryKey: ['routes', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters?.sourceChain)
        params.set('sourceChain', filters.sourceChain.toString())
      if (filters?.destinationChain)
        params.set('destinationChain', filters.destinationChain.toString())
      if (filters?.active !== undefined)
        params.set('active', filters.active.toString())
      return fetchJSON(
        `/routes?${params}`,
        z.array(IntentRouteSchema),
      ) as Promise<IntentRoute[]>
    },
  })
}

export function useRoute(routeId: string) {
  return useQuery({
    queryKey: ['route', routeId],
    queryFn: () =>
      fetchJSON(
        `/routes/${routeId}`,
        IntentRouteSchema,
      ) as Promise<IntentRoute>,
    enabled: !!routeId,
  })
}

export function useSolvers(filters?: {
  chainId?: number
  minReputation?: number
  active?: boolean
}) {
  return useQuery({
    queryKey: ['solvers', filters],
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters?.chainId) params.set('chainId', filters.chainId.toString())
      if (filters?.minReputation)
        params.set('minReputation', filters.minReputation.toString())
      if (filters?.active !== undefined)
        params.set('active', filters.active.toString())
      return fetchJSON(`/solvers?${params}`, z.array(SolverSchema))
    },
  })
}

export function useSolver(address: string) {
  return useQuery({
    queryKey: ['solver', address],
    queryFn: () => fetchJSON(`/solvers/${address}`, SolverSchema),
    enabled: !!address,
  })
}

export function useSolverLeaderboard(
  sortBy: 'volume' | 'fills' | 'reputation' = 'volume',
) {
  return useQuery({
    queryKey: ['solver-leaderboard', sortBy],
    queryFn: () =>
      fetchJSON(
        `/solvers/leaderboard?sortBy=${sortBy}`,
        z.array(SolverLeaderboardEntrySchema),
      ),
  })
}

export function useOIFStats() {
  return useQuery({
    queryKey: ['oif-stats'],
    queryFn: () => fetchJSON('/stats', OIFStatsSchema),
    refetchInterval: 30000,
  })
}

export function useChainStats(chainId: number) {
  return useQuery({
    queryKey: ['chain-stats', chainId],
    queryFn: () => fetchJSON(`/stats/chain/${chainId}`, ChainStatsSchema),
    enabled: !!chainId,
  })
}

export function useSupportedChains() {
  return useQuery({
    queryKey: ['supported-chains'],
    queryFn: () =>
      fetchJSON<Array<{ chainId: number; name: string; isL2: boolean }>>(
        '/config/chains',
      ),
    staleTime: Infinity,
  })
}

export function useSupportedTokens(chainId?: number) {
  return useQuery({
    queryKey: ['supported-tokens', chainId],
    queryFn: () =>
      fetchJSON(
        `/config/tokens${chainId ? `?chainId=${chainId}` : ''}`,
        z.array(SupportedTokenSchema),
      ),
    staleTime: Infinity,
  })
}
