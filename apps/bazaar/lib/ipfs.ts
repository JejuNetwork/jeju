/**
 * IPFS Client for Bazaar
 * Provides bazaar-specific IPFS configuration and helpers
 */

import { cidToBytes32, createIPFSClient } from '@jejunetwork/shared'
import { IPFS_API_URL, IPFS_GATEWAY_URL } from '../config'

// Create singleton client with bazaar config
const ipfsClient = createIPFSClient({
  apiUrl: IPFS_API_URL,
  gatewayUrl: IPFS_GATEWAY_URL,
})

export async function uploadToIPFS(file: File): Promise<string> {
  return ipfsClient.upload(file, { durationMonths: 1 })
}

export async function uploadJSONToIPFS(
  data: Record<string, unknown>,
): Promise<string> {
  return ipfsClient.uploadJSON(data, 'evidence.json')
}

export function getIPFSUrl(hash: string): string {
  return ipfsClient.getUrl(hash)
}

export { cidToBytes32 }

// Export client for direct access
export { ipfsClient }
