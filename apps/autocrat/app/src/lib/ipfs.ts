/**
 * IPFS Upload utility for Autocrat
 * Uses DWS storage API for decentralized file storage
 */

const IPFS_API_URL = process.env.NEXT_PUBLIC_IPFS_API_URL || 'http://localhost:4030/storage/api/v0';

export interface IPFSUploadResult {
  hash: string;
  url: string;
}

/**
 * Upload content to IPFS via DWS storage API
 * Returns the IPFS hash (CID) as a string
 */
export async function uploadToIPFS(content: string | Blob | File): Promise<string> {
  const formData = new FormData();
  
  if (typeof content === 'string') {
    formData.append('file', new Blob([content], { type: 'application/json' }));
  } else {
    formData.append('file', content);
  }

  const response = await fetch(`${IPFS_API_URL}/add`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`IPFS upload failed: ${response.status}`);
  }

  const result = await response.json() as { Hash: string };
  return result.Hash;
}

/**
 * Upload content to IPFS and return full result with URL
 */
export async function uploadToIPFSWithUrl(content: string | Blob | File): Promise<IPFSUploadResult> {
  const hash = await uploadToIPFS(content);
  return {
    hash,
    url: `${IPFS_API_URL.replace('/api/v0', '/ipfs')}/${hash}`,
  };
}

/**
 * Upload JSON data to IPFS
 */
export async function uploadJSONToIPFS<T>(data: T): Promise<string> {
  return uploadToIPFS(JSON.stringify(data));
}
