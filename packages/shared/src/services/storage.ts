/**
 * Storage Service - IPFS Integration
 * 
 * Provides decentralized file storage via the Storage Marketplace.
 */

import type { Address } from 'viem';

export type StorageTier = 'hot' | 'warm' | 'cold' | 'permanent';

export interface StorageConfig {
  apiEndpoint?: string;
  gatewayEndpoint?: string;
  defaultTier?: StorageTier;
}

export interface StorageService {
  upload(data: Uint8Array | Blob, name: string, options?: UploadOptions): Promise<UploadResult>;
  uploadJson<T>(data: T, name?: string, options?: UploadOptions): Promise<UploadResult>;
  retrieve(cid: string): Promise<Uint8Array>;
  retrieveJson<T>(cid: string): Promise<T>;
  getUrl(cid: string): string;
  pin(cid: string, options?: PinOptions): Promise<void>;
  unpin(cid: string): Promise<void>;
  isHealthy(): Promise<boolean>;
}

export interface UploadOptions {
  tier?: StorageTier;
  encrypt?: boolean;
  owner?: Address;
}

export interface UploadResult {
  cid: string;
  size: number;
  url: string;
}

export interface PinOptions {
  tier?: StorageTier;
  durationMonths?: number;
}

class StorageServiceImpl implements StorageService {
  private apiEndpoint: string;
  private gatewayEndpoint: string;
  private defaultTier: StorageTier;
  private available = true;
  private localFallback = new Map<string, Uint8Array>();

  constructor(config: StorageConfig) {
    this.apiEndpoint = config.apiEndpoint || process.env.STORAGE_API_ENDPOINT || 'http://localhost:4010';
    this.gatewayEndpoint = config.gatewayEndpoint || process.env.IPFS_GATEWAY || 'http://localhost:4180';
    this.defaultTier = config.defaultTier || 'hot';
  }

  async upload(data: Uint8Array | Blob, name: string, options?: UploadOptions): Promise<UploadResult> {
    const blob = data instanceof Uint8Array ? new Blob([data.buffer]) : data;
    const tier = options?.tier ?? this.defaultTier;

    if (this.available) {
      const cid = await this.remoteUpload(blob, name, tier, options?.owner);
      if (cid) {
        return {
          cid,
          size: blob.size,
          url: this.getUrl(cid),
        };
      }
    }

    // Fallback to local
    const localCid = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    this.localFallback.set(localCid, bytes);
    
    return {
      cid: localCid,
      size: bytes.length,
      url: `local://${localCid}`,
    };
  }

  async uploadJson<T>(data: T, name?: string, options?: UploadOptions): Promise<UploadResult> {
    const json = JSON.stringify(data);
    const bytes = new TextEncoder().encode(json);
    return this.upload(bytes, name ?? 'data.json', options);
  }

  async retrieve(cid: string): Promise<Uint8Array> {
    if (cid.startsWith('local-')) {
      const data = this.localFallback.get(cid);
      if (!data) throw new Error('File not found in local storage');
      return data;
    }

    if (this.available) {
      const data = await this.remoteRetrieve(cid);
      if (data) return data;
    }

    throw new Error('Unable to retrieve file');
  }

  async retrieveJson<T>(cid: string): Promise<T> {
    const data = await this.retrieve(cid);
    const text = new TextDecoder().decode(data);
    return JSON.parse(text) as T;
  }

  getUrl(cid: string): string {
    if (cid.startsWith('local-')) {
      return `local://${cid}`;
    }
    return `${this.gatewayEndpoint}/ipfs/${cid}`;
  }

  async pin(cid: string, options?: PinOptions): Promise<void> {
    if (!this.available) return;

    await fetch(`${this.apiEndpoint}/pins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cid,
        tier: options?.tier ?? this.defaultTier,
        durationMonths: options?.durationMonths ?? 1,
      }),
      signal: AbortSignal.timeout(30000),
    });
  }

  async unpin(cid: string): Promise<void> {
    if (cid.startsWith('local-')) {
      this.localFallback.delete(cid);
      return;
    }

    if (!this.available) return;

    await fetch(`${this.apiEndpoint}/pins/${cid}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10000),
    });
  }

  async isHealthy(): Promise<boolean> {
    if (!this.available) {
      this.available = await this.checkHealth();
    }
    return this.available;
  }

  private async remoteUpload(blob: Blob, name: string, tier: StorageTier, owner?: Address): Promise<string | null> {
    const formData = new FormData();
    formData.append('file', blob, name);
    formData.append('tier', tier);

    const headers: Record<string, string> = {};
    if (owner) headers['x-jeju-address'] = owner;

    const response = await fetch(`${this.apiEndpoint}/upload`, {
      method: 'POST',
      headers,
      body: formData,
      signal: AbortSignal.timeout(60000),
    }).catch(() => {
      this.available = false;
      return null;
    });

    if (!response || !response.ok) return null;
    const data = await response.json() as { cid: string };
    return data.cid;
  }

  private async remoteRetrieve(cid: string): Promise<Uint8Array | null> {
    const response = await fetch(`${this.gatewayEndpoint}/ipfs/${cid}`, {
      signal: AbortSignal.timeout(60000),
    }).catch(() => null);

    if (!response || !response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  }

  private async checkHealth(): Promise<boolean> {
    const response = await fetch(`${this.apiEndpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    return response?.ok ?? false;
  }
}

let instance: StorageService | null = null;

export function createStorageService(config: StorageConfig = {}): StorageService {
  if (!instance) {
    instance = new StorageServiceImpl(config);
  }
  return instance;
}

export function resetStorageService(): void {
  instance = null;
}
