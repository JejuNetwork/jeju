/**
 * IPFS Client for Bazaar
 * Re-exports from @jejunetwork/shared with bazaar-specific config
 */

import {
  createIPFSClient,
  cidToBytes32,
  type IPFSClient,
} from '@jejunetwork/shared'
import { IPFS_API_URL, IPFS_GATEWAY_URL } from '../config'

// Create singleton client with bazaar config
const ipfsClient = createIPFSClient({
  apiUrl: IPFS_API_URL,
  gatewayUrl: IPFS_GATEWAY_URL,
})

export async function uploadToIPFS(file: File): Promise<string> {
  return ipfsClient.upload(file, { durationMonths: 1 })
}

export async function uploadJSONToIPFS(data: Record<string, unknown>): Promise<string> {
  return ipfsClient.uploadJSON(data, 'evidence.json')
}

export function getIPFSUrl(hash: string): string {
  return ipfsClient.getUrl(hash)
}

// Re-export cidToBytes32 from shared
export { cidToBytes32 }

// Export client for direct access
export { ipfsClient }
