/**
 * API client utilities for browser
 */

import type { Address } from 'viem'
import type { z } from 'zod'

function requireEnv(key: string): string {
  if (typeof import.meta?.env === 'object') {
    const value = import.meta.env[key] as string | undefined
    if (value) return value
  }
  throw new Error(`Required environment variable ${key} is not set`)
}

export const API_BASE = requireEnv('PUBLIC_API_URL')

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function get<T>(path: string, schema?: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  if (!response.ok) {
    throw new ApiError(
      `API request failed: ${response.statusText}`,
      response.status,
    )
  }
  const data: T = await response.json()
  if (schema) {
    return schema.parse(data)
  }
  return data
}

import type { JsonRecord } from '@jejunetwork/types'

async function post<T>(
  path: string,
  body: JsonRecord,
  schema?: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new ApiError(
      `API request failed: ${response.statusText}`,
      response.status,
    )
  }
  const data: T = await response.json()
  if (schema) {
    return schema.parse(data)
  }
  return data
}

// Response Types

export interface HealthResponse {
  status: string
  service: string
  teeMode?: string
  network?: string
}

export interface TFMMPool {
  address: Address
  tokens: Address[]
  weights: number[]
  strategy: string
  tvl: string
  apy: number
}

export interface TFMMPoolsResponse {
  pools: TFMMPool[]
  totalTvl: string
  totalPools: number
}

export interface A2AInfo {
  service: string
  version: string
  description: string
  agentCard: string
}

export interface AgentCard {
  name: string
  skills: Array<{
    id: string
    name: string
    description: string
    tags?: string[]
  }>
}

export interface MCPInfo {
  service: string
  version: string
  resources: string[]
  tools: string[]
}

// Typed API Client

export interface BazaarClient {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body: JsonRecord): Promise<T>

  health: {
    get(): Promise<HealthResponse>
  }

  tfmm: {
    getPools(): Promise<TFMMPoolsResponse>
    getPool(address: Address): Promise<TFMMPool>
    getStrategies(): Promise<{ strategies: string[] }>
    getOracles(): Promise<{ oracles: Array<{ name: string; status: string }> }>
    createPool(params: {
      tokens: Address[]
      initialWeights: number[]
      strategy: string
    }): Promise<{ poolAddress: Address }>
    updateStrategy(params: {
      poolAddress: Address
      newStrategy: string
    }): Promise<{ success: boolean }>
    triggerRebalance(params: {
      poolAddress: Address
    }): Promise<{ success: boolean }>
  }

  a2a: {
    getInfo(): Promise<A2AInfo>
    getAgentCard(): Promise<AgentCard>
  }

  mcp: {
    getInfo(): Promise<MCPInfo>
  }
}

export const api: BazaarClient = {
  get,
  post,

  health: {
    get: () => get<HealthResponse>('/health'),
  },

  tfmm: {
    getPools: () => get<TFMMPoolsResponse>('/tfmm'),
    getPool: (address: Address) => get<TFMMPool>(`/tfmm?pool=${address}`),
    getStrategies: () =>
      get<{ strategies: string[] }>('/tfmm?action=strategies'),
    getOracles: () =>
      get<{ oracles: Array<{ name: string; status: string }> }>(
        '/tfmm?action=oracles',
      ),
    createPool: (params) =>
      post<{ poolAddress: Address }>('/tfmm', {
        action: 'create_pool',
        params,
      }),
    updateStrategy: (params) =>
      post<{ success: boolean }>('/tfmm', {
        action: 'update_strategy',
        params,
      }),
    triggerRebalance: (params) =>
      post<{ success: boolean }>('/tfmm', {
        action: 'trigger_rebalance',
        params,
      }),
  },

  a2a: {
    getInfo: () => get<A2AInfo>('/a2a'),
    getAgentCard: () => get<AgentCard>('/a2a?card=true'),
  },

  mcp: {
    getInfo: () => get<MCPInfo>('/mcp'),
  },
}

// Query Keys for React Query

export const queryKeys = {
  health: () => ['health'] as const,

  tfmm: {
    pools: () => ['tfmm', 'pools'] as const,
    pool: (address: string) => ['tfmm', 'pool', address] as const,
    strategies: () => ['tfmm', 'strategies'] as const,
    oracles: () => ['tfmm', 'oracles'] as const,
  },

  a2a: {
    info: () => ['a2a', 'info'] as const,
    card: () => ['a2a', 'card'] as const,
  },

  mcp: {
    info: () => ['mcp', 'info'] as const,
  },

  pools: ['pools'] as const,
  pool: (id: string) => ['pools', id] as const,
  tokens: ['tokens'] as const,
  nfts: (address: string) => ['nfts', address] as const,
  intents: (address: string) => ['intents', address] as const,
}
