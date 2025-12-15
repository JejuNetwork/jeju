/**
 * Storage Service for IPFS attachments
 * 
 * Provides decentralized file storage using the Storage Marketplace.
 * Falls back to local storage when IPFS is unavailable.
 */

import type { Address } from 'viem';

const STORAGE_ENDPOINT = process.env.STORAGE_API_ENDPOINT || 'http://localhost:4010';
const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'http://localhost:4180';

interface StorageService {
  upload(data: Uint8Array, name: string, owner: Address): Promise<string>;
  retrieve(cid: string): Promise<Uint8Array>;
  getUrl(cid: string): string;
  isHealthy(): Promise<boolean>;
}

class IPFSStorageService implements StorageService {
  private storageAvailable = true;
  private localFallback = new Map<string, Uint8Array>();

  async upload(data: Uint8Array, name: string, owner: Address): Promise<string> {
    if (this.storageAvailable) {
      const cid = await this.ipfsUpload(data, name, owner);
      if (cid) return cid;
    }

    // Fallback to local storage with fake CID
    const localCid = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.localFallback.set(localCid, data);
    return localCid;
  }

  async retrieve(cid: string): Promise<Uint8Array> {
    // Handle local fallback
    if (cid.startsWith('local-')) {
      const data = this.localFallback.get(cid);
      if (!data) throw new Error('File not found in local storage');
      return data;
    }

    if (this.storageAvailable) {
      const data = await this.ipfsRetrieve(cid);
      if (data) return data;
    }

    throw new Error('Unable to retrieve file');
  }

  getUrl(cid: string): string {
    if (cid.startsWith('local-')) {
      return `local://${cid}`;
    }
    return `${IPFS_GATEWAY}/ipfs/${cid}`;
  }

  async isHealthy(): Promise<boolean> {
    if (!this.storageAvailable) {
      this.storageAvailable = await this.checkStorageHealth();
    }
    return this.storageAvailable;
  }

  private async ipfsUpload(data: Uint8Array, name: string, owner: Address): Promise<string | null> {
    const formData = new FormData();
    formData.append('file', new Blob([data]), name);
    formData.append('tier', 'hot');

    const response = await fetch(`${STORAGE_ENDPOINT}/upload`, {
      method: 'POST',
      headers: { 'x-jeju-address': owner },
      body: formData,
      signal: AbortSignal.timeout(30000),
    }).catch(() => {
      this.storageAvailable = false;
      return null;
    });

    if (!response || !response.ok) return null;

    const result = await response.json() as { cid: string };
    return result.cid;
  }

  private async ipfsRetrieve(cid: string): Promise<Uint8Array | null> {
    const response = await fetch(`${IPFS_GATEWAY}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);

    if (!response || !response.ok) return null;

    return new Uint8Array(await response.arrayBuffer());
  }

  private async checkStorageHealth(): Promise<boolean> {
    const response = await fetch(`${STORAGE_ENDPOINT}/health`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => null);
    
    return response?.ok ?? false;
  }
}

let storageService: StorageService | null = null;

export function getStorageService(): StorageService {
  if (!storageService) {
    storageService = new IPFSStorageService();
  }
  return storageService;
}
