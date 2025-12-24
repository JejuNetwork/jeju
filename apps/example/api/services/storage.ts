import { treaty } from '@elysiajs/eden'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { cidResponseSchema, parseJsonResponse } from '../../lib/schemas'

const STORAGE_ENDPOINT =
  process.env.STORAGE_API_ENDPOINT || 'http://localhost:4010'
const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'http://localhost:4180'
const STORAGE_TIMEOUT = 30000

interface StorageService {
  upload(data: Uint8Array, name: string, owner: Address): Promise<string>
  retrieve(cid: string): Promise<Uint8Array>
  getUrl(cid: string): string
  isHealthy(): Promise<boolean>
}

const CID_PATTERN =
  /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,}|z[1-9A-HJ-NP-Za-km-z]+|f[a-f0-9]+)$/

function validateCID(cid: string): string {
  if (!cid || cid.length === 0) {
    throw new StorageError('CID is required', 400)
  }
  if (cid.includes('/') || cid.includes('\\') || cid.includes('..')) {
    throw new StorageError('Invalid CID: contains path characters', 400)
  }
  if (!CID_PATTERN.test(cid)) {
    throw new StorageError(`Invalid CID format: ${cid}`, 400)
  }
  return cid
}

function sanitizeFileName(name: string): string {
  if (!name || name.length === 0) {
    throw new StorageError('File name is required', 400)
  }
  let sanitized = name
    .replace(/\.\./g, '')
    .replace(/^\/+/, '')
    .replace(/[/\\]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32)
    .join('')

  if (sanitized.length > 255) sanitized = sanitized.slice(0, 255)
  if (sanitized.length === 0 || sanitized === '.' || sanitized === '..') {
    throw new StorageError('Invalid file name after sanitization', 400)
  }
  return sanitized
}

export class StorageError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message)
    this.name = 'StorageError'
  }
}

const storageAppDef = new Elysia()
  .post('/upload', () => ({ cid: '' }))
  .get('/health', () => ({ status: 'ok' as const }))

type StorageApp = typeof storageAppDef

class IPFSStorageService implements StorageService {
  private client: ReturnType<typeof treaty<StorageApp>>
  private storageUrl: string
  private gatewayUrl: string
  private healthLastChecked = 0
  private healthy = false

  constructor() {
    this.storageUrl = STORAGE_ENDPOINT.replace(/\/$/, '')
    this.gatewayUrl = IPFS_GATEWAY.replace(/\/$/, '')
    this.client = treaty<StorageApp>(this.storageUrl, {
      fetch: { signal: AbortSignal.timeout(STORAGE_TIMEOUT) },
    })
  }

  async upload(
    data: Uint8Array,
    name: string,
    owner: Address,
  ): Promise<string> {
    const safeName = sanitizeFileName(name)

    const formData = new FormData()
    const blob = new Blob([new Uint8Array(data)])
    formData.append('file', blob, safeName)
    formData.append('tier', 'hot')

    const response = await fetch(`${this.storageUrl}/upload`, {
      method: 'POST',
      headers: { 'x-jeju-address': owner },
      body: formData,
      signal: AbortSignal.timeout(STORAGE_TIMEOUT),
    })

    if (!response.ok) {
      throw new StorageError(
        `IPFS upload failed: ${response.status} ${response.statusText}`,
        response.status,
      )
    }

    const result = await parseJsonResponse(
      response,
      cidResponseSchema,
      'IPFS upload response',
    )
    return result.cid
  }

  async retrieve(cid: string): Promise<Uint8Array> {
    const validatedCid = validateCID(cid)

    const response = await fetch(`${this.gatewayUrl}/ipfs/${validatedCid}`, {
      signal: AbortSignal.timeout(STORAGE_TIMEOUT),
    })

    if (!response.ok) {
      throw new StorageError(
        `IPFS retrieve failed: ${response.status} ${response.statusText}`,
        response.status,
      )
    }

    return new Uint8Array(await response.arrayBuffer())
  }

  getUrl(cid: string): string {
    const validatedCid = validateCID(cid)
    return `${this.gatewayUrl}/ipfs/${validatedCid}`
  }

  async isHealthy(): Promise<boolean> {
    if (Date.now() - this.healthLastChecked < 30000) {
      return this.healthy
    }

    const { error } = await this.client.health.get()
    this.healthy = !error
    this.healthLastChecked = Date.now()
    return this.healthy
  }
}

let storageService: StorageService | null = null

export function getStorageService(): StorageService {
  if (!storageService) {
    storageService = new IPFSStorageService()
  }
  return storageService
}

export function resetStorageService(): void {
  storageService = null
}
