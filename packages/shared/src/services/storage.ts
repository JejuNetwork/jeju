/**
 * Storage Service - IPFS Integration
 *
 * Provides decentralized file storage via the Storage Marketplace.
 */

import type { Address } from 'viem'
import { type ZodSchema, z } from 'zod'
import type { ProtocolValue } from '../types'

export type StorageTier = 'hot' | 'warm' | 'cold' | 'permanent'

const StorageConfigSchema = z.object({
  apiEndpoint: z.string().url(),
  gatewayEndpoint: z.string().url(),
  defaultTier: z.enum(['hot', 'warm', 'cold', 'permanent']).default('hot'),
})

export type StorageConfig = z.infer<typeof StorageConfigSchema>

export interface StorageService {
  upload(
    data: Uint8Array | Blob,
    name: string,
    options?: UploadOptions,
  ): Promise<UploadResult>
  uploadJson<T>(
    data: T,
    name?: string,
    options?: UploadOptions,
  ): Promise<UploadResult>
  retrieve(cid: string): Promise<Uint8Array>
  /**
   * Retrieve and parse JSON from storage.
   * @param cid - Content identifier
   * @param schema - Optional Zod schema for validation (recommended for security)
   */
  retrieveJson<T>(cid: string, schema?: ZodSchema<T>): Promise<T>
  getUrl(cid: string): string
  pin(cid: string, options?: PinOptions): Promise<void>
  unpin(cid: string): Promise<void>
  isHealthy(): Promise<boolean>
}

export interface UploadOptions {
  tier?: StorageTier
  encrypt?: boolean
  owner?: Address
}

export interface UploadResult {
  cid: string
  size: number
  url: string
}

export interface PinOptions {
  tier?: StorageTier
  durationMonths?: number
}

class StorageServiceImpl implements StorageService {
  private apiEndpoint: string
  private gatewayEndpoint: string
  private defaultTier: StorageTier
  private available = true
  private localFallback = new Map<string, Uint8Array>()

  constructor(config: StorageConfig) {
    const validated = StorageConfigSchema.parse(config)
    this.apiEndpoint = validated.apiEndpoint
    this.gatewayEndpoint = validated.gatewayEndpoint
    this.defaultTier = validated.defaultTier
  }

  async upload(
    data: Uint8Array | Blob,
    name: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    // Create blob from Uint8Array by slicing to get a proper ArrayBuffer
    const blob = data instanceof Blob ? data : new Blob([data.slice().buffer])
    const tier = options?.tier ?? this.defaultTier

    if (this.available) {
      const cid = await this.remoteUpload(blob, name, tier, options?.owner)
      if (cid) {
        return {
          cid,
          size: blob.size,
          url: this.getUrl(cid),
        }
      }
    }

    // Fallback to local
    const localCid = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(await data.arrayBuffer())
    this.localFallback.set(localCid, bytes)

    return {
      cid: localCid,
      size: bytes.length,
      url: `local://${localCid}`,
    }
  }

  async uploadJson<T>(
    data: T,
    name?: string,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    const json = JSON.stringify(data)
    const bytes = new TextEncoder().encode(json)
    return this.upload(bytes, name ?? 'data.json', options)
  }

  async retrieve(cid: string): Promise<Uint8Array> {
    if (cid.startsWith('local-')) {
      const data = this.localFallback.get(cid)
      if (!data) throw new Error('File not found in local storage')
      return data
    }

    if (this.available) {
      const data = await this.remoteRetrieve(cid)
      if (data) return data
    }

    throw new Error('Unable to retrieve file')
  }

  /**
   * Retrieve and parse JSON from storage with optional schema validation.
   *
   * SECURITY: Always provide a schema when retrieving external data
   * to prevent insecure deserialization attacks.
   */
  async retrieveJson<T>(cid: string, schema?: ZodSchema<T>): Promise<T> {
    const data = await this.retrieve(cid)
    const text = new TextDecoder().decode(data)

    // Parse JSON - safe as JSON.parse doesn't execute code
    // Use ProtocolValue which covers all valid JSON types
    const parsed = JSON.parse(text) as ProtocolValue

    // If schema provided, validate the parsed data
    if (schema) {
      const result = schema.safeParse(parsed)
      if (!result.success) {
        throw new Error(
          `Storage data validation failed for CID ${cid}: ${result.error.message}`,
        )
      }
      return result.data
    }

    // Without schema, return as-is but warn in development
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `[Storage] Retrieving JSON from CID ${cid} without schema validation - consider providing a Zod schema for security`,
      )
    }

    return parsed as T
  }

  getUrl(cid: string): string {
    if (cid.startsWith('local-')) {
      return `local://${cid}`
    }
    return `${this.gatewayEndpoint}/ipfs/${cid}`
  }

  async pin(cid: string, options?: PinOptions): Promise<void> {
    if (!this.available) return

    await fetch(`${this.apiEndpoint}/pins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cid,
        tier: options?.tier ?? this.defaultTier,
        durationMonths: options?.durationMonths ?? 1,
      }),
      signal: AbortSignal.timeout(30000),
    })
  }

  async unpin(cid: string): Promise<void> {
    if (cid.startsWith('local-')) {
      this.localFallback.delete(cid)
      return
    }

    if (!this.available) return

    await fetch(`${this.apiEndpoint}/pins/${cid}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10000),
    })
  }

  async isHealthy(): Promise<boolean> {
    if (!this.available) {
      this.available = await this.checkHealth()
    }
    return this.available
  }

  private async remoteUpload(
    blob: Blob,
    name: string,
    tier: StorageTier,
    owner?: Address,
  ): Promise<string | null> {
    const formData = new FormData()
    formData.append('file', blob, name)
    formData.append('tier', tier)

    const headers: Record<string, string> = {}
    if (owner) headers['x-jeju-address'] = owner

    const response = await fetch(`${this.apiEndpoint}/upload`, {
      method: 'POST',
      headers,
      body: formData,
      signal: AbortSignal.timeout(60000),
    }).catch((err: Error) => {
      console.error('[Storage] Upload failed:', err.message)
      this.available = false
      return null
    })

    if (!response) return null
    if (!response.ok) {
      console.error(`[Storage] Upload failed: ${response.status}`)
      return null
    }
    const data = (await response.json()) as { cid: string }
    return data.cid
  }

  private async remoteRetrieve(cid: string): Promise<Uint8Array | null> {
    const response = await fetch(`${this.gatewayEndpoint}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(60000),
    })

    if (!response.ok) {
      console.error(`[Storage] Retrieve failed: ${response.status}`)
      return null
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  private async checkHealth(): Promise<boolean> {
    const response = await fetch(`${this.apiEndpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  }
}

let instance: StorageService | null = null

export function createStorageService(config: StorageConfig): StorageService {
  if (!instance) {
    instance = new StorageServiceImpl(config)
  }
  return instance
}

export function getStorageServiceFromEnv(): StorageService {
  const apiEndpoint = process.env.STORAGE_API_ENDPOINT
  const gatewayEndpoint = process.env.IPFS_GATEWAY
  if (!apiEndpoint) {
    throw new Error('STORAGE_API_ENDPOINT environment variable is required')
  }
  if (!gatewayEndpoint) {
    throw new Error('IPFS_GATEWAY environment variable is required')
  }
  return createStorageService({
    apiEndpoint,
    gatewayEndpoint,
    defaultTier: 'hot',
  })
}

export function resetStorageService(): void {
  instance = null
}
