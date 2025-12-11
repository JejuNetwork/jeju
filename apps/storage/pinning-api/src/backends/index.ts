/**
 * Storage Backends
 * 
 * Interface for all storage backends:
 * - IPFS (decentralized)
 * - Cloud (Vercel, S3, R2)
 * - Arweave (permanent)
 */

export * from './cloud';

import { createHash } from 'crypto';
import {
  CloudStorageBackend,
  VercelBlobBackend,
  S3Backend,
  R2Backend,
  createCloudBackendFromEnv,
  generateCloudCID,
} from './cloud';

// ============================================================================
// Storage Backend Interface
// ============================================================================

export interface StorageUploadOptions {
  filename: string;
  tier?: 'hot' | 'warm' | 'cold' | 'permanent';
  replication?: number;
}

export interface StorageUploadResult {
  cid: string;
  url: string;
  size: number;
  backend: 'ipfs' | 'cloud' | 'arweave' | 'local';
  provider?: string;
}

export interface StorageBackend {
  name: string;
  type: 'ipfs' | 'cloud' | 'arweave' | 'local';
  upload(content: Buffer, options: StorageUploadOptions): Promise<StorageUploadResult>;
  download(cid: string): Promise<Buffer>;
  exists(cid: string): Promise<boolean>;
  delete(cid: string): Promise<void>;
  getUrl(cid: string): string;
  isAvailable(): Promise<boolean>;
}

// ============================================================================
// IPFS Backend
// ============================================================================

export class IPFSBackend implements StorageBackend {
  name = 'ipfs';
  type = 'ipfs' as const;
  private apiUrl: string;
  private gatewayUrl: string;

  constructor(apiUrl: string, gatewayUrl?: string) {
    this.apiUrl = apiUrl;
    this.gatewayUrl = gatewayUrl || apiUrl.replace(':5001', ':8080');
  }

  async upload(content: Buffer, options: StorageUploadOptions): Promise<StorageUploadResult> {
    const formData = new FormData();
    formData.append('file', new Blob([content]), options.filename);

    const response = await fetch(`${this.apiUrl}/api/v0/add?pin=true`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`IPFS upload failed: ${response.statusText}`);
    }

    const result = await response.json() as { Hash: string; Size: string };

