/**
 * IPFS Client for Autocrat
 * Uses @jejunetwork/shared with autocrat-specific config
 */

import { createIPFSClient, type IPFSUploadResult } from '@jejunetwork/shared'

const IPFS_API_URL =
  process.env.PUBLIC_IPFS_API_URL || 'http://localhost:4030/storage/api/v0'
const IPFS_GATEWAY_URL = IPFS_API_URL.replace('/api/v0', '/ipfs')

// Create singleton client with autocrat config
const ipfsClient = createIPFSClient({
  apiUrl: IPFS_API_URL,
  gatewayUrl: IPFS_GATEWAY_URL,
})

/**
 * Upload content to IPFS via DWS storage API
 */
export async function uploadToIPFS(
  content: string | Blob | File,
): Promise<string> {
  if (typeof content === 'string') {
    const blob = new Blob([content], { type: 'application/json' })
    return ipfsClient.upload(blob)
  }
  return ipfsClient.upload(content)
}

/**
 * Upload content to IPFS and return full result with URL
 */
export async function uploadToIPFSWithUrl(
  content: string | Blob | File,
): Promise<IPFSUploadResult> {
  const cid = await uploadToIPFS(content)
  return {
    cid,
    url: ipfsClient.getUrl(cid),
  }
}

/**
 * Upload JSON data to IPFS
 */
export async function uploadJSONToIPFS<T>(data: T): Promise<string> {
  return ipfsClient.uploadJSON(data)
}

// Export client for direct access
export { ipfsClient }
