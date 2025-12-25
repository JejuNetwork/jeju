/**
 * IPFS Client - Simplified interface for IPFS operations
 * Wraps the storage service for common IPFS use cases
 */

import { expectValid } from '@jejunetwork/types'
import type { z } from 'zod'
import { IPFSPinCountResponseSchema, IPFSUploadResponseSchema } from './schemas'

export interface IPFSConfig {
  apiUrl: string
  gatewayUrl: string
}

export interface IPFSUploadResult {
  cid: string
  url: string
  size?: number
}

/**
 * Get IPFS gateway URL for a CID
 */
export function getIPFSUrl(gatewayUrl: string, cid: string): string {
  if (!cid || cid === `0x${'0'.repeat(64)}`) return ''
  // Remove trailing slash from gateway URL
  const baseUrl = gatewayUrl.replace(/\/$/, '')
  return `${baseUrl}/ipfs/${cid}`
}

/**
 * Convert CID to bytes32 for contract calls
 */
export function cidToBytes32(cid: string): `0x${string}` {
  if (!cid) return `0x${'0'.repeat(64)}` as `0x${string}`
  // Pad or truncate to 32 bytes
  const hex = Buffer.from(cid).toString('hex').padStart(64, '0').slice(0, 64)
  return `0x${hex}` as `0x${string}`
}

/**
 * Upload a file to IPFS
 */
export async function uploadToIPFS(
  apiUrl: string,
  file: File | Blob,
  options?: { durationMonths?: number },
): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  const headers: Record<string, string> = {}
  if (options?.durationMonths) {
    headers['X-Duration-Months'] = options.durationMonths.toString()
  }

  const response = await fetch(`${apiUrl}/upload`, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (response.status === 402) {
    throw new Error('Payment required - configure x402 wallet')
  }

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`)
  }

  const result = expectValid(
    IPFSUploadResponseSchema,
    await response.json(),
    'IPFS upload response',
  )
  // Support both DWS style (cid) and IPFS API style (Hash)
  const cid = result.cid ?? result.Hash
  if (!cid) {
    throw new Error('IPFS upload response missing CID')
  }
  return cid
}

/**
 * Upload JSON data to IPFS
 */
export async function uploadJSONToIPFS<T>(
  apiUrl: string,
  data: T,
  filename = 'data.json',
): Promise<string> {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const file = new File([blob], filename, { type: 'application/json' })
  return uploadToIPFS(apiUrl, file)
}

/**
 * Retrieve content from IPFS as blob
 */
export async function retrieveFromIPFS(
  gatewayUrl: string,
  cid: string,
): Promise<Blob> {
  const url = getIPFSUrl(gatewayUrl, cid)
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to retrieve from IPFS: ${cid}`)
  }

  return response.blob()
}

/**
 * Retrieve JSON from IPFS with optional schema validation.
 *
 * SECURITY: Always provide a schema when retrieving data from IPFS
 * to prevent insecure deserialization attacks. The schema parameter
 * validates the parsed JSON against a Zod schema.
 *
 * @param gatewayUrl - IPFS gateway URL
 * @param cid - Content identifier to retrieve
 * @param schema - Optional Zod schema for validation (recommended for security)
 * @throws Error if schema validation fails
 */
export async function retrieveJSONFromIPFS<T>(
  gatewayUrl: string,
  cid: string,
  schema?: z.ZodType<T>,
): Promise<T> {
  const blob = await retrieveFromIPFS(gatewayUrl, cid)
  const text = await blob.text()

  // Parse JSON - result is unknown until validated
  const parsed: unknown = JSON.parse(text)

  // If schema provided, validate the parsed data
  if (schema) {
    const result = schema.safeParse(parsed)
    if (!result.success) {
      throw new Error(
        `IPFS data validation failed for CID ${cid}: ${result.error.message}`,
      )
    }
    return result.data
  }

  // Without schema, return as-is but log a warning in development
  // Caller is responsible for type safety
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      `[IPFS] Retrieving JSON from CID ${cid} without schema validation - consider providing a Zod schema for security`,
    )
  }

  return parsed as T
}

/**
 * Check if a CID exists/is pinned
 */
export async function fileExistsOnIPFS(
  apiUrl: string,
  cid: string,
): Promise<boolean> {
  const response = await fetch(`${apiUrl}/pins?cid=${cid}`)
  if (!response.ok) return false
  const data = expectValid(
    IPFSPinCountResponseSchema,
    await response.json(),
    'IPFS pin count response',
  )
  return (data.count ?? 0) > 0
}

/**
 * Create an IPFS client instance
 */
export function createIPFSClient(config: IPFSConfig) {
  return {
    upload: (file: File | Blob, options?: { durationMonths?: number }) =>
      uploadToIPFS(config.apiUrl, file, options),
    uploadJSON: <T>(data: T, filename?: string) =>
      uploadJSONToIPFS(config.apiUrl, data, filename),
    retrieve: (cid: string) => retrieveFromIPFS(config.gatewayUrl, cid),
    /**
     * Retrieve and parse JSON from IPFS.
     * @param cid - Content identifier
     * @param schema - Optional Zod schema for validation (recommended for security)
     */
    retrieveJSON: <T>(cid: string, schema?: z.ZodType<T>) =>
      retrieveJSONFromIPFS<T>(config.gatewayUrl, cid, schema),
    getUrl: (cid: string) => getIPFSUrl(config.gatewayUrl, cid),
    exists: (cid: string) => fileExistsOnIPFS(config.apiUrl, cid),
    cidToBytes32,
  }
}

export type IPFSClient = ReturnType<typeof createIPFSClient>
