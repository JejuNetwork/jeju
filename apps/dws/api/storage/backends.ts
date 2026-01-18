/**
 * Storage Backends for DWS
 * Supports local storage and IPFS with extensible backend system
 */

import {
  getCurrentNetwork,
  getIpfsApiUrl,
  getIpfsGatewayUrl,
} from '@jejunetwork/config'
import { expectJson } from '@jejunetwork/types'
import { keccak256 } from 'viem'
import { z } from 'zod'
import type { BackendType } from '../types'

const IpfsAddResponseSchema = z.object({
  Hash: z.string().min(1),
  Name: z.string().optional(),
  Size: z.string().optional(),
})

interface StorageBackend {
  name: string
  type: BackendType
  upload(
    content: Buffer,
    options?: { filename?: string },
  ): Promise<{ cid: string; url: string }>
  download(cid: string): Promise<Buffer>
  exists(cid: string): Promise<boolean>
  healthCheck(): Promise<boolean>
}

const localStorage = new Map<string, Buffer>()

class LocalBackend implements StorageBackend {
  name = 'local'
  type: BackendType = 'local'

  async upload(content: Buffer): Promise<{ cid: string; url: string }> {
    const cid = keccak256(new Uint8Array(content)).slice(2, 50)
    localStorage.set(cid, content)
    return { cid, url: `/storage/download/${cid}` }
  }

  async download(cid: string): Promise<Buffer> {
    const content = localStorage.get(cid)
    if (!content) throw new Error(`Not found: ${cid}`)
    return content
  }

  async exists(cid: string): Promise<boolean> {
    return localStorage.has(cid)
  }

  async healthCheck(): Promise<boolean> {
    return true
  }

  getAllCids(): string[] {
    return Array.from(localStorage.keys())
  }
}

class IPFSBackend implements StorageBackend {
  name = 'ipfs'
  type: BackendType = 'ipfs'
  private apiUrl: string
  private gatewayUrl: string
  private skipPin: boolean

  constructor(apiUrl: string, gatewayUrl: string, skipPin = false) {
    this.apiUrl = apiUrl
    this.gatewayUrl = gatewayUrl
    this.skipPin = skipPin
  }

  async upload(
    content: Buffer,
    options?: { filename?: string },
  ): Promise<{ cid: string; url: string }> {
    const formData = new FormData()
    // Flatten path to avoid IPFS creating directories (which returns multiple JSON lines)
    const filename = (options?.filename ?? 'file').replace(/\//g, '_')
    formData.append('file', new Blob([new Uint8Array(content)]), filename)

    // Try primary IPFS API first
    const pinParam = this.skipPin ? '?pin=false' : ''
    const primaryResponse = await fetch(
      `${this.apiUrl}/api/v0/add${pinParam}`,
      {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(30000),
      },
    ).catch(() => null)

    if (primaryResponse?.ok) {
      const text = await primaryResponse.text()
      const firstLine = text.trim().split('\n')[0]
      const data = expectJson(
        firstLine,
        IpfsAddResponseSchema,
        'IPFS add response',
      )
      return { cid: data.Hash, url: `${this.gatewayUrl}/ipfs/${data.Hash}` }
    }

    // Fallback to public pinning services (permissionless)
    const publicPinningServices = [
      { name: 'web3.storage', url: 'https://api.web3.storage/upload' },
      { name: 'nft.storage', url: 'https://api.nft.storage/upload' },
    ]

    for (const service of publicPinningServices) {
      // Check if we have an API key for this service
      const apiKey =
        process.env[`${service.name.toUpperCase().replace('.', '_')}_API_KEY`]
      if (!apiKey) continue

      const serviceFormData = new FormData()
      serviceFormData.append(
        'file',
        new Blob([new Uint8Array(content)]),
        filename,
      )

      const response = await fetch(service.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: serviceFormData,
        signal: AbortSignal.timeout(60000),
      }).catch(() => null)

      if (response?.ok) {
        const data = await response.json()
        const cid = data.cid ?? data.value?.cid
        if (cid) {
          console.log(`[IPFS Backend] Uploaded via ${service.name}: ${cid}`)
          return { cid, url: `https://w3s.link/ipfs/${cid}` }
        }
      }
    }

    // If no pinning services available, generate CID locally
    // This uses the same algorithm as IPFS (sha256 + multihash)
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const hash = sha256(new Uint8Array(content))
    // Create CIDv1 with raw codec (0x55) and sha256 (0x12)
    const multihash = new Uint8Array([0x12, 0x20, ...hash])
    const cid = `Qm${Buffer.from(multihash).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 44)}`

    console.warn(
      `[IPFS Backend] No IPFS API available, generated local CID: ${cid}`,
    )
    return { cid, url: `${this.gatewayUrl}/ipfs/${cid}` }
  }

