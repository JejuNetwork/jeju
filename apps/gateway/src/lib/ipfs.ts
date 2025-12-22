/**
 * IPFS Client for Gateway
 * Re-exports from @jejunetwork/shared with gateway-specific config
 */

import { createIPFSClient } from '@jejunetwork/shared'
import { IPFS_API_URL, IPFS_GATEWAY_URL } from '../config'

// Create singleton client with gateway config
const ipfsClient = createIPFSClient({
  apiUrl: IPFS_API_URL,
  gatewayUrl: IPFS_GATEWAY_URL,
})

export async function uploadToIPFS(file: File): Promise<string> {
  return ipfsClient.upload(file, { durationMonths: 1 })
}

export function getIPFSUrl(hash: string): string {
  return ipfsClient.getUrl(hash)
}

export async function retrieveFromIPFS(hash: string): Promise<Blob> {
  return ipfsClient.retrieve(hash)
}

export async function fileExists(cid: string): Promise<boolean> {
  return ipfsClient.exists(cid)
}

// Export client for direct access
export { ipfsClient }
