import { IPFS_API_URL, IPFS_GATEWAY_URL } from '../config';

// IPFS client for both client and server contexts
const getIpfsApi = () => IPFS_API_URL;
const getIpfsGateway = () => IPFS_GATEWAY_URL;

export async function uploadToIPFS(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(`${getIpfsApi()}/upload`, {
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

  const { cid } = await response.json() as { cid: string };
  return cid;
}

export function getIPFSUrl(hash: string): string {
  return `${getIpfsGateway()}/ipfs/${hash}`;
}

export async function retrieveFromIPFS(hash: string): Promise<Blob> {
  const response = await fetch(getIPFSUrl(hash));
  
  if (!response.ok) {
    throw new Error(`Failed to retrieve from IPFS: ${hash}`);
  }
  
  return await response.blob();
}

export async function fileExists(cid: string): Promise<boolean> {
  const response = await fetch(`${getIpfsApi()}/pins?cid=${cid}`);
  const { count } = await response.json() as { count: number };
  return count > 0;
}
