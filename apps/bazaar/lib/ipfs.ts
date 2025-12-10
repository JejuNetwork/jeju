/**
 * Jeju IPFS Client for Bazaar
 * Uses LOCAL Jeju IPFS infrastructure (no Pinata/external services)
 */
import { IPFS_API_URL, IPFS_GATEWAY_URL } from '../config';

const JEJU_IPFS_API = IPFS_API_URL;
const JEJU_IPFS_GATEWAY = IPFS_GATEWAY_URL;

/**
 * Upload file to Jeju IPFS (local nodes, x402 payments)
 * @returns Real IPFS CID hash
 */
export async function uploadToIPFS(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(`${JEJU_IPFS_API}/upload`, {
    method: 'POST',
    headers: {
      'X-Duration-Months': '1',
    },
    body: formData,
  });

  if (response.status === 402) {
    throw new Error('Payment required - configure x402 wallet');
  }

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  const { cid } = await response.json();
  return cid;
}

/**
 * Upload JSON data to Jeju IPFS
 * @returns Real IPFS CID hash
 */
export async function uploadJSONToIPFS(data: Record<string, unknown>): Promise<string> {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], 'evidence.json', { type: 'application/json' });
  return uploadToIPFS(file);
}

/** Get IPFS gateway URL for viewing */
export function getIPFSUrl(hash: string): string {
  if (!hash || hash === '0x' + '0'.repeat(64)) return '';
  return `${JEJU_IPFS_GATEWAY}/ipfs/${hash}`;
}

/** Convert CID to bytes32 for contract calls */
export function cidToBytes32(cid: string): `0x${string}` {
  if (!cid) return `0x${'0'.repeat(64)}` as `0x${string}`;
  // Pad or truncate to 32 bytes
  const hex = Buffer.from(cid).toString('hex').padStart(64, '0').slice(0, 64);
  return `0x${hex}` as `0x${string}`;
}