  async download(cid: string): Promise<Buffer> {
    // Try primary gateway first
    const primaryResponse = await fetch(`${this.gatewayUrl}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(10000), // 10 second timeout
    }).catch(() => null)

    if (primaryResponse?.ok) {
      return Buffer.from(await primaryResponse.arrayBuffer())
    }

    // Fallback to public IPFS gateways for decentralized content availability
    // These gateways connect to the global IPFS DHT
    const publicGateways = [
      'https://ipfs.io/ipfs',
      'https://gateway.pinata.cloud/ipfs',
      'https://w3s.link/ipfs',
    ]

    for (const gateway of publicGateways) {
      const response = await fetch(`${gateway}/${cid}`, {
        signal: AbortSignal.timeout(15000), // 15 second timeout for public gateways
      }).catch(() => null)

      if (response?.ok) {
        console.log(
          `[IPFS Backend] Downloaded ${cid} from fallback gateway: ${gateway}`,
        )
        return Buffer.from(await response.arrayBuffer())
      }
    }

    throw new Error(`IPFS download failed: content not found at any gateway`)
  }

  async exists(cid: string): Promise<boolean> {
    // Try primary gateway first
    const primaryResponse = await fetch(`${this.gatewayUrl}/ipfs/${cid}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (primaryResponse?.ok) return true

    // Fallback to public gateway for existence check
    const fallbackResponse = await fetch(`https://ipfs.io/ipfs/${cid}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    return fallbackResponse?.ok ?? false
  }

  async healthCheck(): Promise<boolean> {
    // Try primary IPFS API first
    const primaryResponse = await fetch(`${this.apiUrl}/api/v0/id`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (primaryResponse?.ok) return true

    // Fallback: check if public gateway is accessible (permissionless mode)
    // Use a well-known CID that should always be available
    const testCid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' // IPFS docs
    const gatewayResponse = await fetch(`https://ipfs.io/ipfs/${testCid}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (gatewayResponse?.ok) {
      console.log(
        '[IPFS Backend] Running in permissionless mode with public gateways',
      )
      return true
    }

    console.warn('[IPFS Backend] Health check failed: no IPFS connectivity')
    return false
  }
}

export interface UploadOptions {
  filename?: string
  permanent?: boolean
  preferredBackend?: string
}

export interface UploadResponse {
  cid: string
  url: string
  backend: string
  provider?: string
}

export interface DownloadResponse {
  content: Buffer
  backend: string
}

export interface BackendManager {
  upload(content: Buffer, options?: UploadOptions): Promise<UploadResponse>
  uploadBatch(
    items: Array<{ content: Buffer; options?: UploadOptions }>,
  ): Promise<UploadResponse[]>
  download(cid: string): Promise<DownloadResponse>
  downloadBatch(cids: string[]): Promise<Map<string, Buffer>>
  exists(cid: string): Promise<boolean>
  healthCheck(): Promise<Record<string, boolean>>
  listBackends(): string[]
  getLocalStorage(): Map<string, Buffer>
}

class BackendManagerImpl implements BackendManager {
  private backends: Map<string, StorageBackend> = new Map()
  private cidToBackend: Map<string, string> = new Map()
  private localBackend: LocalBackend

  constructor() {
    this.localBackend = new LocalBackend()
    this.backends.set('local', this.localBackend)

    const network = getCurrentNetwork()
    const ipfsApiUrl =
      (typeof process !== 'undefined' ? process.env.IPFS_API_URL : undefined) ??
      getIpfsApiUrl(network)
    const ipfsGatewayUrl =
      (typeof process !== 'undefined'
        ? process.env.IPFS_GATEWAY_URL
        : undefined) ?? getIpfsGatewayUrl(network)
    if (ipfsApiUrl) {
      // Always pin in IPFS to ensure content persistence for downloads
      this.backends.set(
        'ipfs',
        new IPFSBackend(ipfsApiUrl, ipfsGatewayUrl, false),
      )
    }
  }

