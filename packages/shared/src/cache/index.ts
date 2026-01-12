/**
 * DWS Cache Rental Client
 *
 * This module provides the CacheRentalClient for managing DWS cache instances.
 * For standard cache operations, import directly from @jejunetwork/cache.
 */

import { getDWSCacheUrl } from '@jejunetwork/config'
import type { Address } from 'viem'
import { z } from 'zod'

// Schemas for cache rental API responses
const CacheInstanceSchema = z.object({
  id: z.string(),
  owner: z.string(),
  namespace: z.string(),
  maxMemoryMb: z.number(),
  usedMemoryMb: z.number(),
  keyCount: z.number(),
  createdAt: z.number(),
  expiresAt: z.number(),
  status: z.enum(['creating', 'running', 'stopped', 'expired', 'error']),
})

const CacheRentalPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  maxMemoryMb: z.number(),
  maxKeys: z.number(),
  pricePerHour: z.string(),
  pricePerMonth: z.string(),
  teeRequired: z.boolean(),
})

export interface CacheClientConfig {
  endpoint: string
  namespace: string
  defaultTtl?: number
  timeout?: number
}

export interface CacheClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttl?: number): Promise<{ success: boolean }>
  /** Atomic set-if-not-exists for distributed locking */
  setNX(key: string, value: string, ttl: number): Promise<boolean>
  delete(key: string): Promise<boolean>
  mget(...keys: string[]): Promise<Map<string, string | null>>
  mset(
    entries: Array<{ key: string; value: string; ttl?: number }>,
  ): Promise<boolean>
  keys(pattern?: string): Promise<string[]>
  ttl(key: string): Promise<number>
  expire(key: string, ttl: number): Promise<boolean>
  clear(): Promise<void>
  getStats(): Promise<CacheStats>
}

export interface CacheStats {
  totalKeys: number
  namespaces: number
  usedMemoryMb?: number
  totalMemoryMb?: number
  usedMemoryBytes?: number
  maxMemoryBytes?: number
  hits: number
  misses: number
  hitRate: number
  totalInstances?: number
  evictions?: number
  expiredKeys?: number
  avgKeySize?: number
  avgValueSize?: number
  oldestKeyAge?: number
  uptime?: number
}

export interface CacheInstance {
  id: string
  owner: Address
  namespace: string
  maxMemoryMb: number
  usedMemoryMb: number
  keyCount: number
  createdAt: number
  expiresAt: number
  status: 'creating' | 'running' | 'stopped' | 'expired' | 'error'
}

export interface CacheRentalPlan {
  id: string
  name: string
  maxMemoryMb: number
  maxKeys: number
  pricePerHour: string
  pricePerMonth: string
  teeRequired: boolean
}

// Cache rental management
export class CacheRentalClient {
  private endpoint: string
  private timeout: number

  constructor(endpoint: string, timeout = 5000) {
    this.endpoint = endpoint
    this.timeout = timeout
  }

  async listPlans(): Promise<CacheRentalPlan[]> {
    const response = await fetch(`${this.endpoint}/plans`, {
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`List plans failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = z.object({ plans: z.array(CacheRentalPlanSchema) }).parse(json)
    return data.plans
  }

  async createInstance(
    planId: string,
    namespace?: string,
    durationHours = 720,
  ): Promise<CacheInstance> {
    const response = await fetch(`${this.endpoint}/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId, namespace, durationHours }),
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`Create instance failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = z.object({ instance: CacheInstanceSchema }).parse(json)
    return data.instance as CacheInstance
  }

  async getInstance(id: string): Promise<CacheInstance | null> {
    const response = await fetch(`${this.endpoint}/instances/${id}`, {
      signal: AbortSignal.timeout(this.timeout),
    })

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Get instance failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = z.object({ instance: CacheInstanceSchema }).parse(json)
    return data.instance as CacheInstance
  }

  async listInstances(): Promise<CacheInstance[]> {
    const response = await fetch(`${this.endpoint}/instances`, {
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`List instances failed: ${response.statusText}`)
    }

    const json = await response.json()
    const data = z
      .object({ instances: z.array(CacheInstanceSchema) })
      .parse(json)
    return data.instances as CacheInstance[]
  }

  async deleteInstance(id: string): Promise<void> {
    const response = await fetch(`${this.endpoint}/instances/${id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(this.timeout),
    })

    if (!response.ok) {
      throw new Error(`Delete instance failed: ${response.statusText}`)
    }
  }
}

let rentalClient: CacheRentalClient | null = null

export function getCacheRentalClient(): CacheRentalClient {
  if (rentalClient) return rentalClient

  const endpoint = getDWSCacheUrl()
  rentalClient = new CacheRentalClient(endpoint)
  return rentalClient
}

export function resetCacheRentalClient(): void {
  rentalClient = null
}

// Re-export cache helpers
export {
  type CachedFarcasterProfile,
  type CachedTokenInfo,
  CacheTTL,
  cachedRpcCall,
  createHybridCache,
  createRpcCacheKey,
  getCachedProfile,
  getCachedTokenInfo,
  getCachedTokenPrice,
  getCachedTokenPrices,
  getRpcMethodTtl,
  type HybridCache,
  hashKey,
  hashRpcParams,
  invalidateProfile,
  isRpcMethodCacheable,
  resetSharedCaches,
  withCache,
  withJsonCache,
} from './helpers'
