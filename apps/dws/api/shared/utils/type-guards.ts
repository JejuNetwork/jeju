/**
 * DWS-specific Type Guards
 *
 * DWS-specific type guards for agents, CDN, and API operations.
 * For base type guards, import from @jejunetwork/types.
 */

import { isValidAddress, ZERO_ADDRESS } from '@jejunetwork/types'
import { type Address, type Hex, isHex } from 'viem'
import type {
  AgentCharacter,
  AgentStatus,
  RegisterAgentRequest,
  UpdateAgentRequest,
} from '../../agents/types'

// ─────────────────────────────────────────────────────────────────────────────
// Viem Type Guards
// ─────────────────────────────────────────────────────────────────────────────

/** Check if value is a valid hex string (handles null/undefined) */
export function isValidHex(value: string | null | undefined): value is Hex {
  if (typeof value !== 'string') return false
  return isHex(value)
}

/** Parse address from header or string, returns null if invalid */
export function parseAddress(value: string | null | undefined): Address | null {
  if (!value || typeof value !== 'string') return null
  if (!isValidAddress(value)) return null
  return value
}

/** Parse address with fallback */
export function parseAddressOrDefault(
  value: string | null | undefined,
  defaultAddress: Address = ZERO_ADDRESS,
): Address {
  return parseAddress(value) ?? defaultAddress
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Type Guards (DWS-specific)
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_STATUS_VALUES = new Set<AgentStatus>([
  'pending',
  'deploying',
  'active',
  'paused',
  'error',
  'terminated',
])

/** Check if value is a valid AgentStatus */
export function isAgentStatus(
  value: string | null | undefined,
): value is AgentStatus {
  return (
    typeof value === 'string' && (AGENT_STATUS_VALUES as Set<string>).has(value)
  )
}

/** Parse agent status with fallback */
export function parseAgentStatus(
  value: string | null | undefined,
  defaultStatus: AgentStatus = 'pending',
): AgentStatus {
  return isAgentStatus(value) ? value : defaultStatus
}

/** Check if object is a valid AgentCharacter */
export function isAgentCharacter(obj: unknown): obj is AgentCharacter {
  if (typeof obj !== 'object' || obj === null) return false
  const char = obj as Record<string, unknown>
  return (
    typeof char.name === 'string' &&
    typeof char.system === 'string' &&
    Array.isArray(char.bio) &&
    char.bio.every((b) => typeof b === 'string')
  )
}

/** Check if object is a valid RegisterAgentRequest */
export function isRegisterAgentRequest(
  obj: unknown,
): obj is RegisterAgentRequest {
  if (typeof obj !== 'object' || obj === null) return false
  const req = obj as Record<string, unknown>
  return isAgentCharacter(req.character)
}

/** Check if object is a valid UpdateAgentRequest */
export function isUpdateAgentRequest(obj: unknown): obj is UpdateAgentRequest {
  if (typeof obj !== 'object' || obj === null) return false
  const req = obj as Record<string, unknown>

  // At least one property should be present
  const hasCharacter = req.character !== undefined
  const hasModels = req.models !== undefined
  const hasRuntime = req.runtime !== undefined
  const hasSecrets = req.secrets !== undefined
  const hasMetadata = req.metadata !== undefined

  return hasCharacter || hasModels || hasRuntime || hasSecrets || hasMetadata
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron Trigger Type Guards
// ─────────────────────────────────────────────────────────────────────────────

const CRON_ACTION_VALUES = new Set(['think', 'post', 'check', 'custom'])

export type CronAction = 'think' | 'post' | 'check' | 'custom'

/** Check if value is a valid cron action */
export function isCronAction(
  value: string | null | undefined,
): value is CronAction {
  return typeof value === 'string' && CRON_ACTION_VALUES.has(value)
}

// ─────────────────────────────────────────────────────────────────────────────
// Instance Status Type Guards
// ─────────────────────────────────────────────────────────────────────────────

const INSTANCE_STATUS_VALUES = new Set([
  'starting',
  'ready',
  'busy',
  'draining',
  'stopped',
])

export type InstanceStatus =
  | 'starting'
  | 'ready'
  | 'busy'
  | 'draining'
  | 'stopped'

/** Check if value is a valid instance status */
export function isInstanceStatus(
  value: string | null | undefined,
): value is InstanceStatus {
  return typeof value === 'string' && INSTANCE_STATUS_VALUES.has(value)
}

// ─────────────────────────────────────────────────────────────────────────────
// Invocation Status Type Guards
// ─────────────────────────────────────────────────────────────────────────────

const INVOCATION_STATUS_VALUES = new Set([
  'pending',
  'processing',
  'completed',
  'error',
  'timeout',
])

export type InvocationStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'error'
  | 'timeout'

/** Check if value is a valid invocation status */
export function isInvocationStatus(
  value: string | null | undefined,
): value is InvocationStatus {
  return typeof value === 'string' && INVOCATION_STATUS_VALUES.has(value)
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Type Guards
// ─────────────────────────────────────────────────────────────────────────────

const MEMORY_TYPE_VALUES = new Set(['message', 'fact', 'goal', 'reflection'])

export type MemoryType = 'message' | 'fact' | 'goal' | 'reflection'

/** Check if value is a valid memory type */
export function isMemoryType(
  value: string | null | undefined,
): value is MemoryType {
  return typeof value === 'string' && MEMORY_TYPE_VALUES.has(value)
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Header Extraction
// ─────────────────────────────────────────────────────────────────────────────

/** Extract and validate Address from request header */
export function getAddressFromRequest(request: Request): Address | null {
  const header = request.headers.get('x-jeju-address')
  return parseAddress(header)
}

/** Require address from request header, throws if missing/invalid */
export function requireAddressFromRequest(request: Request): Address {
  const address = getAddressFromRequest(request)
  if (!address) {
    throw new Error('Missing or invalid x-jeju-address header')
  }
  return address
}

/** Extract user ID from request headers */
export function getUserIdFromRequest(request: Request): string | null {
  return request.headers.get('x-jeju-user-id')
}

// ─────────────────────────────────────────────────────────────────────────────
// CDN Region Type Guards (DWS-specific)
// ─────────────────────────────────────────────────────────────────────────────

const CDN_REGIONS = new Set([
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-northeast-1',
  'ap-southeast-1',
  'ap-south-1',
  'sa-east-1',
])

export type CDNRegion =
  | 'us-east-1'
  | 'us-east-2'
  | 'us-west-1'
  | 'us-west-2'
  | 'eu-west-1'
  | 'eu-west-2'
  | 'eu-central-1'
  | 'ap-northeast-1'
  | 'ap-southeast-1'
  | 'ap-south-1'
  | 'sa-east-1'

/** Check if value is a valid CDN region */
export function isCDNRegion(
  value: string | null | undefined,
): value is CDNRegion {
  return typeof value === 'string' && CDN_REGIONS.has(value)
}

/** Parse CDN region with fallback */
export function parseCDNRegion(
  value: string | null | undefined,
  defaultRegion: CDNRegion = 'us-east-1',
): CDNRegion {
  return isCDNRegion(value) ? value : defaultRegion
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk Level Type Guards (API Marketplace)
// ─────────────────────────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high'

const RISK_LEVELS = new Set<RiskLevel>(['low', 'medium', 'high'])

/** Check if value is a valid risk level */
export function isRiskLevel(
  value: string | null | undefined,
): value is RiskLevel {
  return typeof value === 'string' && (RISK_LEVELS as Set<string>).has(value)
}

// ─────────────────────────────────────────────────────────────────────────────
// CQL Query Response Type Guards
// ─────────────────────────────────────────────────────────────────────────────

/** Generic CQL query response shape */
export interface CqlQueryResponse<T> {
  rows?: T[]
}

/** Check if value is a valid CQL query response */
export function isCqlQueryResponse<T>(
  data: unknown,
): data is CqlQueryResponse<T> {
  if (typeof data !== 'object' || data === null) return false
  const obj = data as Record<string, unknown>
  return obj.rows === undefined || Array.isArray(obj.rows)
}
