/**
 * Custom RPC Management Service
 * Add and manage custom RPC endpoints for supported chains
 */

import { ChainIdSchema, expectValid } from '@jejunetwork/types'
import { createPublicClient, http, type PublicClient } from 'viem'
import { z } from 'zod'
import { RpcChainIdResponseSchema } from '../../../lib/api-responses'
import { storage } from '../../../web/platform/storage'
import { CustomChainSchema, CustomRPCSchema } from '../../plugin/schemas'

export interface CustomRPC {
  id: string
  chainId: number
  name: string
  url: string
  isDefault: boolean
  isHealthy: boolean
  latency?: number
  lastChecked?: number
  addedAt: number
}

export interface CustomChain {
  id: number
  name: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  rpcUrls: string[]
  blockExplorerUrl?: string
  iconUrl?: string
  isTestnet: boolean
  addedAt: number
}

const STORAGE_KEYS = {
  customRpcs: 'jeju_custom_rpcs',
  customChains: 'jeju_custom_chains',
  rpcPreferences: 'jeju_rpc_preferences',
}

class CustomRPCService {
  private customRpcs: Map<string, CustomRPC> = new Map()
  private customChains: Map<number, CustomChain> = new Map()
  private rpcPreferences: Map<number, string> = new Map() // chainId -> rpcId
  private clients: Map<string, PublicClient> = new Map()

  async initialize(): Promise<void> {
    // Load custom RPCs
    const rpcs = await storage.getJSON(
      STORAGE_KEYS.customRpcs,
      z.array(CustomRPCSchema),
    )
    if (rpcs) {
      for (const rpc of rpcs) {
        this.customRpcs.set(rpc.id, rpc)
      }
    }

    // Load custom chains
    const chains = await storage.getJSON(
      STORAGE_KEYS.customChains,
      z.array(CustomChainSchema),
    )
    if (chains) {
      for (const chain of chains) {
        this.customChains.set(chain.id, chain)
      }
    }

    // Load preferences
    const prefs = await storage.getJSON(
      STORAGE_KEYS.rpcPreferences,
      z.array(z.tuple([ChainIdSchema, z.string()])),
    )
    if (prefs) {
      for (const [chainId, rpcId] of prefs) {
        this.rpcPreferences.set(chainId, rpcId)
      }
    }
  }

  /**
   * Add a custom RPC endpoint
   */
  async addCustomRPC(params: {
    chainId: number
    name: string
    url: string
  }): Promise<CustomRPC> {
    // Validate URL
    if (!this.isValidUrl(params.url)) {
      throw new Error('Invalid RPC URL')
    }

    // Test the RPC
    const isHealthy = await this.testRPC(params.url, params.chainId)
    if (!isHealthy) {
      throw new Error('RPC endpoint is not responding correctly')
    }

    const rpc: CustomRPC = {
      id: this.generateId('rpc'),
      chainId: params.chainId,
      name: params.name,
      url: params.url,
      isDefault: false,
      isHealthy: true,
      addedAt: Date.now(),
      lastChecked: Date.now(),
    }

    this.customRpcs.set(rpc.id, rpc)
    await this.saveRPCs()

    return rpc
  }

  /**
   * Update a custom RPC
   */
  async updateCustomRPC(
    id: string,
    updates: Partial<Pick<CustomRPC, 'name' | 'url'>>,
  ): Promise<CustomRPC> {
    const rpc = this.customRpcs.get(id)
    if (!rpc) {
      throw new Error('RPC not found')
    }

    if (updates.url && updates.url !== rpc.url) {
      if (!this.isValidUrl(updates.url)) {
        throw new Error('Invalid RPC URL')
      }
      const isHealthy = await this.testRPC(updates.url, rpc.chainId)
      if (!isHealthy) {
        throw new Error('RPC endpoint is not responding correctly')
      }
    }

    const updated: CustomRPC = {
      ...rpc,
      ...updates,
    }

    this.customRpcs.set(id, updated)
    this.clients.delete(id) // Invalidate cached client
    await this.saveRPCs()

    return updated
  }

  /**
   * Delete a custom RPC
   */
  async deleteCustomRPC(id: string): Promise<void> {
    const rpc = this.customRpcs.get(id)
    if (!rpc) return

    this.customRpcs.delete(id)
    this.clients.delete(id)

    // Remove from preferences if set
    if (this.rpcPreferences.get(rpc.chainId) === id) {
      this.rpcPreferences.delete(rpc.chainId)
      await this.savePreferences()
    }

    await this.saveRPCs()
  }

  /**
   * Get all custom RPCs for a chain
   */
  getCustomRPCs(chainId?: number): CustomRPC[] {
    const rpcs = Array.from(this.customRpcs.values())
    if (chainId !== undefined) {
      return rpcs.filter((rpc) => rpc.chainId === chainId)
    }
    return rpcs
  }

