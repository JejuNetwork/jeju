import { IPFS_API_URL, IPFS_GATEWAY_URL } from './config'

interface IPFSUploadResponse {
  cid?: string
  Hash?: string
}

interface IPFSPinsResponse {
  count?: number
}

export async function uploadToIPFS(file: File | Blob): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(`${IPFS_API_URL}/upload`, {
    method: 'POST',
    headers: {
      'X-Duration-Months': '1',
    },
    body: formData,
  })

  if (response.status === 402) {
    throw new Error('Payment required - configure x402 wallet')
  }

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`)
  }

  const result: IPFSUploadResponse = await response.json()
  return result.cid ?? result.Hash ?? ''
}

export function getIPFSUrl(hash: string): string {
  if (!hash || hash === `0x${'0'.repeat(64)}`) return ''
  const baseUrl = IPFS_GATEWAY_URL.replace(/\/$/, '')
  return `${baseUrl}/ipfs/${hash}`
}

export async function retrieveFromIPFS(hash: string): Promise<Blob> {
  const url = getIPFSUrl(hash)
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to retrieve from IPFS: ${hash}`)
  }

  return response.blob()
}

/**
 * Check if a CID exists/is pinned
 */
export async function fileExists(cid: string): Promise<boolean> {
  const response = await fetch(`${IPFS_API_URL}/pins?cid=${cid}`)
  if (!response.ok) return false
  const data: IPFSPinsResponse = await response.json()
  return (data.count ?? 0) > 0
}

/**
 * Convert CID to bytes32 for contract calls
 */
const ZERO_BYTES32: `0x${string}` = `0x${'0'.repeat(64)}`

export function cidToBytes32(cid: string): `0x${string}` {
  if (!cid) return ZERO_BYTES32
  // Use TextEncoder for browser compatibility
  const encoder = new TextEncoder()
  const bytes = encoder.encode(cid)
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .padStart(64, '0')
    .slice(0, 64)
  return `0x${hex}`
}

// IPFS client singleton
export const ipfsClient = {
  upload: uploadToIPFS,
  retrieve: retrieveFromIPFS,
  getUrl: getIPFSUrl,
  exists: fileExists,
  cidToBytes32,
}
