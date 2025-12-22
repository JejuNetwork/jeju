/**
 * Typed API client for Bazaar API
 *
 * Provides type-safe API access using Zod schemas for response validation.
 */

import { getCoreAppUrl } from '@jejunetwork/config/ports'
import type { Address } from 'viem'
import type { z } from 'zod'
import {
  FaucetClaimResultSchema,
  FaucetInfoSchema,
  FaucetStatusSchema,
} from './faucet'

/**
 * API base URL - uses relative path for browser, configurable for server-side
 */
export const API_BASE =
  typeof window !== 'undefined'
    ? ''
    : process.env.BAZAAR_API_URL || getCoreAppUrl('BAZAAR_API')

// =============================================================================
// Response Types (from Zod schemas)
// =============================================================================

export type FaucetInfo = z.infer<typeof FaucetInfoSchema>
export type FaucetStatus = z.infer<typeof FaucetStatusSchema>
export type FaucetClaimResult = z.infer<typeof FaucetClaimResultSchema>

export interface HealthResponse {
  status: string
  service: string
  teeMode?: string
  network?: string
}

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

// =============================================================================
// API Error Handling
// =============================================================================

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function handleResponse<T>(
  response: Response,
  schema?: z.ZodSchema<T>,
): Promise<T> {
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    const message =
      (errorBody as { error?: string }).error ||
      (errorBody as { message?: string }).message ||
      `Request failed: ${response.status}`
    throw new ApiError(
      message,
      response.status,
      errorBody as Record<string, unknown>,
    )
  }

  const data = await response.json()

  if (schema) {
    const result = schema.safeParse(data)
    if (!result.success) {
      throw new ApiError('Invalid response format', 500, {
        zodError: result.error.issues,
      })
    }
    return result.data
  }

  return data as T
}

// =============================================================================
// Typed API Client
// =============================================================================

/**
 * Typed Bazaar API client
 */
export const api = {
  /**
   * Health check endpoint
   */
  health: {
    async get(): Promise<HealthResponse> {
      const response = await fetch(`${API_BASE}/health`)
      return handleResponse(response)
    },
  },

  faucet: {
    /**
     * Get faucet info (amount per claim, cooldown, etc.)
     */
    async getInfo(): Promise<FaucetInfo> {
      const response = await fetch(`${API_BASE}/api/faucet/info`)
      return handleResponse(response, FaucetInfoSchema)
    },

    /**
     * Get faucet status for an address
     */
    async getStatus(address: Address): Promise<FaucetStatus> {
      const response = await fetch(`${API_BASE}/api/faucet/status/${address}`)
      return handleResponse(response, FaucetStatusSchema)
    },

    /**
     * Claim tokens from the faucet
     */
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
    /**
     * Get all TFMM pools with stats
     */
    async getPools(): Promise<TFMMPoolsResponse> {
      const response = await fetch(`${API_BASE}/api/tfmm`)
      return handleResponse(response)
    },

    /**
     * Get a specific TFMM pool
     */
    async getPool(poolAddress: Address): Promise<{ pool: TFMMPool }> {
      const response = await fetch(`${API_BASE}/api/tfmm?pool=${poolAddress}`)
      return handleResponse(response)
    },

    /**
     * Get available strategies
     */
    async getStrategies(): Promise<TFMMStrategiesResponse> {
      const response = await fetch(`${API_BASE}/api/tfmm?action=strategies`)
      return handleResponse(response)
    },

    /**
     * Get oracle status
     */
    async getOracles(): Promise<TFMMOraclesResponse> {
      const response = await fetch(`${API_BASE}/api/tfmm?action=oracles`)
      return handleResponse(response)
    },

    /**
     * Create a new TFMM pool
     */
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

    /**
     * Update pool strategy
     */
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

    /**
     * Trigger pool rebalance
     */
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
    /**
     * Get A2A service info
     */
    async getInfo(): Promise<A2AInfoResponse> {
      const response = await fetch(`${API_BASE}/api/a2a`)
      return handleResponse(response)
    },

    /**
     * Get agent card
     */
    async getAgentCard(): Promise<Record<string, unknown>> {
      const response = await fetch(`${API_BASE}/api/a2a?card=true`)
      return handleResponse(response)
    },
  },

  mcp: {
    /**
     * Get MCP server info
     */
    async getInfo(): Promise<MCPInfoResponse> {
      const response = await fetch(`${API_BASE}/api/mcp`)
      return handleResponse(response)
    },
  },
}

export type BazaarClient = typeof api
