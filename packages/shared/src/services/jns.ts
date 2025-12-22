/**
 * JNS Service - Jeju Name Service Integration
 *
 * Provides decentralized naming for dApps.
 */

import type { Address, Hex } from 'viem'
import { z } from 'zod'

const JNSConfigSchema = z.object({
  gatewayEndpoint: z.string().url(),
})

export type JNSConfig = z.infer<typeof JNSConfigSchema>

export interface JNSService {
  isAvailable(name: string): Promise<boolean>
  register(
    name: string,
    owner: Address,
    durationYears: number,
  ): Promise<{ txHash: Hex; name: string }>
  resolve(name: string): Promise<Address | null>
  reverseResolve(address: Address): Promise<string | null>
  getRecords(name: string): Promise<JNSRecords>
  setRecords(name: string, records: JNSRecords): Promise<{ txHash: Hex }>
  getPrice(name: string, durationYears: number): Promise<bigint>
}

export interface JNSRecords {
  address?: Address
  contentHash?: string
  a2aEndpoint?: string
  mcpEndpoint?: string
  restEndpoint?: string
  avatar?: string
  url?: string
  description?: string
  text?: Record<string, string>
}

class JNSServiceImpl implements JNSService {
  private gateway: string

  constructor(config: JNSConfig) {
    const validated = JNSConfigSchema.parse(config)
    this.gateway = validated.gatewayEndpoint
  }

  async isAvailable(name: string): Promise<boolean> {
    const normalized = this.normalize(name)
    const response = await fetch(`${this.gateway}/jns/available/${normalized}`)
    if (!response.ok) {
      throw new Error(`Failed to check name availability: ${response.status}`)
    }
    const data = (await response.json()) as { available: boolean }
    return data.available
  }

  async register(
    name: string,
    owner: Address,
    durationYears: number,
  ): Promise<{ txHash: Hex; name: string }> {
    const normalized = this.normalize(name)
    const price = await this.getPrice(name, durationYears)

    const response = await fetch(`${this.gateway}/jns/register`, {
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

    const data = (await response.json()) as { txHash: Hex }
    return { txHash: data.txHash, name: normalized }
  }

  async resolve(name: string): Promise<Address | null> {
    const normalized = this.normalize(name)
    const response = await fetch(`${this.gateway}/jns/resolve/${normalized}`)
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to resolve name: ${response.status}`)
    }
    const data = (await response.json()) as { address: Address }
    return data.address
  }

  async reverseResolve(address: Address): Promise<string | null> {
    const response = await fetch(`${this.gateway}/jns/reverse/${address}`)
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to reverse resolve: ${response.status}`)
    }
    const data = (await response.json()) as { name: string }
    return data.name
  }

  async getRecords(name: string): Promise<JNSRecords> {
    const normalized = this.normalize(name)
    const response = await fetch(`${this.gateway}/jns/records/${normalized}`)
    if (!response.ok) {
      if (response.status === 404) return {}
      throw new Error(`Failed to get records: ${response.status}`)
    }
    return (await response.json()) as JNSRecords
  }

  async setRecords(
    name: string,
    records: JNSRecords,
  ): Promise<{ txHash: Hex }> {
    const normalized = this.normalize(name)

    const response = await fetch(`${this.gateway}/jns/records/${normalized}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(records),
    })

    if (!response.ok) {
      throw new Error(`Failed to set records: ${await response.text()}`)
    }

    return (await response.json()) as { txHash: Hex }
  }

  async getPrice(name: string, durationYears: number): Promise<bigint> {
    const normalized = this.normalize(name)
    const response = await fetch(
      `${this.gateway}/jns/price/${normalized}?years=${durationYears}`,
    )

    if (!response.ok) {
      throw new Error(`Failed to get price: ${response.status}`)
    }

    const data = (await response.json()) as { price: string }
    return BigInt(data.price)
  }

  private normalize(name: string): string {
    return name.endsWith('.jeju') ? name : `${name}.jeju`
  }
}

let instance: JNSService | null = null

export function createJNSService(config: JNSConfig): JNSService {
  if (!instance) {
    instance = new JNSServiceImpl(config)
  }
  return instance
}

export function getJNSServiceFromEnv(): JNSService {
  const gatewayEndpoint = process.env.GATEWAY_API
  if (!gatewayEndpoint) {
    throw new Error('GATEWAY_API environment variable is required')
  }
  return createJNSService({ gatewayEndpoint })
}

export function resetJNSService(): void {
  instance = null
}

// Helper to setup full JNS records for a dApp
export async function setupDAppJNS(
  jns: JNSService,
  owner: Address,
  config: {
    name: string
    backendUrl: string
    frontendCid?: string
    description?: string
  },
): Promise<JNSRecords> {
  const existing = await jns.getRecords(config.name)

  const records: JNSRecords = {
    address: owner,
    contentHash: config.frontendCid
      ? `ipfs://${config.frontendCid}`
      : existing.contentHash,
    a2aEndpoint: `${config.backendUrl}/a2a`,
    mcpEndpoint: `${config.backendUrl}/mcp`,
    restEndpoint: `${config.backendUrl}/api/v1`,
    description: config.description || existing.description,
  }

  // Register if not owned
  if (!existing.address) {
    await jns.register(config.name, owner, 1)
  }

  // Update records
  await jns.setRecords(config.name, records)

  return records
}