    return {
      cid: result.Hash,
      url: `${this.gatewayUrl}/ipfs/${result.Hash}`,
      size: parseInt(result.Size),
      backend: 'ipfs',
    };
  }

  async download(cid: string): Promise<Buffer> {
    const response = await fetch(`${this.gatewayUrl}/ipfs/${cid}`);
    if (!response.ok) {
      throw new Error(`IPFS download failed: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async exists(cid: string): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}/api/v0/pin/ls?arg=${cid}&type=all`, {
      method: 'POST',
    });
    return response.ok;
  }

  async delete(cid: string): Promise<void> {
    await fetch(`${this.apiUrl}/api/v0/pin/rm?arg=${cid}`, { method: 'POST' });
  }

  getUrl(cid: string): string {
    return `${this.gatewayUrl}/ipfs/${cid}`;
  }

  async isAvailable(): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}/api/v0/id`, { method: 'POST' }).catch(() => null);
    return response?.ok ?? false;
  }
}

// ============================================================================
// Cloud Backend Adapter
// ============================================================================

export class CloudBackendAdapter implements StorageBackend {
  name: string;
  type = 'cloud' as const;
  private backend: CloudStorageBackend;

  constructor(backend: CloudStorageBackend) {
    this.backend = backend;
    this.name = `cloud-${backend.type}`;
  }

  async upload(content: Buffer, options: StorageUploadOptions): Promise<StorageUploadResult> {
    const result = await this.backend.upload(content, options.filename);
    return {
      cid: result.cid,
      url: result.url,
      size: result.size,
      backend: 'cloud',
      provider: result.provider,
    };
  }

  async download(cid: string): Promise<Buffer> {
    return this.backend.download(cid);
  }

  async exists(cid: string): Promise<boolean> {
    return this.backend.exists(cid);
  }

  async delete(cid: string): Promise<void> {
    return this.backend.delete(cid);
  }

  getUrl(cid: string): string {
    return this.backend.getUrl(cid);
  }

  async isAvailable(): Promise<boolean> {
    // Cloud backends are always available if configured
    return true;
  }
}

// ============================================================================
// Local Backend (In-Memory / Disk)
// ============================================================================

export class LocalBackend implements StorageBackend {
  name = 'local';
  type = 'local' as const;
  private storage: Map<string, { content: Buffer; filename: string; createdAt: Date }> = new Map();
  private storagePath?: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath;
  }

  async upload(content: Buffer, options: StorageUploadOptions): Promise<StorageUploadResult> {
    const hash = createHash('sha256').update(content).digest('hex');
    const cid = `local-${hash.slice(0, 32)}`;

    this.storage.set(cid, {
      content,
      filename: options.filename,
      createdAt: new Date(),
    });

    // Optionally write to disk
    if (this.storagePath) {
      const fs = await import('fs/promises');
      const path = await import('path');
      const filePath = path.join(this.storagePath, cid);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content);
    }

    return {
      cid,
      url: `/local/${cid}`,
      size: content.length,
      backend: 'local',
    };
  }

  async download(cid: string): Promise<Buffer> {
    const item = this.storage.get(cid);
    if (item) return item.content;

    if (this.storagePath) {
      const fs = await import('fs/promises');
      const path = await import('path');
      const filePath = path.join(this.storagePath, cid);
      return fs.readFile(filePath);
    }

    throw new Error(`Content not found: ${cid}`);
  }

  async exists(cid: string): Promise<boolean> {
    if (this.storage.has(cid)) return true;

    if (this.storagePath) {
      const fs = await import('fs/promises');
      const path = await import('path');
      const filePath = path.join(this.storagePath, cid);
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      return exists;
    }

    return false;
  }

  async delete(cid: string): Promise<void> {
    this.storage.delete(cid);

    if (this.storagePath) {
      const fs = await import('fs/promises');
      const path = await import('path');
      const filePath = path.join(this.storagePath, cid);
      await fs.unlink(filePath).catch((e: NodeJS.ErrnoException) => {
        // Ignore "file not found" - it may not have been persisted to disk
        if (e.code !== 'ENOENT') throw e;
      });
    }
  }

  getUrl(cid: string): string {
    return `/local/${cid}`;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getStats(): { count: number; totalSize: number } {
    let totalSize = 0;
    for (const item of this.storage.values()) {
      totalSize += item.content.length;
    }
    return { count: this.storage.size, totalSize };
  }
}

// ============================================================================
// Arweave Backend
// ============================================================================

export class ArweaveBackend implements StorageBackend {
  name = 'arweave';
  type = 'arweave' as const;
  private apiUrl: string;
  private wallet?: unknown;

  constructor(apiUrl: string = 'https://arweave.net', wallet?: unknown) {
    this.apiUrl = apiUrl;
    this.wallet = wallet;
  }

  async upload(content: Buffer, options: StorageUploadOptions): Promise<StorageUploadResult> {
    // Arweave requires bundlr or direct transaction
    const response = await fetch(`${this.apiUrl}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': options.filename,
      },
      body: content,
    });

    if (!response.ok) {
      throw new Error(`Arweave upload failed: ${response.statusText}`);
    }

    const result = await response.json() as { id: string };

    return {
      cid: result.id,
      url: `${this.apiUrl}/${result.id}`,
      size: content.length,
      backend: 'arweave',
    };
  }

  async download(cid: string): Promise<Buffer> {
    const response = await fetch(`${this.apiUrl}/${cid}`);
    if (!response.ok) {
      throw new Error(`Arweave download failed: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async exists(cid: string): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}/${cid}`, { method: 'HEAD' });
    return response.ok;
  }

  async delete(_cid: string): Promise<void> {
    throw new Error('Arweave storage is permanent and cannot be deleted');
  }

  getUrl(cid: string): string {
    return `${this.apiUrl}/${cid}`;
  }

  async isAvailable(): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}/info`).catch(() => null);
    return response?.ok ?? false;
  }
}

// ============================================================================
// Backend Manager
// ============================================================================

export class BackendManager {
  private backends: Map<string, StorageBackend> = new Map();
  private primaryBackend: StorageBackend;
  private fallbackBackend: StorageBackend;

  constructor() {
    // Always have local as fallback
    this.fallbackBackend = new LocalBackend();
    this.primaryBackend = this.fallbackBackend;
  }

  /**
   * Add a backend
   */
  addBackend(backend: StorageBackend): void {
    this.backends.set(backend.name, backend);
  }

  /**
   * Set primary backend
   */
  setPrimary(name: string): void {
    const backend = this.backends.get(name);
    if (backend) {
      this.primaryBackend = backend;
    }
  }

  /**
   * Get backend by name
   */
  getBackend(name: string): StorageBackend | undefined {
    return this.backends.get(name);
  }

  /**
   * Upload to primary backend with fallback
   */
  async upload(content: Buffer, options: StorageUploadOptions): Promise<StorageUploadResult> {
    // Try primary
    if (await this.primaryBackend.isAvailable()) {
      return this.primaryBackend.upload(content, options);
    }

    // Try other cloud backends
    for (const backend of this.backends.values()) {
      if (backend.type === 'cloud' && await backend.isAvailable()) {
        return backend.upload(content, options);
      }
    }

    // Fall back to local
    return this.fallbackBackend.upload(content, options);
  }

  /**
   * Download from any backend that has the content
   */
  async download(cid: string): Promise<{ content: Buffer; backend: string }> {
    // Determine backend from CID prefix
    if (cid.startsWith('Qm') || cid.startsWith('bafy')) {
      const ipfs = Array.from(this.backends.values()).find(b => b.type === 'ipfs');
      if (ipfs) {
        return { content: await ipfs.download(cid), backend: 'ipfs' };
      }
    }

    if (cid.startsWith('cloud-')) {
      for (const backend of this.backends.values()) {
        if (backend.type === 'cloud' && await backend.exists(cid)) {
          return { content: await backend.download(cid), backend: backend.name };
        }
      }
    }

    if (cid.startsWith('local-')) {
      return { content: await this.fallbackBackend.download(cid), backend: 'local' };
    }

    // Try all backends
    for (const backend of this.backends.values()) {
      if (await backend.exists(cid)) {
        return { content: await backend.download(cid), backend: backend.name };
      }
    }

    // Try local
    if (await this.fallbackBackend.exists(cid)) {
      return { content: await this.fallbackBackend.download(cid), backend: 'local' };
    }

    throw new Error(`Content not found: ${cid}`);
  }

  /**
   * List all backends
   */
  listBackends(): Array<{ name: string; type: string; primary: boolean }> {
    return Array.from(this.backends.entries()).map(([name, backend]) => ({
      name,
      type: backend.type,
      primary: backend === this.primaryBackend,
    }));
  }

  /**
   * Check health of all backends
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};
    for (const [name, backend] of this.backends) {
      health[name] = await backend.isAvailable();
    }
    health['local'] = await this.fallbackBackend.isAvailable();
    return health;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create backend manager with auto-detected backends
 */
export function createBackendManager(): BackendManager {
  const manager = new BackendManager();

  // Add IPFS if configured
  const ipfsUrl = process.env.IPFS_API_URL;
  if (ipfsUrl) {
    const ipfs = new IPFSBackend(ipfsUrl, process.env.IPFS_GATEWAY_URL);
    manager.addBackend(ipfs);
    manager.setPrimary('ipfs');
  }

  // Add cloud backend if configured
  const cloudBackend = createCloudBackendFromEnv();
  if (cloudBackend) {
    manager.addBackend(new CloudBackendAdapter(cloudBackend));
    if (!ipfsUrl) {
      manager.setPrimary(`cloud-${cloudBackend.type}`);
    }
  }

  // Add Arweave if configured
  if (process.env.ARWEAVE_API_URL) {
    manager.addBackend(new ArweaveBackend(process.env.ARWEAVE_API_URL));
  }

  return manager;
}

