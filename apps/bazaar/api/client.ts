/**
 * Typed API client for Bazaar API
 *
 * Provides type-safe API access using Zod schemas for response validation.
 */

import { getCoreAppUrl } from '@jejunetwork/config'
import type { Address } from 'viem'
import type { z } from 'zod'
import {
  type FaucetClaimResult,
  FaucetClaimResultSchema,
  type FaucetInfo,
  FaucetInfoSchema,
  type FaucetStatus,
  FaucetStatusSchema,
} from './faucet'

// API Base URL

export const API_BASE =
  typeof window !== 'undefined'
    ? ''
    : process.env.BAZAAR_API_URL || getCoreAppUrl('BAZAAR_API')

// Query Keys for React Query

export const queryKeys = {
  faucet: {
    all: ['faucet'] as const,
    info: () => [...queryKeys.faucet.all, 'info'] as const,
    status: (address: string) =>
      [...queryKeys.faucet.all, 'status', address] as const,
  },
  tfmm: {
    all: ['tfmm'] as const,
    pools: () => [...queryKeys.tfmm.all, 'pools'] as const,
    pool: (address: string) =>
      [...queryKeys.tfmm.all, 'pool', address] as const,
    strategies: () => [...queryKeys.tfmm.all, 'strategies'] as const,
    oracles: () => [...queryKeys.tfmm.all, 'oracles'] as const,
  },
  a2a: {
    all: ['a2a'] as const,
    info: () => [...queryKeys.a2a.all, 'info'] as const,
    card: () => [...queryKeys.a2a.all, 'card'] as const,
  },
  mcp: {
    all: ['mcp'] as const,
    info: () => [...queryKeys.mcp.all, 'info'] as const,
  },
  health: () => ['health'] as const,
  oif: {
    all: ['oif'] as const,
    quote: (params: {
      sourceChain: number
      destChain: number
      tokenIn: string
      tokenOut: string
      amount: string
    }) => [...queryKeys.oif.all, 'quote', params] as const,
    intents: (creator?: string) =>
      [...queryKeys.oif.all, 'intents', creator] as const,
    stats: () => [...queryKeys.oif.all, 'stats'] as const,
    routes: () => [...queryKeys.oif.all, 'routes'] as const,
    solvers: () => [...queryKeys.oif.all, 'solvers'] as const,
    leaderboard: () => [...queryKeys.oif.all, 'leaderboard'] as const,
  },
  bridge: {
    all: ['bridge'] as const,
    history: (address: string) =>
      [...queryKeys.bridge.all, 'history', address] as const,
  },
  xlp: {
    all: ['xlp'] as const,
    voucherHistory: (address: string) =>
      [...queryKeys.xlp.all, 'voucher-history', address] as const,
  },
  prices: {
    all: ['prices'] as const,
    token: (chainId: number, address: string) =>
      [...queryKeys.prices.all, 'token', chainId, address] as const,
    eth: (chainId: number) =>
      [...queryKeys.prices.all, 'eth', chainId] as const,
  },
  trending: {
    all: ['trending'] as const,
    tag: (tag: string, offset?: number) =>
      [...queryKeys.trending.all, 'tag', tag, offset] as const,
    group: (tags: string) =>
      [...queryKeys.trending.all, 'group', tags] as const,
  },
  referral: {
    code: (userId: string) => ['referral', 'code', userId] as const,
  },
} as const

// Response Types - import from faucet.ts to avoid duplication
export type { FaucetClaimResult, FaucetInfo, FaucetStatus } from './faucet'

// Import HealthResponse from lib/client.ts to avoid duplication
import type { HealthResponse } from '../lib/client'
export type { HealthResponse }

export interface A2AInfoResponse {
  service: string
  version: string
  description: string
  agentCard: string
}

export interface MCPInfoResponse {
  name: string
  version: string
  capabilities: Record<string, boolean>
}

export interface TFMMPool {
  address: Address
  tokens: Address[]
  weights: number[]
  strategy: string
  tvl: string
  apy: string
}

export interface TFMMPoolsResponse {
  pools: TFMMPool[]
  totalTvl: string
  totalVolume24h: string
}

export interface TFMMStrategiesResponse {
  strategies: string[]
}

