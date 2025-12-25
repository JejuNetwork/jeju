/**
 * IPFS Utilities for Bazaar
 *
 * Shared IPFS helpers for both web and api.
 * For full IPFS client, import from api/ipfs.ts
 */

import { getIpfsApiUrl, getIpfsUrl } from '@jejunetwork/config'
import { cidToBytes32, createIPFSClient } from '@jejunetwork/shared'

// Create singleton client with config-managed URLs
const ipfsClient = createIPFSClient({
  apiUrl: getIpfsApiUrl(),
  gatewayUrl: getIpfsUrl(),
})

export async function uploadToIPFS(file: File): Promise<string> {
  return ipfsClient.upload(file, { durationMonths: 1 })
}

export async function uploadJSONToIPFS(
  data: Record<string, unknown>,
): Promise<string> {
  return ipfsClient.uploadJSON(data, 'data.json')
}

export function getIPFSUrl(hash: string): string {
  return ipfsClient.getUrl(hash)
}

export { cidToBytes32 }
export { ipfsClient }
