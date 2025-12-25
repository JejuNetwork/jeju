/**
 * Crucible-specific Type Guards
 *
 * Only crucible-specific helpers are defined here.
 * Import common validators directly from @jejunetwork/types.
 */

import type { UUID } from '@elizaos/core'
import { expectAddress, expectHex } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import type { AgentCharacter, TeamType } from './types'

// ============================================================================
// Address Helpers (crucible-specific overloads)
// ============================================================================

/**
 * Validate and cast a string to an Ethereum address.
 * Throws if value is undefined or invalid.
 */
export function asAddress(value: string | undefined): Address {
  if (!value) throw new Error('Address value is required')
  return expectAddress(value, 'address')
}

/** Safe address conversion with fallback (for config initialization) */
export function asAddressOrDefault(
  value: string | undefined,
  fallback: string,
): Address {
  return expectAddress(value ?? fallback, 'address')
}

/** Convert string to hex data for transactions */
export function asHex(value: string): Hex {
  return expectHex(value, 'hex value')
}

/** Convert string array to address array */
export function asAddressArray(values: string[]): Address[] {
  return values.map((v) => expectAddress(v, 'address array element'))
}

// ============================================================================
// UUID Types (UUID is a branded string type from @elizaos/core)
// ============================================================================

/** Validate UUID format */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUUID(value: string): value is UUID {
  return UUID_REGEX.test(value)
}

/** Create a new UUID */
export function createUUID(): UUID {
  const id = crypto.randomUUID()
  if (!isUUID(id)) throw new Error('Failed to generate valid UUID')
  return id
}

/** Validate and cast a string to UUID type */
export function asUUID(value: string): UUID {
  if (!isUUID(value)) throw new Error(`Invalid UUID format: ${value}`)
  return value
}

/** Parse a JSON string as a UUID array */
export function parseUUIDArray(jsonStr: string): UUID[] {
  const parsed: unknown = JSON.parse(jsonStr)
  if (!Array.isArray(parsed)) throw new Error('Expected array')
  return parsed.map((item) => {
    if (typeof item !== 'string') throw new Error('Expected string array')
    return asUUID(item)
  })
}

// ============================================================================
// Team Types (Crucible-specific)
// ============================================================================

export const TEAM_TYPES = ['red', 'blue', 'neutral', 'mixed'] as const

function isTeamType(value: string): value is TeamType {
  return (TEAM_TYPES as readonly string[]).includes(value)
}

/** Validate and cast a string to a team type */
export function asTeamType(value: string): TeamType {
  if (!isTeamType(value)) {
    throw new Error(`Invalid team type: ${value}`)
  }
  return value
}

// ============================================================================
// Trade Action Types (Crucible-specific)
// ============================================================================

export const TRADE_ACTIONS = [
  'buy',
  'sell',
  'swap',
  'provide_liquidity',
  'remove_liquidity',
] as const
export type TradeAction = (typeof TRADE_ACTIONS)[number]

function isTradeAction(value: string): value is TradeAction {
  return (TRADE_ACTIONS as readonly string[]).includes(value)
}

/** Validate and cast a string to a trade action */
export function asTradeAction(value: string): TradeAction {
  if (!isTradeAction(value)) {
    throw new Error(`Invalid trade action: ${value}`)
  }
  return value
}

// ============================================================================
// JSON Parsing Helpers (Crucible-specific)
// ============================================================================

function hasNameProperty(value: object): value is object & { name: string } {
  return (
    'name' in value && typeof (value as { name?: unknown }).name === 'string'
  )
}

function isAgentCharacter(value: unknown): value is AgentCharacter {
  if (typeof value !== 'object' || value === null) return false
  return hasNameProperty(value) && typeof value.name === 'string'
}

/** Parse JSON string as AgentCharacter with basic validation */
export function parseAgentCharacter(jsonStr: string): AgentCharacter {
  const parsed: unknown = JSON.parse(jsonStr)
  if (!isAgentCharacter(parsed)) {
    throw new Error('Invalid character data: missing required name field')
  }
  return parsed
}