export interface TFMMOraclesResponse {
  oracles: Array<{
    address: Address
    name: string
    status: string
  }>
}

export interface TFMMActionResponse {
  success: boolean
  txHash?: string
  poolAddress?: Address
}

// API Error Handling

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: Record<
      string,
      string | number | boolean | null | string[] | number[]
    >,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function handleResponse<T>(
  response: Response,
  schema?: z.ZodType<T>,
): Promise<T> {
  if (!response.ok) {
    const errorBody = await response.json()
    const isErrorObject =
      typeof errorBody === 'object' &&
      errorBody !== null &&
      !Array.isArray(errorBody)
    const message =
      (isErrorObject &&
      'error' in errorBody &&
      typeof errorBody.error === 'string'
        ? errorBody.error
        : null) ||
      (isErrorObject &&
      'message' in errorBody &&
      typeof errorBody.message === 'string'
        ? errorBody.message
        : null) ||
      `Request failed: ${response.status}`
    throw new ApiError(message, response.status)
  }

  const data: T = await response.json()

  if (schema) {
    const result = schema.safeParse(data)
    if (!result.success) {
      throw new ApiError(
        `Invalid response format: ${result.error.message}`,
        500,
      )
    }
    return result.data
  }

  return data
}

// Typed API Client

export const api = {
  health: {
    async get(): Promise<HealthResponse> {
      const response = await fetch(`${API_BASE}/health`)
      return handleResponse(response)
    },
  },

  faucet: {
    async getInfo(): Promise<FaucetInfo> {
      const response = await fetch(`${API_BASE}/api/faucet/info`)
      return handleResponse(response, FaucetInfoSchema)
    },

    async getStatus(address: Address): Promise<FaucetStatus> {
      const response = await fetch(`${API_BASE}/api/faucet/status/${address}`)
      return handleResponse(response, FaucetStatusSchema)
    },

    async claim(address: Address): Promise<FaucetClaimResult> {
      const response = await fetch(`${API_BASE}/api/faucet/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      })
      return handleResponse(response, FaucetClaimResultSchema)
    },
  },

  tfmm: {
    async getPools(): Promise<TFMMPoolsResponse> {
      const response = await fetch(`${API_BASE}/api/tfmm`)
      return handleResponse(response)
    },

    async getPool(poolAddress: Address): Promise<{ pool: TFMMPool }> {
      const response = await fetch(`${API_BASE}/api/tfmm?pool=${poolAddress}`)
      return handleResponse(response)
    },

    async getStrategies(): Promise<TFMMStrategiesResponse> {
      const response = await fetch(`${API_BASE}/api/tfmm?action=strategies`)
      return handleResponse(response)
    },

    async getOracles(): Promise<TFMMOraclesResponse> {
      const response = await fetch(`${API_BASE}/api/tfmm?action=oracles`)
      return handleResponse(response)
    },

    async createPool(params: {
      tokens: Address[]
      initialWeights: number[]
      strategy: string
    }): Promise<TFMMActionResponse> {
      const response = await fetch(`${API_BASE}/api/tfmm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_pool', params }),
      })
      return handleResponse(response)
    },

    async updateStrategy(params: {
      poolAddress: Address
      newStrategy: string
    }): Promise<TFMMActionResponse> {
      const response = await fetch(`${API_BASE}/api/tfmm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_strategy', params }),
      })
      return handleResponse(response)
    },

    async triggerRebalance(params: {
      poolAddress: Address
    }): Promise<TFMMActionResponse> {
      const response = await fetch(`${API_BASE}/api/tfmm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger_rebalance', params }),
      })
      return handleResponse(response)
    },
  },

  a2a: {
    async getInfo(): Promise<A2AInfoResponse> {
      const response = await fetch(`${API_BASE}/api/a2a`)
      return handleResponse(response)
    },

    async getAgentCard(): Promise<Record<string, unknown>> {
      const response = await fetch(`${API_BASE}/api/a2a?card=true`)
      return handleResponse(response)
    },
  },

  mcp: {
    async getInfo(): Promise<MCPInfoResponse> {
      const response = await fetch(`${API_BASE}/api/mcp`)
      return handleResponse(response)
    },
  },
}

export type BazaarClient = typeof api
