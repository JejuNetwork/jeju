/**
 * Gateway Client Exports
 *
 * Public API for consuming the Gateway from other packages.
 * Re-exports typed Eden Treaty clients and validation schemas for all gateway services.
 *
 * All clients use Elysia Eden Treaty for end-to-end type safety.
 */

import { treaty } from '@elysiajs/eden'
import type { App } from '../a2a-server.js'
import type { LeaderboardApp } from '../leaderboard/server.js'
import type { RpcApp } from '../rpc/server.js'
import type { X402App } from '../x402/server.js'

// ============================================================================
// Gateway Client (A2A Server)
// ============================================================================

/**
 * Creates a typed Eden Treaty client for the Gateway A2A API.
 */
export function createGatewayClient(
  baseUrl: string,
  options?: { headers?: Record<string, string> },
) {
  return treaty<App>(baseUrl, options?.headers ? { headers: options.headers } : {})
}

export type GatewayClient = ReturnType<typeof createGatewayClient>
export const localGatewayClient = createGatewayClient('http://localhost:4002')

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
  return treaty<LeaderboardApp>(baseUrl, options?.headers ? { headers: options.headers } : {})
}

export type LeaderboardClient = ReturnType<typeof createLeaderboardClient>
export const localLeaderboardClient = createLeaderboardClient('http://localhost:4005')

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
  return treaty<RpcApp>(baseUrl, options?.headers ? { headers: options.headers } : {})
}

export type RpcClient = ReturnType<typeof createRpcClient>
export const localRpcClient = createRpcClient('http://localhost:4004')

// ============================================================================
// X402 Client
// ============================================================================

/**
 * Creates a typed Eden Treaty client for the X402 Facilitator API.
 */
export function createX402Client(
  baseUrl: string,
  options?: { headers?: Record<string, string> },
) {
  return treaty<X402App>(baseUrl, options?.headers ? { headers: options.headers } : {})
}

export type X402Client = ReturnType<typeof createX402Client>
export const localX402Client = createX402Client('http://localhost:4003')

// ============================================================================
// Type Re-exports
// ============================================================================

export type { App } from '../a2a-server.js'
export type { LeaderboardApp } from '../leaderboard/server.js'
export type { RpcApp } from '../rpc/server.js'
export type { X402App } from '../x402/server.js'

// ============================================================================
// Validation Schemas
// ============================================================================

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
