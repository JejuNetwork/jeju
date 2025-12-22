/**
 * IPFS Client - Simplified interface for IPFS operations
 * Wraps the storage service for common IPFS use cases
 */

export interface IPFSConfig {
  apiUrl: string;
  gatewayUrl: string;
}

export interface IPFSUploadResult {
  cid: string;
  url: string;
  size?: number;
}

/**
 * Get IPFS gateway URL for a CID
 */
export function getIPFSUrl(gatewayUrl: string, cid: string): string {
  if (!cid || cid === '0x' + '0'.repeat(64)) return '';
  // Remove trailing slash from gateway URL
  const baseUrl = gatewayUrl.replace(/\/$/, '');
  return `${baseUrl}/ipfs/${cid}`;
}

/**
 * Convert CID to bytes32 for contract calls
 */
export function cidToBytes32(cid: string): `0x${string}` {
  if (!cid) return `0x${'0'.repeat(64)}` as `0x${string}`;
  // Pad or truncate to 32 bytes
  const hex = Buffer.from(cid).toString('hex').padStart(64, '0').slice(0, 64);
  return `0x${hex}` as `0x${string}`;
}

/**
 * Upload a file to IPFS
 */
export async function uploadToIPFS(
  apiUrl: string,
  file: File | Blob,
  options?: { durationMonths?: number }
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  
  const headers: Record<string, string> = {};
  if (options?.durationMonths) {
    headers['X-Duration-Months'] = options.durationMonths.toString();
  }

  const response = await fetch(`${apiUrl}/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (response.status === 402) {
    throw new Error('Payment required - configure x402 wallet');
  }

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json() as { cid?: string; Hash?: string };
  // Support both DWS style (cid) and IPFS API style (Hash)
  return result.cid ?? result.Hash ?? '';
}

/**
 * Upload JSON data to IPFS
 */
export async function uploadJSONToIPFS<T>(
  apiUrl: string,
  data: T,
  filename = 'data.json'
): Promise<string> {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });
  return uploadToIPFS(apiUrl, file);
}

/**
 * Retrieve content from IPFS as blob
 */
export async function retrieveFromIPFS(gatewayUrl: string, cid: string): Promise<Blob> {
  const url = getIPFSUrl(gatewayUrl, cid);
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to retrieve from IPFS: ${cid}`);
  }
  
  return response.blob();
}

/**
 * Retrieve JSON from IPFS
 */
export async function retrieveJSONFromIPFS<T>(gatewayUrl: string, cid: string): Promise<T> {
  const blob = await retrieveFromIPFS(gatewayUrl, cid);
  const text = await blob.text();
  return JSON.parse(text) as T;
}

/**
 * Check if a CID exists/is pinned
 */
export async function fileExistsOnIPFS(apiUrl: string, cid: string): Promise<boolean> {
  const response = await fetch(`${apiUrl}/pins?cid=${cid}`);
  if (!response.ok) return false;
  const data = await response.json() as { count?: number };
  return (data.count ?? 0) > 0;
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
    retrieve: (cid: string) => 
      retrieveFromIPFS(config.gatewayUrl, cid),
    retrieveJSON: <T>(cid: string) => 
      retrieveJSONFromIPFS<T>(config.gatewayUrl, cid),
    getUrl: (cid: string) => 
      getIPFSUrl(config.gatewayUrl, cid),
    exists: (cid: string) => 
      fileExistsOnIPFS(config.apiUrl, cid),
    cidToBytes32,
  };
}

export type IPFSClient = ReturnType<typeof createIPFSClient>;
