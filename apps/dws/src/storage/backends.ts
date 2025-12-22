/**
 * Storage Backends for DWS
 * Supports local storage and IPFS with extensible backend system
 */

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

  constructor(apiUrl: string, gatewayUrl: string) {
    this.apiUrl = apiUrl
    this.gatewayUrl = gatewayUrl
  }

  async upload(
    content: Buffer,
    options?: { filename?: string },
  ): Promise<{ cid: string; url: string }> {
    const formData = new FormData()
    // Flatten path to avoid IPFS creating directories (which returns multiple JSON lines)
    const filename = (options?.filename || 'file').replace(/\//g, '_')
    formData.append('file', new Blob([new Uint8Array(content)]), filename)

    const response = await fetch(`${this.apiUrl}/api/v0/add`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok)
      throw new Error(`IPFS upload failed: ${response.statusText}`)

    // IPFS can return multiple lines if filename has slashes; take first line
    const text = await response.text()
    const firstLine = text.trim().split('\n')[0]
    const data = expectJson(
      firstLine,
      IpfsAddResponseSchema,
      'IPFS add response',
    )
    return { cid: data.Hash, url: `${this.gatewayUrl}/ipfs/${data.Hash}` }
  }

  async download(cid: string): Promise<Buffer> {
    const response = await fetch(`${this.gatewayUrl}/ipfs/${cid}`)
    if (!response.ok)
      throw new Error(`IPFS download failed: ${response.statusText}`)
    return Buffer.from(await response.arrayBuffer())
  }

  async exists(cid: string): Promise<boolean> {
    const response = await fetch(`${this.gatewayUrl}/ipfs/${cid}`, {
      method: 'HEAD',
    })
    return response.ok
  }

  async healthCheck(): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}/api/v0/id`, {
      method: 'POST',
    }).catch((err: Error) => {
      console.warn(`[IPFS Backend] Health check failed: ${err.message}`)
      return null
    })
    return response?.ok ?? false
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

    const ipfsApiUrl = process.env.IPFS_API_URL
    const ipfsGatewayUrl = process.env.IPFS_GATEWAY_URL || 'https://ipfs.io'
    if (ipfsApiUrl) {
      this.backends.set('ipfs', new IPFSBackend(ipfsApiUrl, ipfsGatewayUrl))
    }
  }

  async upload(
    content: Buffer,
    options?: UploadOptions,
  ): Promise<UploadResponse> {
    let backendName = options?.preferredBackend

    if (!backendName) {
      backendName = this.backends.has('ipfs') ? 'ipfs' : 'local'
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
      const content = await backend.download(cid).catch((err: Error) => {
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

    throw new Error(`Content not found: ${cid}`)
  }

  async downloadBatch(cids: string[]): Promise<Map<string, Buffer>> {
    const results = new Map<string, Buffer>()
    for (const cid of cids) {
      const response = await this.download(cid).catch((err: Error) => {
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
    return false
  }

  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {}
    for (const [name, backend] of this.backends) {
      results[name] = await backend.healthCheck().catch((err: Error) => {
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