  /**
   * Set preferred RPC for a chain
   */
  async setPreferredRPC(chainId: number, rpcId: string | null): Promise<void> {
    if (rpcId === null) {
      this.rpcPreferences.delete(chainId)
    } else {
      const rpc = this.customRpcs.get(rpcId)
      if (!rpc || rpc.chainId !== chainId) {
        throw new Error('Invalid RPC for this chain')
      }
      this.rpcPreferences.set(chainId, rpcId)
    }
    await this.savePreferences()
  }

  /**
   * Get preferred RPC URL for a chain
   */
  getPreferredRPCUrl(chainId: number): string | null {
    const rpcId = this.rpcPreferences.get(chainId)
    if (!rpcId) return null

    const rpc = this.customRpcs.get(rpcId)
    return rpc?.url || null
  }

  /**
   * Get client for custom RPC
   */
  getClient(rpcId: string): PublicClient | null {
    const rpc = this.customRpcs.get(rpcId)
    if (!rpc) return null

    if (!this.clients.has(rpcId)) {
      const client = createPublicClient({
        transport: http(rpc.url, { timeout: 10000 }),
      })
      this.clients.set(rpcId, client)
    }

    return this.clients.get(rpcId) || null
  }

  /**
   * Add a custom chain
   */
  async addCustomChain(params: {
    chainId: number
    name: string
    nativeCurrency: CustomChain['nativeCurrency']
    rpcUrl: string
    blockExplorerUrl?: string
    iconUrl?: string
    isTestnet?: boolean
  }): Promise<CustomChain> {
    // Check if chain already exists
    if (this.customChains.has(params.chainId)) {
      throw new Error('Chain already exists')
    }

    // Validate RPC
    const isHealthy = await this.testRPC(params.rpcUrl, params.chainId)
    if (!isHealthy) {
      throw new Error('RPC endpoint is not responding correctly')
    }

    const chain: CustomChain = {
      id: params.chainId,
      name: params.name,
      nativeCurrency: params.nativeCurrency,
      rpcUrls: [params.rpcUrl],
      blockExplorerUrl: params.blockExplorerUrl,
      iconUrl: params.iconUrl,
      isTestnet: params.isTestnet || false,
      addedAt: Date.now(),
    }

    this.customChains.set(chain.id, chain)
    await this.saveChains()

    // Also add as a custom RPC
    await this.addCustomRPC({
      chainId: params.chainId,
      name: `${params.name} RPC`,
      url: params.rpcUrl,
    })

    return chain
  }

  /**
   * Delete a custom chain
   */
  async deleteCustomChain(chainId: number): Promise<void> {
    this.customChains.delete(chainId)

    // Remove associated RPCs
    for (const [id, rpc] of this.customRpcs) {
      if (rpc.chainId === chainId) {
        this.customRpcs.delete(id)
        this.clients.delete(id)
      }
    }

    this.rpcPreferences.delete(chainId)

    await Promise.all([
      this.saveChains(),
      this.saveRPCs(),
      this.savePreferences(),
    ])
  }

  /**
   * Get all custom chains
   */
  getCustomChains(): CustomChain[] {
    return Array.from(this.customChains.values())
  }

  /**
   * Get a custom chain by ID
   */
  getCustomChain(chainId: number): CustomChain | undefined {
    return this.customChains.get(chainId)
  }

  /**
   * Test RPC health
   */
  async testRPC(url: string, expectedChainId?: number): Promise<boolean> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
      }),
    })

    if (!response.ok) return false

    const data = expectValid(
      RpcChainIdResponseSchema,
      await response.json(),
      'RPC eth_chainId response',
    )
    if (data.error) return false

    // Verify chain ID if expected
    if (expectedChainId !== undefined && data.result) {
      const chainId = parseInt(data.result, 16)
      if (chainId !== expectedChainId) return false
    }

    return true
  }

  /**
   * Check health of all RPCs
   */
  async healthCheckAll(): Promise<void> {
    for (const [id, rpc] of this.customRpcs) {
      const start = Date.now()
      const isHealthy = await this.testRPC(rpc.url, rpc.chainId)
      const latency = Date.now() - start

      this.customRpcs.set(id, {
        ...rpc,
        isHealthy,
        latency,
        lastChecked: Date.now(),
      })
    }

    await this.saveRPCs()
  }

  private isValidUrl(url: string): boolean {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  private async saveRPCs(): Promise<void> {
    const data = Array.from(this.customRpcs.values())
    await storage.set(STORAGE_KEYS.customRpcs, JSON.stringify(data))
  }

  private async saveChains(): Promise<void> {
    const data = Array.from(this.customChains.values())
    await storage.set(STORAGE_KEYS.customChains, JSON.stringify(data))
  }

  private async savePreferences(): Promise<void> {
    const data = Array.from(this.rpcPreferences.entries())
    await storage.set(STORAGE_KEYS.rpcPreferences, JSON.stringify(data))
  }
}

export const customRPCService = new CustomRPCService()
export { CustomRPCService }