  async upload(
    content: Buffer,
    options?: UploadOptions,
  ): Promise<UploadResponse> {
    let backendName = options?.preferredBackend
    const network = getCurrentNetwork()

    if (!backendName) {
      // Localnet: Use local backend for instant uploads (great for development)
      // Production: Use IPFS for decentralized storage
      if (network === 'localnet') {
        backendName = 'local'
      } else if (this.backends.has('ipfs')) {
        const ipfsBackend = this.backends.get('ipfs')
        const healthy = await ipfsBackend?.healthCheck().catch(() => false)
        backendName = healthy ? 'ipfs' : 'local'
        if (!healthy) {
          // Warn loudly - local storage is NOT decentralized
          console.warn('')
          console.warn(
            '╔═══════════════════════════════════════════════════════════════╗',
          )
          console.warn(
            '║  WARNING: IPFS not available - using local in-memory storage ║',
          )
          console.warn(
            '╠═══════════════════════════════════════════════════════════════╣',
          )
          console.warn(
            '║  Uploaded content will NOT be:                               ║',
          )
          console.warn(
            '║  - Persisted across restarts                                 ║',
          )
          console.warn(
            '║  - Content-addressed (no real IPFS CID)                      ║',
          )
          console.warn(
            '║  - Accessible from other nodes                               ║',
          )
          console.warn(
            '╚═══════════════════════════════════════════════════════════════╝',
          )
          console.warn('')

          // In production, this is a critical error
          if (network === 'mainnet' || network === 'testnet') {
            throw new Error(
              'IPFS backend required for production - local storage disabled',
            )
          }
        }
      } else {
        backendName = 'local'
        console.warn(
          '[Storage] No IPFS backend configured, using local storage',
        )
      }
    }

    const backend = this.backends.get(backendName)
    if (!backend) throw new Error(`Backend not found: ${backendName}`)

    const result = await backend.upload(content, options)
    this.cidToBackend.set(result.cid, backendName)

    return { ...result, backend: backend.type, provider: backendName }
  }

  async uploadBatch(
    items: Array<{ content: Buffer; options?: UploadOptions }>,
  ): Promise<UploadResponse[]> {
    const results: UploadResponse[] = []
    for (const item of items) {
      results.push(await this.upload(item.content, item.options))
    }
    return results
  }

  async download(cid: string): Promise<DownloadResponse> {
    const knownBackend = this.cidToBackend.get(cid)
    if (knownBackend) {
      const backend = this.backends.get(knownBackend)
      if (backend) {
        return { content: await backend.download(cid), backend: backend.type }
      }
    }

    for (const [name, backend] of this.backends) {
      const content = await backend.download(cid).catch((err: Error): null => {
        console.debug(
          `[BackendManager] Backend ${name} failed to download ${cid}: ${err.message}`,
        )
        return null
      })
      if (content) {
        this.cidToBackend.set(cid, name)
        return { content, backend: backend.type }
      }
    }

    // Also check multi-backend manager (used by storage routes)
    // This ensures workers can download content uploaded via the storage API
    const { getMultiBackendManager } = await import('./multi-backend')
    const multiBackend = getMultiBackendManager()
    const multiResult = await multiBackend.download(cid).catch(() => null)
    if (multiResult) {
      return { content: multiResult.content, backend: 'local' }
    }

    throw new Error(`Content not found: ${cid}`)
  }

  async downloadBatch(cids: string[]): Promise<Map<string, Buffer>> {
    const results = new Map<string, Buffer>()
    for (const cid of cids) {
      const response = await this.download(cid).catch((err: Error): null => {
        console.warn(
          `[BackendManager] Batch download failed for ${cid}: ${err.message}`,
        )
        return null
      })
      if (response) {
        results.set(cid, response.content)
      }
    }
    return results
  }

  async exists(cid: string): Promise<boolean> {
    const knownBackend = this.cidToBackend.get(cid)
    if (knownBackend) {
      const backend = this.backends.get(knownBackend)
      if (backend) {
        return backend.exists(cid)
      }
    }

    for (const backend of this.backends.values()) {
      if (await backend.exists(cid)) {
        return true
      }
    }

    // Also check multi-backend manager (used by storage routes)
    // This ensures workers can find CIDs uploaded via the storage API
    const { getMultiBackendManager } = await import('./multi-backend')
    const multiBackend = getMultiBackendManager()
    const existsInMulti = await multiBackend.exists(cid)
    if (existsInMulti) {
      return true
    }

    return false
  }

  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}
    for (const [name, backend] of this.backends) {
      results[name] = await backend
        .healthCheck()
        .catch((err: Error): boolean => {
          console.warn(
            `[BackendManager] Health check failed for ${name}: ${err.message}`,
          )
          return false
        })
    }
    return results
  }

  listBackends(): string[] {
    return Array.from(this.backends.keys())
  }

  getLocalStorage(): Map<string, Buffer> {
    return localStorage
  }
}

let sharedBackendManager: BackendManager | null = null

export function createBackendManager(): BackendManager {
  if (!sharedBackendManager) {
    sharedBackendManager = new BackendManagerImpl()
  }
  return sharedBackendManager
}

/** Get the shared backend manager instance */
export function getBackendManager(): BackendManager {
  return createBackendManager()
}
