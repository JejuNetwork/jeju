/**
 * IPFS Utilities for Bazaar
 *
 * Shared IPFS helpers for both web and api.
 * For full IPFS client, import from api/ipfs.ts
 */

import { cidToBytes32, createIPFSClient } from '@jejunetwork/shared'

// Config from environment
const IPFS_API_URL = process.env.IPFS_API_URL ?? 'https://ipfs.jeju.gg/api'
const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL ?? 'https://ipfs.jeju.gg'

// Create singleton client
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
  return ipfsClient.uploadJSON(data, 'data.json')
}

export function getIPFSUrl(hash: string): string {
  return ipfsClient.getUrl(hash)
}

export { cidToBytes32 }
export { ipfsClient }
