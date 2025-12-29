import type { UUID } from '@elizaos/core'
import { expectAddress, expectHex } from '@jejunetwork/types'
import type { Address, Hex } from 'viem'
import type { AgentCharacter, TeamType } from './types'

export function asAddress(value: string | undefined): Address {
  if (!value) throw new Error('Address value is required')
  return expectAddress(value, 'address')
}

export function asAddressOrDefault(
  value: string | undefined,
  fallback: string,
): Address {
  return expectAddress(value ?? fallback, 'address')
}

export function asHex(value: string): Hex {
  return expectHex(value, 'hex value')
}

export function asAddressArray(values: string[]): Address[] {
  return values.map((v) => expectAddress(v, 'address array element'))
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUUID(value: string): value is UUID {
  return UUID_REGEX.test(value)
}

export function createUUID(): UUID {
  const id = crypto.randomUUID()
  if (!isUUID(id)) throw new Error('Failed to generate valid UUID')
  return id
}

export function asUUID(value: string): UUID {
  if (!isUUID(value)) throw new Error(`Invalid UUID format: ${value}`)
  return value
}

export function parseUUIDArray(jsonStr: string): UUID[] {
  const parsed: unknown = JSON.parse(jsonStr)
  if (!Array.isArray(parsed)) throw new Error('Expected array')
  return parsed.map((item) => {
    if (typeof item !== 'string') throw new Error('Expected string array')
    return asUUID(item)
  })
}

export const TEAM_TYPES = ['red', 'blue', 'neutral', 'mixed'] as const

function isTeamType(value: string): value is TeamType {
  return (TEAM_TYPES as readonly string[]).includes(value)
}

export function asTeamType(value: string): TeamType {
  if (!isTeamType(value)) {
    throw new Error(`Invalid team type: ${value}`)
  }
  return value
}

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

export function asTradeAction(value: string): TradeAction {
  if (!isTradeAction(value)) {
    throw new Error(`Invalid trade action: ${value}`)
  }
  return value
}

function hasNameProperty(value: object): value is object & { name: string } {
  return 'name' in value && typeof value.name === 'string'
}

function isAgentCharacter(value: unknown): value is AgentCharacter {
  if (typeof value !== 'object' || value === null) return false
  return hasNameProperty(value) && typeof value.name === 'string'
}

export function parseAgentCharacter(jsonStr: string): AgentCharacter {
  const parsed: unknown = JSON.parse(jsonStr)
  if (!isAgentCharacter(parsed)) {
    throw new Error('Invalid character data: missing required name field')
  }
  return parsed
}
