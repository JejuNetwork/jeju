/**
 * Storage Module - IPFS, multi-provider storage
 */

import type { StorageTier } from '@jejunetwork/shared'
import type { JsonValue, NetworkType } from '@jejunetwork/types'
import { parseEther } from 'viem'
import type { z } from 'zod'
import { getServicesConfig } from '../config'
import { generateAuthHeaders } from '../shared/api'
import {
  PinInfoSchema,
  PinsListSchema,
  StorageStatsSchema,
  UploadResultSchema,
} from '../shared/schemas'
import type { BaseWallet } from '../wallet'

export * from './enhanced'

export type { StorageTier }

export interface StorageStats {
  totalPins: number
  totalSizeBytes: number
  totalSizeGB: number
}

export interface PinInfo {
  cid: string
  name: string
  status: 'queued' | 'pinning' | 'pinned' | 'failed'
  sizeBytes: number
  createdAt: number
  tier: StorageTier
}

export interface UploadOptions {
  name?: string
  tier?: StorageTier
  durationMonths?: number
}

export interface UploadResult {
  cid: string
  size: number
  gatewayUrl: string
}

export interface StorageModule {
  // Stats
  getStats(): Promise<StorageStats>

  // Upload
  upload(
    data: Uint8Array | Blob | File,
    options?: UploadOptions,
  ): Promise<UploadResult>
  uploadJson(
    data: JsonValue | Record<string, JsonValue>,
    options?: UploadOptions,
  ): Promise<UploadResult>

  // Pin management
  pin(cid: string, options?: UploadOptions): Promise<void>
  unpin(cid: string): Promise<void>
  listPins(): Promise<PinInfo[]>
  getPinStatus(cid: string): Promise<PinInfo>

  // Retrieval
  retrieve(cid: string): Promise<Uint8Array>
  /**
   * Retrieve and validate JSON from storage using a Zod schema
   * @param cid - Content identifier
   * @param schema - Zod schema for validation
   * @throws Error if validation fails
   */
  retrieveJson<T>(cid: string, schema: z.ZodType<T>): Promise<T>
  getGatewayUrl(cid: string): string

  // Cost estimation
  estimateCost(
    sizeBytes: number,
    durationMonths: number,
    tier: StorageTier,
  ): bigint
}

const STORAGE_PRICING = {
  hot: parseEther('0.0001'), // per GB per month
  warm: parseEther('0.00005'),
  cold: parseEther('0.00001'),
  permanent: parseEther('0.01'), // one-time per GB
}

export function createStorageModule(
  wallet: BaseWallet,
  network: NetworkType,
): StorageModule {
  const services = getServicesConfig(network)
  const apiUrl = services.storage.api
  const gatewayUrl = services.storage.ipfsGateway

  async function authHeaders(): Promise<Record<string, string>> {
    return generateAuthHeaders(wallet, 'jeju-storage')
  }

  async function getStats(): Promise<StorageStats> {
    const response = await fetch(`${apiUrl}/stats`, {
      headers: await authHeaders(),
    })

    if (!response.ok)
      throw new Error(`Failed to get stats: ${response.statusText}`)

    const data: unknown = await response.json()
    return StorageStatsSchema.parse(data)
  }

  async function upload(
    data: Uint8Array | Blob | File,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    const formData = new FormData()
    const blob =
      data instanceof Uint8Array ? new Blob([new Uint8Array(data)]) : data
    formData.append('file', blob, options?.name ?? 'file')

    if (options?.tier) formData.append('tier', options.tier)
    if (options?.durationMonths)
      formData.append('durationMonths', options.durationMonths.toString())

    const headers = await authHeaders()
    delete headers['Content-Type'] // Let browser set multipart boundary

    const response = await fetch(`${apiUrl}/upload`, {
      method: 'POST',
      headers,
      body: formData,
    })

    if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`)

    const rawData: unknown = await response.json()
    const result = UploadResultSchema.parse(rawData)

    return {
      cid: result.cid,
      size: result.size,
      gatewayUrl: getGatewayUrl(result.cid),
    }
  }

  async function uploadJson(
    data: JsonValue | Record<string, JsonValue>,
    options?: UploadOptions,
  ): Promise<UploadResult> {
    const json = JSON.stringify(data)
    const bytes = new TextEncoder().encode(json)
    return upload(new Blob([new Uint8Array(bytes)]), {
      ...options,
      name: options?.name ?? 'data.json',
    })
  }

  async function pin(cid: string, options?: UploadOptions): Promise<void> {
    const response = await fetch(`${apiUrl}/pins`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        cid,
        name: options?.name ?? cid,
        tier: options?.tier ?? 'warm',
        durationMonths: options?.durationMonths ?? 1,
      }),
    })

    if (!response.ok) throw new Error(`Pin failed: ${response.statusText}`)
  }

  async function unpin(cid: string): Promise<void> {
    const response = await fetch(`${apiUrl}/pins/${cid}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    })

    if (!response.ok) throw new Error(`Unpin failed: ${response.statusText}`)
  }

  async function listPins(): Promise<PinInfo[]> {
    const response = await fetch(`${apiUrl}/pins`, {
      headers: await authHeaders(),
    })

    if (!response.ok)
      throw new Error(`List pins failed: ${response.statusText}`)

    const rawData: unknown = await response.json()
    const data = PinsListSchema.parse(rawData)
    return data.results
  }

  async function getPinStatus(cid: string): Promise<PinInfo> {
    const response = await fetch(`${apiUrl}/pins/${cid}`, {
      headers: await authHeaders(),
    })

    if (!response.ok)
      throw new Error(`Get pin status failed: ${response.statusText}`)

    const rawData: unknown = await response.json()
    return PinInfoSchema.parse(rawData)
  }

  async function retrieve(cid: string): Promise<Uint8Array> {
    const response = await fetch(`${gatewayUrl}/ipfs/${cid}`)
    if (!response.ok) throw new Error(`Retrieve failed: ${response.statusText}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  async function retrieveJson<T>(
    cid: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await fetch(`${gatewayUrl}/ipfs/${cid}`)
    if (!response.ok) {
      throw new Error(`Retrieve failed: ${response.statusText}`)
    }
    const data: unknown = await response.json()
    return schema.parse(data)
  }

  function getGatewayUrl(cid: string): string {
    return `${gatewayUrl}/ipfs/${cid}`
  }

  function estimateCost(
    sizeBytes: number,
    durationMonths: number,
    tier: StorageTier,
  ): bigint {
    const sizeGB = sizeBytes / (1024 * 1024 * 1024)
    const pricePerGbMonth = STORAGE_PRICING[tier]

    if (tier === 'permanent') {
      return BigInt(Math.ceil(sizeGB)) * pricePerGbMonth
    }

    return BigInt(Math.ceil(sizeGB * durationMonths)) * pricePerGbMonth
  }

  return {
    getStats,
    upload,
    uploadJson,
    pin,
    unpin,
    listPins,
    getPinStatus,
    retrieve,
    retrieveJson,
    getGatewayUrl,
    estimateCost,
  }
}
