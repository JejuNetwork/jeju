/**
 * JNS Service for dapp naming
 *
 * Registers and manages the todo.jeju domain for the dApp.
 * Links the dApp to its decentralized endpoints.
 */

import type { Address, Hex } from 'viem'
import {
  jnsAvailableResponseSchema,
  jnsPriceResponseSchema,
  jnsRecordsSchema,
  jnsRegisterResponseSchema,
  jnsResolveResponseSchema,
} from '../schemas'
import type { JNSRecords } from '../types'
import { normalizeJNSName } from '../utils'
import { expectValid } from '../utils/validation'

const GATEWAY_API = process.env.GATEWAY_API || 'http://localhost:4020'
const JNS_NAME = process.env.JNS_NAME || 'todo.jeju'

interface JNSService {
  isNameAvailable(name: string): Promise<boolean>
  register(
    name: string,
    owner: Address,
    durationYears: number,
  ): Promise<{ txHash: Hex; name: string }>
  setRecords(name: string, records: JNSRecords): Promise<{ txHash: Hex }>
  getRecords(name: string): Promise<JNSRecords>
  resolve(name: string): Promise<Address | null>
  getRegistrationPrice(name: string, durationYears: number): Promise<bigint>
}

class JNSServiceImpl implements JNSService {
  async isNameAvailable(name: string): Promise<boolean> {
    const normalized = normalizeJNSName(name)
    let response: Response
    try {
      response = await fetch(`${GATEWAY_API}/jns/available/${normalized}`)
    } catch (error) {
      throw new Error(
        `JNS gateway unreachable: ${error instanceof Error ? error.message : 'network error'}`,
      )
    }

    if (!response.ok) {
      throw new Error(
        `JNS availability check failed: ${response.status} ${response.statusText}`,
      )
    }

    const data = await response.json()
    const validated = expectValid(
      jnsAvailableResponseSchema,
      data,
      'JNS available response',
    )
    return validated.available
  }

  async register(
    name: string,
    owner: Address,
    durationYears: number,
  ): Promise<{ txHash: Hex; name: string }> {
    const normalized = normalizeJNSName(name)
    const price = await this.getRegistrationPrice(name, durationYears)

    const response = await fetch(`${GATEWAY_API}/jns/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: normalized,
        owner,
        durationYears,
        price: price.toString(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to register name: ${await response.text()}`)
    }

    const data = await response.json()
    const validated = expectValid(
      jnsRegisterResponseSchema,
      data,
      'JNS register response',
    )
    return { txHash: validated.txHash as Hex, name: normalized }
  }

  async setRecords(
    name: string,
    records: JNSRecords,
  ): Promise<{ txHash: Hex }> {
    const normalized = normalizeJNSName(name)

    const response = await fetch(`${GATEWAY_API}/jns/records/${normalized}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(records),
    })

    if (!response.ok) {
      throw new Error(`Failed to set records: ${await response.text()}`)
    }

    const data = await response.json()
    const validated = expectValid(
      jnsRegisterResponseSchema,
      data,
      'JNS set records response',
    )
    return { txHash: validated.txHash as Hex }
  }

  async getRecords(name: string): Promise<JNSRecords> {
    const normalized = normalizeJNSName(name)
    let response: Response
    try {
      response = await fetch(`${GATEWAY_API}/jns/records/${normalized}`)
    } catch (error) {
      throw new Error(
        `JNS gateway unreachable: ${error instanceof Error ? error.message : 'network error'}`,
      )
    }

    if (response.status === 404) {
      // Name not registered - return empty records
      return {}
    }

    if (!response.ok) {
      throw new Error(
        `JNS records fetch failed: ${response.status} ${response.statusText}`,
      )
    }

    const data = await response.json()
    return expectValid(jnsRecordsSchema, data, 'JNS records response')
  }

  async resolve(name: string): Promise<Address | null> {
    const normalized = normalizeJNSName(name)
    let response: Response
    try {
      response = await fetch(`${GATEWAY_API}/jns/resolve/${normalized}`)
    } catch (error) {
      throw new Error(
        `JNS gateway unreachable: ${error instanceof Error ? error.message : 'network error'}`,
      )
    }

    if (response.status === 404) {
      // Name not registered
      return null
    }

    if (!response.ok) {
      throw new Error(
        `JNS resolve failed: ${response.status} ${response.statusText}`,
      )
    }

    const data = await response.json()
    const validated = expectValid(
      jnsResolveResponseSchema,
      data,
      'JNS resolve response',
    )
    return validated.address as Address
  }

  async getRegistrationPrice(
    name: string,
    durationYears: number,
  ): Promise<bigint> {
    const normalized = normalizeJNSName(name)
    let response: Response
    try {
      response = await fetch(
        `${GATEWAY_API}/jns/price/${normalized}?years=${durationYears}`,
      )
    } catch (error) {
      throw new Error(
        `JNS gateway unreachable: ${error instanceof Error ? error.message : 'network error'}`,
      )
    }

    if (!response.ok) {
      throw new Error(
        `JNS price fetch failed: ${response.status} ${response.statusText}`,
      )
    }

    const data = await response.json()
    const validated = expectValid(
      jnsPriceResponseSchema,
      data,
      'JNS price response',
    )
    return BigInt(validated.price)
  }
}

let jnsService: JNSService | null = null

export function getJNSService(): JNSService {
  if (!jnsService) {
    jnsService = new JNSServiceImpl()
  }
  return jnsService
}

// Helper to setup the dApp's JNS configuration
export async function setupDAppJNS(
  owner: Address,
  config: {
    name: string
    backendUrl: string
    frontendCid: string
    description?: string
  },
): Promise<JNSRecords> {
  const jns = getJNSService()

  // Check if name is available or already owned
  const existing = await jns.getRecords(config.name)

  const records: JNSRecords = {
    address: owner,
    contentHash: config.frontendCid
      ? `ipfs://${config.frontendCid}`
      : undefined,
    a2aEndpoint: `${config.backendUrl}/a2a`,
    mcpEndpoint: `${config.backendUrl}/mcp`,
    restEndpoint: `${config.backendUrl}/api/v1`,
    description:
      config.description !== undefined
        ? config.description
        : 'Decentralized Todo Application',
  }

  // If name not registered, register it
  if (!existing.address) {
    await jns.register(config.name, owner, 1)
  }

  // Update records
  await jns.setRecords(config.name, records)

  return records
}

export { JNS_NAME }
