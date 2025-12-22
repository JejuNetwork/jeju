/**
 * Storage Service for IPFS attachments
 *
 * Provides decentralized file storage using the Storage Marketplace.
 * No fallbacks - requires IPFS storage to be available.
 */

import type { Address } from 'viem'

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

// Validate IPFS CID format
// CIDv0: starts with Qm, base58btc, 46 chars
// CIDv1: starts with b (base32), z (base58btc), etc.
const CID_PATTERN =
  /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,}|z[1-9A-HJ-NP-Za-km-z]+|f[a-f0-9]+)$/

const validateCID = (cid: string): string => {
  if (!cid || cid.length === 0) {
    throw new Error('CID is required')
  }

  // Check for path traversal attempts
  if (cid.includes('/') || cid.includes('\\') || cid.includes('..')) {
    throw new Error('Invalid CID: contains path characters')
  }

  // Validate CID format (loose check for various CID formats)
  if (!CID_PATTERN.test(cid)) {
    throw new Error(`Invalid CID format: ${cid}`)
  }

  return cid
}

// Sanitize file names to prevent path traversal attacks
const sanitizeFileName = (name: string): string => {
  if (!name || name.length === 0) {
    throw new Error('File name is required')
  }

  // Remove any directory components (path traversal prevention)
  let sanitized = name
    .replace(/\.\./g, '') // Remove ..
    .replace(/^\/+/, '') // Remove leading slashes
    .replace(/[/\\]/g, '_') // Replace path separators with underscores
    .replace(/[<>:"|?*]/g, '_') // Remove invalid characters
    .split('')
    .filter((c) => c.charCodeAt(0) >= 32)
    .join('') // Remove control characters

  // Limit length
  if (sanitized.length > 255) {
    sanitized = sanitized.slice(0, 255)
  }

  // Ensure we have a valid name
  if (sanitized.length === 0 || sanitized === '.' || sanitized === '..') {
    throw new Error('Invalid file name after sanitization')
  }

  return sanitized
}

class IPFSStorageService implements StorageService {
  private healthLastChecked = 0
  private healthy = false

  async upload(
    data: Uint8Array,
    name: string,
    owner: Address,
  ): Promise<string> {
    // Sanitize the file name to prevent path traversal
    const safeName = sanitizeFileName(name)

    const formData = new FormData()
    formData.append('file', new Blob([data]), safeName)
    formData.append('tier', 'hot')

    const response = await fetch(`${STORAGE_ENDPOINT}/upload`, {
      method: 'POST',
      headers: { 'x-jeju-address': owner },
      body: formData,
      signal: AbortSignal.timeout(STORAGE_TIMEOUT),
    })

    if (!response.ok) {
      throw new Error(
        `IPFS upload failed: ${response.status} ${response.statusText}`,
      )
    }

    const result = (await response.json()) as { cid: string }
    return result.cid
  }

  async retrieve(cid: string): Promise<Uint8Array> {
    // Validate CID before using in URL
    const validatedCid = validateCID(cid)

    const response = await fetch(`${IPFS_GATEWAY}/ipfs/${validatedCid}`, {
      signal: AbortSignal.timeout(STORAGE_TIMEOUT),
    })

    if (!response.ok) {
      throw new Error(
        `IPFS retrieve failed: ${response.status} ${response.statusText}`,
      )
    }

    return new Uint8Array(await response.arrayBuffer())
  }

  getUrl(cid: string): string {
    // Validate CID before using in URL
    const validatedCid = validateCID(cid)
    return `${IPFS_GATEWAY}/ipfs/${validatedCid}`
  }

  async isHealthy(): Promise<boolean> {
    // Cache the health check result for 30 seconds
    if (Date.now() - this.healthLastChecked < 30000) {
      return this.healthy
    }

    try {
      const response = await fetch(`${STORAGE_ENDPOINT}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      this.healthy = response.ok
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.debug(`[Storage] Health check failed: ${errorMsg}`)
      this.healthy = false
    }

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
