/**
 * Storage Service for IPFS attachments
 * 
 * Provides decentralized file storage using the Storage Marketplace.
 * No fallbacks - requires IPFS storage to be available.
 */

import type { Address } from 'viem';

const STORAGE_ENDPOINT = process.env.STORAGE_API_ENDPOINT || 'http://localhost:4010';
const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'http://localhost:4180';
const STORAGE_TIMEOUT = 30000;

interface StorageService {
  upload(data: Uint8Array, name: string, owner: Address): Promise<string>;
  retrieve(cid: string): Promise<Uint8Array>;
  getUrl(cid: string): string;
  isHealthy(): Promise<boolean>;
}

class IPFSStorageService implements StorageService {
  private healthLastChecked = 0;
  private healthy = false;

  async upload(data: Uint8Array, name: string, owner: Address): Promise<string> {
    const formData = new FormData();
    formData.append('file', new Blob([data]), name);
    formData.append('tier', 'hot');

    const response = await fetch(`${STORAGE_ENDPOINT}/upload`, {
      method: 'POST',
      headers: { 'x-jeju-address': owner },
      body: formData,
      signal: AbortSignal.timeout(STORAGE_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`IPFS upload failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { cid: string };
    return result.cid;
  }

  async retrieve(cid: string): Promise<Uint8Array> {
    const response = await fetch(`${IPFS_GATEWAY}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(STORAGE_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`IPFS retrieve failed: ${response.status} ${response.statusText}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  getUrl(cid: string): string {
    return `${IPFS_GATEWAY}/ipfs/${cid}`;
  }

  async isHealthy(): Promise<boolean> {
    // Cache the health check result for 30 seconds
    if (Date.now() - this.healthLastChecked < 30000) {
      return this.healthy;
    }

    try {
      const response = await fetch(`${STORAGE_ENDPOINT}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      this.healthy = response.ok;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.debug(`[Storage] Health check failed: ${errorMsg}`);
      this.healthy = false;
    }
    
    this.healthLastChecked = Date.now();
    return this.healthy;
  }
}

let storageService: StorageService | null = null;

export function getStorageService(): StorageService {
  if (!storageService) {
    storageService = new IPFSStorageService();
  }
  return storageService;
}
