/**
 * Multi-Backend Storage Module - Multi-backend decentralized storage
 *
 * Provides easy-to-use interface for:
 * - Multi-backend storage (WebTorrent, IPFS, Arweave)
 * - Content tiering (System, Popular, Private)
 * - KMS encryption for private content
 * - P2P content distribution
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, parseEther } from 'viem'
import { getServicesConfig } from '../config'
import { generateAuthHeaders } from '../shared/api'
import {
  ContentInfoSchema,
  ContentListSchema,
  JsonValueSchema,
  KMSDecryptResponseSchema,
  KMSEncryptResponseSchema,
  MultiBackendStorageStatsSchema,
  MultiBackendUploadResultSchema,
  TorrentInfoSchema,
} from '../shared/schemas'
import type { JsonValue } from '../shared/types'
import type { JejuWallet } from '../wallet'

// Types

export type StorageBackend = 'webtorrent' | 'ipfs' | 'arweave' | 'local'
export type ContentTier = 'system' | 'popular' | 'private'
export type ContentCategory =
  | 'app-bundle'
  | 'contract-abi'
  | 'user-content'
  | 'media'
  | 'data'

export interface MultiBackendStorageStats {
  totalPins: number
  totalSizeBytes: number
  totalSizeGB: number
  byTier: {
    system: { count: number; size: number }
    popular: { count: number; size: number }
    private: { count: number; size: number }
  }
  byBackend: Record<StorageBackend, { count: number; size: number }>
}

export interface ContentInfo {
  cid: string
  name?: string
  size: number
  tier: ContentTier
  category: ContentCategory
  backends: StorageBackend[]
  magnetUri?: string
  arweaveTxId?: string
  encrypted?: boolean
  createdAt: number
  accessCount: number
}

export interface MultiBackendUploadOptions {
  name?: string
  tier?: ContentTier
  category?: ContentCategory
  backends?: StorageBackend[]

  // Encryption (for private content)
  encrypt?: boolean
  accessPolicy?: AccessPolicy

  // Arweave
  permanent?: boolean

  // WebTorrent
  createTorrent?: boolean
}

export interface MultiBackendUploadResult {
  cid: string
  size: number
  tier: ContentTier
  backends: StorageBackend[]
  gatewayUrl: string
  magnetUri?: string
  arweaveTxId?: string
  encrypted?: boolean
  encryptionKeyId?: string
}

export interface DownloadOptions {
  preferredBackend?: StorageBackend
  decrypt?: boolean
  region?: string
}

export interface AccessPolicy {
  type: 'public' | 'stake-gated' | 'token-gated' | 'agent-owner' | 'role-gated'
  params?: {
    minStakeUSD?: number
    tokenAddress?: Address
    minBalance?: string
    agentId?: number
    role?: string
    registryAddress?: Address
  }
}

export interface MultiBackendStorageModule {
  // Stats
  getStats(): Promise<MultiBackendStorageStats>

  // Upload
  upload(
    data: Uint8Array | Blob | File,
    options?: MultiBackendUploadOptions,
  ): Promise<MultiBackendUploadResult>
  uploadJson(
    data: JsonValue,
    options?: MultiBackendUploadOptions,
  ): Promise<MultiBackendUploadResult>
  uploadPermanent(
    data: Uint8Array | Blob | File,
    options?: Omit<MultiBackendUploadOptions, 'permanent'>,
  ): Promise<MultiBackendUploadResult>

  // Download
  download(cid: string, options?: DownloadOptions): Promise<Uint8Array>
  downloadJson<T extends JsonValue = JsonValue>(
    cid: string,
    options?: DownloadOptions,
  ): Promise<T>

  // Content management
  getContent(cid: string): Promise<ContentInfo | null>
  listContent(options?: {
    tier?: ContentTier
    category?: ContentCategory
  }): Promise<ContentInfo[]>

  // WebTorrent
  getTorrentInfo(
    cid: string,
  ): Promise<{ magnetUri: string; peers: number; seeds: number } | null>
  seedContent(cid: string): Promise<void>

  // URLs
  getGatewayUrl(cid: string): string
  getMagnetUri(cid: string): Promise<string | null>
  getArweaveUrl(txId: string): string

  // Cost estimation
  estimateCost(
    sizeBytes: number,
    options: MultiBackendUploadOptions,
  ): Promise<{
    ipfs: bigint
    arweave: bigint
    total: bigint
  }>
}

const STORAGE_PRICING = {
  ipfs: {
    hot: parseEther('0.0001'), // per GB per month
    warm: parseEther('0.00005'),
    cold: parseEther('0.00001'),
  },
  arweave: parseEther('0.01'), // one-time per GB (permanent)
  webtorrent: parseEther('0'), // Free (P2P)
}

export function createMultiBackendStorageModule(
  wallet: JejuWallet,
  network: NetworkType,
): MultiBackendStorageModule {
  const services = getServicesConfig(network)
  const apiUrl = services.storage.api
  const gatewayUrl = services.storage.ipfsGateway
  const arweaveGateway = 'https://arweave.net'

  async function authHeaders(): Promise<Record<string, string>> {
    return generateAuthHeaders(wallet, 'jeju-storage')
  }

  async function getStats(): Promise<MultiBackendStorageStats> {
    const response = await fetch(`${apiUrl}/v2/stats`, {
      headers: await authHeaders(),
    })

    if (!response.ok) {
      throw new Error(`Failed to get stats: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    return MultiBackendStorageStatsSchema.parse(rawData)
  }

  async function upload(
    data: Uint8Array | Blob | File,
    options: MultiBackendUploadOptions = {},
  ): Promise<MultiBackendUploadResult> {
    const formData = new FormData()
    const blob =
      data instanceof Uint8Array ? new Blob([new Uint8Array(data)]) : data
    formData.append('file', blob, options.name ?? 'file')

    // Set options
    if (options.tier) formData.append('tier', options.tier)
    if (options.category) formData.append('category', options.category)
    if (options.backends)
      formData.append('backends', options.backends.join(','))
    if (options.encrypt) formData.append('encrypt', 'true')
    if (options.permanent) formData.append('permanent', 'true')
    if (options.createTorrent !== false)
      formData.append('createTorrent', 'true')

    if (options.accessPolicy) {
      formData.append('accessPolicy', JSON.stringify(options.accessPolicy))
    }

    const headers = await authHeaders()
    delete headers['Content-Type']

    const response = await fetch(`${apiUrl}/v2/upload`, {
      method: 'POST',
      headers,
      body: formData,
    })

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const result = MultiBackendUploadResultSchema.parse(rawData)
    return {
      ...result,
      gatewayUrl: getGatewayUrl(result.cid),
    }
  }

  async function uploadJson(
    data: JsonValue,
    options: MultiBackendUploadOptions = {},
  ): Promise<MultiBackendUploadResult> {
    const json = JSON.stringify(data)
    const bytes = new TextEncoder().encode(json)
    return upload(new Uint8Array(bytes), {
      ...options,
      name: options.name ?? 'data.json',
      category: options.category ?? 'data',
    })
  }

  async function uploadPermanent(
    data: Uint8Array | Blob | File,
    options: Omit<MultiBackendUploadOptions, 'permanent'> = {},
  ): Promise<MultiBackendUploadResult> {
    return upload(data, {
      ...options,
      permanent: true,
      backends: ['arweave', 'ipfs', 'webtorrent'],
    })
  }

  async function download(
    cid: string,
    options: DownloadOptions = {},
  ): Promise<Uint8Array> {
    const params = new URLSearchParams()
    if (options.preferredBackend)
      params.append('backend', options.preferredBackend)
    if (options.decrypt) params.append('decrypt', 'true')
    if (options.region) params.append('region', options.region)

    const url = `${apiUrl}/v2/download/${cid}${params.toString() ? `?${params.toString()}` : ''}`

    const response = await fetch(url, {
      headers: await authHeaders(),
    })

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`)
    }

    return new Uint8Array(await response.arrayBuffer())
  }

  async function downloadJson<T extends JsonValue = JsonValue>(
    cid: string,
    options: DownloadOptions = {},
  ): Promise<T> {
    const data = await download(cid, options)
    const text = new TextDecoder().decode(data)
    const parsed = JsonValueSchema.parse(JSON.parse(text))
    return parsed as T
  }

  async function getContent(cid: string): Promise<ContentInfo | null> {
    const response = await fetch(`${apiUrl}/v2/content/${cid}`, {
      headers: await authHeaders(),
    })

    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to get content: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    return ContentInfoSchema.parse(rawData)
  }

  async function listContent(options?: {
    tier?: ContentTier
    category?: ContentCategory
  }): Promise<ContentInfo[]> {
    const params = new URLSearchParams()
    if (options?.tier) params.append('tier', options.tier)
    if (options?.category) params.append('category', options.category)

    const url = `${apiUrl}/v2/content${params.toString() ? `?${params.toString()}` : ''}`

    const response = await fetch(url, {
      headers: await authHeaders(),
    })

    if (!response.ok) {
      throw new Error(`Failed to list content: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const data = ContentListSchema.parse(rawData)
    return data.items
  }

  async function getTorrentInfo(
    cid: string,
  ): Promise<{ magnetUri: string; peers: number; seeds: number } | null> {
    const response = await fetch(`${apiUrl}/v2/torrent/${cid}`)

    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to get torrent info: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    return TorrentInfoSchema.parse(rawData)
  }

  async function seedContent(cid: string): Promise<void> {
    const response = await fetch(`${apiUrl}/v2/seed/${cid}`, {
      method: 'POST',
      headers: await authHeaders(),
    })

    if (!response.ok) {
      throw new Error(`Failed to seed content: ${response.statusText}`)
    }
  }

  function getGatewayUrl(cid: string): string {
    return `${gatewayUrl}/ipfs/${cid}`
  }

  async function getMagnetUri(cid: string): Promise<string | null> {
    const info = await getTorrentInfo(cid)
    return info?.magnetUri ?? null
  }

  function getArweaveUrl(txId: string): string {
    return `${arweaveGateway}/${txId}`
  }

  async function estimateCost(
    sizeBytes: number,
    options: MultiBackendUploadOptions,
  ): Promise<{ ipfs: bigint; arweave: bigint; total: bigint }> {
    const sizeGB = sizeBytes / (1024 * 1024 * 1024)

    // IPFS cost (monthly)
    const ipfsTier = options.tier === 'private' ? 'hot' : 'warm'
    const ipfsCost = BigInt(Math.ceil(sizeGB)) * STORAGE_PRICING.ipfs[ipfsTier]

    // Arweave cost (one-time permanent)
    const arweaveCost = options.permanent
      ? BigInt(Math.ceil(sizeGB)) * STORAGE_PRICING.arweave
      : 0n

    return {
      ipfs: ipfsCost,
      arweave: arweaveCost,
      total: ipfsCost + arweaveCost,
    }
  }

  return {
    getStats,
    upload,
    uploadJson,
    uploadPermanent,
    download,
    downloadJson,
    getContent,
    listContent,
    getTorrentInfo,
    seedContent,
    getGatewayUrl,
    getMagnetUri,
    getArweaveUrl,
    estimateCost,
  }
}

export interface EncryptionOptions {
  policy: AccessPolicy
  kmsEndpoint: string
}

export async function encryptForStorage(
  data: Uint8Array,
  options: EncryptionOptions,
): Promise<{ ciphertext: Uint8Array; keyId: string }> {
  const response = await fetch(`${options.kmsEndpoint}/encrypt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: Buffer.from(data).toString('base64'),
      policy: options.policy,
    }),
  })

  if (!response.ok) {
    throw new Error(`Encryption failed: ${response.statusText}`)
  }

  const rawData: unknown = await response.json()
  const result = KMSEncryptResponseSchema.parse(rawData)
  return {
    ciphertext: new Uint8Array(Buffer.from(result.ciphertext, 'base64')),
    keyId: result.keyId,
  }
}

export async function decryptFromStorage(
  ciphertext: Uint8Array,
  keyId: string,
  kmsEndpoint: string,
): Promise<Uint8Array> {
  const response = await fetch(`${kmsEndpoint}/decrypt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ciphertext: Buffer.from(ciphertext).toString('base64'),
      keyId,
    }),
  })

  if (!response.ok) {
    throw new Error(`Decryption failed: ${response.statusText}`)
  }

  const rawData: unknown = await response.json()
  const result = KMSDecryptResponseSchema.parse(rawData)
  return new Uint8Array(Buffer.from(result.plaintext, 'base64'))
}

export function publicPolicy(): AccessPolicy {
  return { type: 'public' }
}

export function stakeGatedPolicy(
  registryAddress: Address,
  minStakeUSD: number,
): AccessPolicy {
  return {
    type: 'stake-gated',
    params: { registryAddress, minStakeUSD },
  }
}

export function tokenGatedPolicy(
  tokenAddress: Address,
  minBalance: string,
): AccessPolicy {
  return {
    type: 'token-gated',
    params: { tokenAddress, minBalance },
  }
}

export function agentOwnerPolicy(
  registryAddress: Address,
  agentId: number,
): AccessPolicy {
  return {
    type: 'agent-owner',
    params: { registryAddress, agentId },
  }
}

export function roleGatedPolicy(
  registryAddress: Address,
  role: string,
): AccessPolicy {
  return {
    type: 'role-gated',
    params: { registryAddress, role },
  }
}
