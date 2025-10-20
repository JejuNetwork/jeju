/**
 * Jeju IPFS Client
 * Uses LOCAL Jeju IPFS infrastructure (no Pinata/external services)
 */

const JEJU_IPFS_API = process.env.NEXT_PUBLIC_JEJU_IPFS_API || 'http://localhost:3100';
const JEJU_IPFS_GATEWAY = process.env.NEXT_PUBLIC_JEJU_IPFS_GATEWAY || 'http://localhost:3100';

// Fallback to Pinata for development if local node not available
const PINATA_JWT = process.env.NEXT_PUBLIC_PINATA_JWT;

/**
 * Upload file to Jeju IPFS (local nodes, x402 payments)
 * @returns Real IPFS CID hash
 */
export async function uploadToIPFS(file: File): Promise<string> {
  // Try local Jeju IPFS first
  try {
    const formData = new FormData();
    formData.append('file', file);
    
    // Set duration (default 1 month)
    const durationMonths = 1;
    
    const response = await fetch(`${JEJU_IPFS_API}/upload`, {
      method: 'POST',
      headers: {
        'X-Duration-Months': durationMonths.toString(),
        // x402 payment header would be added by client SDK
      },
      body: formData,
    });

    if (response.status === 402) {
      // Payment required
      const paymentDetails = await response.json();
      console.log('Payment required:', paymentDetails);
      
      // In development, proceed anyway (server should allow)
      // In production, client would pay via x402 and retry
      if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️  Development mode: Proceeding without payment');
        // Retry without payment header (dev server allows this)
        const retryResponse = await fetch(`${JEJU_IPFS_API}/upload`, {
          method: 'POST',
          body: formData,
        });
        
        if (retryResponse.ok) {
          const { cid } = await retryResponse.json();
          console.log(`✅ Uploaded to Jeju IPFS: ${cid}`);
          return cid;
        }
      }
      
      throw new Error('Payment required - configure x402 wallet');
    }

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const { cid } = await response.json();
    console.log(`✅ Uploaded to Jeju IPFS (local): ${cid}`);
    return cid; // REAL IPFS CID from our nodes
    
  } catch (error) {
    console.warn('Local IPFS not available, trying fallback...', error);
    
    // Fallback to Pinata if local IPFS is down (development only)
    if (PINATA_JWT && process.env.NODE_ENV === 'development') {
      return uploadToPinataFallback(file);
    }
    
    throw error;
  }
}

/**
 * Fallback to Pinata (development only)
 */
async function uploadToPinataFallback(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Pinata fallback failed: ${response.statusText}`);
  }

  const { IpfsHash } = await response.json();
  console.log(`✅ Uploaded to IPFS (Pinata fallback): ${IpfsHash}`);
  return IpfsHash;
}

/**
 * Get IPFS gateway URL for viewing
 */
export function getIPFSUrl(hash: string): string {
  return `${JEJU_IPFS_GATEWAY}/ipfs/${hash}`;
}

/**
 * Retrieve file from IPFS
 */
export async function retrieveFromIPFS(hash: string): Promise<Blob> {
  const response = await fetch(getIPFSUrl(hash));
  
  if (!response.ok) {
    throw new Error(`Failed to retrieve from IPFS: ${hash}`);
  }
  
  return await response.blob();
}

/**
 * Check if file exists in IPFS
 */
export async function fileExists(cid: string): Promise<boolean> {
  try {
    const response = await fetch(`${JEJU_IPFS_API}/pins?cid=${cid}`);
    const { count } = await response.json();
    return count > 0;
  } catch {
    return false;
  }
}

