/**
 * Gateway Client Exports
 *
 * Public API for consuming the Gateway from other packages.
 */

import { treaty } from '@elysiajs/eden'
import { getCoreAppUrl } from '@jejunetwork/config/ports'
import type { App } from '../a2a-server.js'
import type { LeaderboardApp } from '../leaderboard/server.js'
import type { RpcApp } from '../rpc/server.js'

export function createGatewayClient(
  baseUrl: string,
  options?: { headers?: Record<string, string> },
) {
  return treaty<App>(
    baseUrl,
    options?.headers ? { headers: options.headers } : {},
  )
}

export type GatewayClient = ReturnType<typeof createGatewayClient>
/** Local A2A server client - uses centralized GATEWAY port (4001 by default) */
export const localGatewayClient = createGatewayClient(getCoreAppUrl('GATEWAY'))

// ============================================================================
// Leaderboard Client
// ============================================================================

/**
 * Creates a typed Eden Treaty client for the Leaderboard API.
 */
export function createLeaderboardClient(
  baseUrl: string,
  options?: { headers?: Record<string, string> },
) {
  return treaty<LeaderboardApp>(
    baseUrl,
    options?.headers ? { headers: options.headers } : {},
  )
}

export type LeaderboardClient = ReturnType<typeof createLeaderboardClient>
export const localLeaderboardClient = createLeaderboardClient(
  getCoreAppUrl('LEADERBOARD_API'),
)

// ============================================================================
// RPC Client
// ============================================================================

/**
 * Creates a typed Eden Treaty client for the RPC Gateway API.
 */
export function createRpcClient(
  baseUrl: string,
  options?: { headers?: Record<string, string> },
) {
  return treaty<RpcApp>(
    baseUrl,
    options?.headers ? { headers: options.headers } : {},
  )
}

export type RpcClient = ReturnType<typeof createRpcClient>
/** Local RPC gateway client - uses centralized RPC_GATEWAY port (4012 by default) */
export const localRpcClient = createRpcClient(getCoreAppUrl('RPC_GATEWAY'))

interface X402VerifyRequest {
  x402Version: number
  paymentHeader: string
  paymentRequirements: {
    scheme: string
    network: string
    maxAmountRequired: string
    payTo: string
    asset: string
    resource: string
  }
}

interface X402VerifyResponse {
  isValid: boolean
  invalidReason?: string
  signer?: string
  amount?: string
  timestamp: number
}

interface X402SettleRequest extends X402VerifyRequest {
  authParams?: {
    validAfter: number
    validBefore: number
    authNonce: string
    authSignature: string
  }
}

interface X402SettleResponse {
  success: boolean
  txHash?: string
  error?: string
  networkId: string
  timestamp: number
}

interface X402SupportedResponse {
  kinds: Array<{ scheme: string; network: string }>
  x402Version: number
  facilitator: {
    name: string
    version: string
    url: string
  }
}

interface X402HealthResponse {
  service: string
  version: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  mode: string
  chainId: number
  network: string
  facilitatorAddress: string
  timestamp: number
}

export class X402Client {
  private baseUrl: string
  private headers: Record<string, string>

  constructor(baseUrl: string, options?: { headers?: Record<string, string> }) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.headers = {
      'Content-Type': 'application/json',
      ...options?.headers,
    }
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers, ...init?.headers },
    })
    return response.json() as Promise<T>
  }

  async health(): Promise<X402HealthResponse> {
    return this.fetch<X402HealthResponse>('/')
  }

  async verify(request: X402VerifyRequest): Promise<X402VerifyResponse> {
    return this.fetch<X402VerifyResponse>('/verify', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async settle(request: X402SettleRequest): Promise<X402SettleResponse> {
    return this.fetch<X402SettleResponse>('/settle', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async settleGasless(request: X402SettleRequest): Promise<X402SettleResponse> {
    return this.fetch<X402SettleResponse>('/settle/gasless', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  }

  async supported(): Promise<X402SupportedResponse> {
    return this.fetch<X402SupportedResponse>('/supported')
  }
}

/**
 * Creates a typed client for the X402 Facilitator API.
 */
export function createX402Client(
  baseUrl: string,
  options?: { headers?: Record<string, string> },
): X402Client {
  return new X402Client(baseUrl, options)
}

/** Local X402 facilitator client - uses centralized FACILITATOR port (3402 by default) */
export const localX402Client = createX402Client(getCoreAppUrl('FACILITATOR'))

export type { App } from '../a2a-server.js'
export type { LeaderboardApp } from '../leaderboard/server.js'
export {
  type A2ARequest,
  A2ARequestSchema,
  AddressSchema,
  type AgentId,
  AgentIdSchema,
  type CancelIntentRequest,
  CancelIntentRequestSchema,
  type CaseId,
  CaseIdSchema,
  ChainIdSchema,
  type CheckBanStatusRequest,
  CheckBanStatusRequestSchema,
  type CreateIntentRequest,
  CreateIntentRequestSchema,
  type FaucetClaimRequest,
  FaucetClaimRequestSchema,
  type FaucetStatusRequest,
  FaucetStatusRequestSchema,
  type GetBestRouteRequest,
  GetBestRouteRequestSchema,
  type GetModerationCasesQuery,
  GetModerationCasesQuerySchema,
  type GetModeratorProfileRequest,
  GetModeratorProfileRequestSchema,
  type GetQuoteRequest,
  GetQuoteRequestSchema,
  type GetReportsQuery,
  GetReportsQuerySchema,
  type GetVolumeQuery,
  GetVolumeQuerySchema,
  HexStringSchema,
  type IntentId,
  IntentIdSchema,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
  type ListIntentsQuery,
  ListIntentsQuerySchema,
  type ListPoolsQuery,
  ListPoolsQuerySchema,
  type ListRoutesQuery,
  ListRoutesQuerySchema,
  type ListSolversQuery,
  ListSolversQuerySchema,
  type McpResourceReadRequest,
  McpResourceReadRequestSchema,
  type McpToolCallRequest,
  McpToolCallRequestSchema,
  type PrepareAppealRequest,
  PrepareAppealRequestSchema,
  type PrepareChallengeRequest,
  PrepareChallengeRequestSchema,
  type PrepareReportRequest,
  PrepareReportRequestSchema,
  type PrepareStakeRequest,
  PrepareStakeRequestSchema,
  type PrepareVoteRequest,
  PrepareVoteRequestSchema,
  type RouteId,
  RouteIdSchema,
  type SolverLeaderboardQuery,
  SolverLeaderboardQuerySchema,
  type SwapQuoteRequest,
  SwapQuoteRequestSchema,
  type TokenPair,
  TokenPairSchema,
} from '../lib/validation.js'
export type { RpcApp } from '../rpc/server.js'
