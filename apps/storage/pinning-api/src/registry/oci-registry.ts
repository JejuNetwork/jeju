/**
 * OCI Container Registry - Docker V2 API backed by IPFS/Arweave with x402 payments.
 * @see https://docs.docker.com/registry/spec/api/
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createHash } from 'crypto';
import type { Context } from 'hono';

export type StorageBackend = 'ipfs' | 'arweave' | 'hybrid';

export interface RegistryConfig {
  /** Storage backend preference */
  storageBackend: StorageBackend;
  /** IPFS API URL */
  ipfsUrl: string;
  /** Arweave gateway URL */
  arweaveUrl: string;
  /** Private key for Arweave uploads */
  privateKey?: string;
  /** x402 payment recipient */
  paymentRecipient: string;
  /** Enable public pulls (read without payment) */
  allowPublicPulls: boolean;
  /** Maximum layer size in bytes */
  maxLayerSize: number;
  /** Maximum manifest size in bytes */
  maxManifestSize: number;
}

export interface Manifest {
  schemaVersion: number;
  mediaType: string;
  config: BlobDescriptor;
  layers: BlobDescriptor[];
  annotations?: Record<string, string>;
}

export interface BlobDescriptor {
  mediaType: string;
  digest: string;
  size: number;
  urls?: string[];
}

export interface RegistryAccount {
  address: string;
  balance: bigint;
  stakedAmount: bigint;
  tier: 'free' | 'basic' | 'pro' | 'unlimited';
  totalPulls: number;
  totalPushes: number;
  totalStorageBytes: bigint;
  createdAt: number;
  lastActivity: number;
}

export interface ImageRecord {
  repository: string;
  tag: string;
  digest: string;
  manifestCid: string;
  layerCids: string[];
  sizeBytes: bigint;
  uploadedBy: string;
  uploadedAt: number;
  pullCount: number;
  storageBackend: StorageBackend;
  verified: boolean;
  expiresAt?: number;
}

interface UploadSession {
  uuid: string;
  repository: string;
  startedAt: number;
  chunks: Array<{ start: number; end: number; cid: string }>;
  totalSize: number;
  account: string;
}

export class OCIRegistry {
  private config: RegistryConfig;
  private uploadSessions: Map<string, UploadSession> = new Map();
  private manifests: Map<string, ImageRecord> = new Map(); // digest -> record
  private blobs: Map<string, { cid: string; size: number; backend: StorageBackend }> = new Map();
  private accounts: Map<string, RegistryAccount> = new Map();
  private repositories: Map<string, Set<string>> = new Map(); // repo -> tags

  constructor(config: Partial<RegistryConfig> = {}) {
    this.config = {
      storageBackend: 'ipfs',
      ipfsUrl: process.env.IPFS_API_URL ?? 'http://localhost:5001',
      arweaveUrl: process.env.ARWEAVE_GATEWAY ?? 'https://arweave.net',
      privateKey: process.env.PRIVATE_KEY,
      paymentRecipient: process.env.REGISTRY_PAYMENT_RECIPIENT ?? '0x0000000000000000000000000000000000000000',
      allowPublicPulls: process.env.REGISTRY_PUBLIC_PULLS === 'true',
      maxLayerSize: 5 * 1024 * 1024 * 1024, // 5GB
      maxManifestSize: 10 * 1024 * 1024, // 10MB
      ...config,
    };
  }

  /**
   * Create Hono router for OCI Registry API
   */
  createRouter(): Hono {
    const app = new Hono();
    app.use('/*', cors());

    app.get('/v2/', (c) => {
      c.header('Docker-Distribution-Api-Version', 'registry/2.0');
      return c.json({});
    });

    app.get('/v2/_catalog', async (c) => {
      const repos = Array.from(this.repositories.keys());
      const n = parseInt(c.req.query('n') ?? '100', 10);
      const last = c.req.query('last');

      let filtered = repos.sort();
      if (last) {
        const idx = filtered.indexOf(last);
        if (idx >= 0) {
          filtered = filtered.slice(idx + 1);
        }
      }
      filtered = filtered.slice(0, n);

      return c.json({ repositories: filtered });
    });

    app.get('/v2/:name{.+}/tags/list', async (c) => {
      const name = c.req.param('name');
      const tags = this.repositories.get(name);

      if (!tags) {
        return c.json({ errors: [{ code: 'NAME_UNKNOWN', message: 'Repository not found' }] }, 404);
      }

      return c.json({ name, tags: Array.from(tags).sort() });
    });

    app.head('/v2/:name{.+}/manifests/:reference', async (c) => {
      return this.handleManifestHead(c);
    });
    app.get('/v2/:name{.+}/manifests/:reference', async (c) => {
      return this.handleManifestGet(c);
    });
    app.put('/v2/:name{.+}/manifests/:reference', async (c) => {
      return this.handleManifestPut(c);
    });
    app.delete('/v2/:name{.+}/manifests/:reference', async (c) => {
      return this.handleManifestDelete(c);
    });

    app.head('/v2/:name{.+}/blobs/:digest', async (c) => {
      return this.handleBlobHead(c);
    });
    app.get('/v2/:name{.+}/blobs/:digest', async (c) => {
      return this.handleBlobGet(c);
    });
    app.delete('/v2/:name{.+}/blobs/:digest', async (c) => {
      return this.handleBlobDelete(c);
    });

    app.post('/v2/:name{.+}/blobs/uploads/', async (c) => {
      return this.handleUploadInit(c);
    });
    app.get('/v2/:name{.+}/blobs/uploads/:uuid', async (c) => {
      return this.handleUploadStatus(c);
    });
    app.patch('/v2/:name{.+}/blobs/uploads/:uuid', async (c) => {
      return this.handleUploadPatch(c);
    });
    app.put('/v2/:name{.+}/blobs/uploads/:uuid', async (c) => {
      return this.handleUploadComplete(c);
    });
    app.delete('/v2/:name{.+}/blobs/uploads/:uuid', async (c) => {
      return this.handleUploadCancel(c);
    });

    app.get('/v2/_registry/accounts/:address', async (c) => {
      const address = c.req.param('address');
      const account = this.accounts.get(address);
      if (!account) {
        return c.json({ error: 'Account not found' }, 404);
      }
      return c.json({
        ...account,
        balance: account.balance.toString(),
        stakedAmount: account.stakedAmount.toString(),
        totalStorageBytes: account.totalStorageBytes.toString(),
      });
    });

    app.post('/v2/_registry/accounts/:address/topup', async (c) => {
      const address = c.req.param('address');
      const body = await c.req.json() as { amount: string; txHash: string };
      
      // Verify payment on-chain (would be implemented with contract call)
      const account = this.getOrCreateAccount(address);
      account.balance += BigInt(body.amount);
      
      return c.json({
        success: true,
        newBalance: account.balance.toString(),
      });
    });

    app.get('/v2/_registry/images/:digest', async (c) => {
      const digest = c.req.param('digest');
      const record = this.manifests.get(digest);
      if (!record) {
        return c.json({ error: 'Image not found' }, 404);
      }
      return c.json({
        ...record,
        sizeBytes: record.sizeBytes.toString(),
      });
    });

    // Health check
    app.get('/v2/_registry/health', async (c) => {
      const ipfsHealthy = await this.checkIPFSHealth();
      return c.json({
        status: ipfsHealthy ? 'healthy' : 'degraded',
        storageBackend: this.config.storageBackend,
        ipfs: ipfsHealthy,
        totalImages: this.manifests.size,
        totalBlobs: this.blobs.size,
        totalRepositories: this.repositories.size,
      });
    });

    return app;
  }

  private async handleManifestHead(c: Context): Promise<Response> {
    const name = c.req.param('name');
    const reference = c.req.param('reference');
    
    const record = this.findManifest(name, reference);
    if (!record) {
      return c.json({ errors: [{ code: 'MANIFEST_UNKNOWN', message: 'Manifest not found' }] }, 404);
    }

    c.header('Docker-Content-Digest', record.digest);
    c.header('Content-Type', 'application/vnd.docker.distribution.manifest.v2+json');
    c.header('Content-Length', record.sizeBytes.toString());

    return c.body(null, 200);
  }

  private async handleManifestGet(c: Context): Promise<Response> {
    const name = c.req.param('name');
    const reference = c.req.param('reference');
    const account = this.getAccountFromRequest(c);

    // Check payment/access
    if (!this.config.allowPublicPulls && !this.hasAccess(account, 'pull')) {
      return c.json({ 
        errors: [{ code: 'DENIED', message: 'Payment required' }],
        x402: this.createPaymentRequirement('pull'),
      }, 402);
    }

    const record = this.findManifest(name, reference);
    if (!record) {
      return c.json({ errors: [{ code: 'MANIFEST_UNKNOWN', message: 'Manifest not found' }] }, 404);
    }

    // Fetch manifest from storage
    const manifest = await this.fetchFromStorage(record.manifestCid, record.storageBackend);
    if (!manifest) {
      return c.json({ errors: [{ code: 'BLOB_UNKNOWN', message: 'Manifest data not found' }] }, 404);
    }

    // Update pull count
    record.pullCount++;
    if (account) {
      const acc = this.accounts.get(account);
      if (acc) acc.totalPulls++;
    }

    c.header('Docker-Content-Digest', record.digest);
    c.header('Content-Type', 'application/vnd.docker.distribution.manifest.v2+json');

    return c.body(manifest, 200);
  }

  private async handleManifestPut(c: Context): Promise<Response> {
    const name = c.req.param('name');
    const reference = c.req.param('reference');
    const account = this.getAccountFromRequest(c);

    if (!account || !this.hasAccess(account, 'push')) {
      return c.json({ 
        errors: [{ code: 'DENIED', message: 'Payment required for push' }],
        x402: this.createPaymentRequirement('push'),
      }, 402);
    }

    const body = await c.req.arrayBuffer();
    if (body.byteLength > this.config.maxManifestSize) {
      return c.json({ errors: [{ code: 'SIZE_INVALID', message: 'Manifest too large' }] }, 400);
    }

    const manifestBytes = new Uint8Array(body);
    const digest = this.computeDigest(manifestBytes);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;

    // Verify all layers exist
    for (const layer of manifest.layers) {
      if (!this.blobs.has(layer.digest)) {
        return c.json({ 
          errors: [{ code: 'BLOB_UNKNOWN', message: `Layer ${layer.digest} not found` }] 
        }, 400);
      }
    }

    // Store manifest
    const cid = await this.uploadToStorage(manifestBytes, this.config.storageBackend);
    
    const record: ImageRecord = {
      repository: name,
      tag: reference,
      digest,
      manifestCid: cid,
      layerCids: manifest.layers.map(l => this.blobs.get(l.digest)?.cid ?? ''),
      sizeBytes: BigInt(body.byteLength),
      uploadedBy: account,
      uploadedAt: Date.now(),
      pullCount: 0,
      storageBackend: this.config.storageBackend,
      verified: false,
    };

    this.manifests.set(digest, record);

    // Update repository tags
    if (!this.repositories.has(name)) {
      this.repositories.set(name, new Set());
    }
    this.repositories.get(name)?.add(reference);

    c.header('Docker-Content-Digest', digest);
    c.header('Location', `/v2/${name}/manifests/${digest}`);

    return c.body(null, 201);
  }

  private async handleManifestDelete(c: Context): Promise<Response> {
    const name = c.req.param('name');
    const reference = c.req.param('reference');
    const account = this.getAccountFromRequest(c);

    const record = this.findManifest(name, reference);
    if (!record) {
      return c.json({ errors: [{ code: 'MANIFEST_UNKNOWN', message: 'Manifest not found' }] }, 404);
    }

    // Only owner can delete
    if (record.uploadedBy !== account) {
      return c.json({ errors: [{ code: 'DENIED', message: 'Not authorized' }] }, 403);
    }

    this.manifests.delete(record.digest);
    this.repositories.get(name)?.delete(reference);

    return c.body(null, 202);
  }

  private async handleBlobHead(c: Context): Promise<Response> {
    const digest = c.req.param('digest');
    const blob = this.blobs.get(digest);

    if (!blob) {
      return c.json({ errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob not found' }] }, 404);
    }

    c.header('Docker-Content-Digest', digest);
    c.header('Content-Length', blob.size.toString());
    c.header('Content-Type', 'application/octet-stream');

    return c.body(null, 200);
  }

  private async handleBlobGet(c: Context): Promise<Response> {
    const digest = c.req.param('digest');
    const account = this.getAccountFromRequest(c);

    if (!this.config.allowPublicPulls && !this.hasAccess(account, 'pull')) {
      return c.json({ 
        errors: [{ code: 'DENIED', message: 'Payment required' }],
        x402: this.createPaymentRequirement('pull'),
      }, 402);
    }

    const blob = this.blobs.get(digest);
    if (!blob) {
      return c.json({ errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob not found' }] }, 404);
    }

    const data = await this.fetchFromStorage(blob.cid, blob.backend);
    if (!data) {
      return c.json({ errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob data not found' }] }, 404);
    }

    c.header('Docker-Content-Digest', digest);
    c.header('Content-Type', 'application/octet-stream');

    return c.body(data, 200);
  }

  private async handleBlobDelete(c: Context): Promise<Response> {
    const digest = c.req.param('digest');
    
    if (!this.blobs.has(digest)) {
      return c.json({ errors: [{ code: 'BLOB_UNKNOWN', message: 'Blob not found' }] }, 404);
    }

    // Check if blob is referenced by any manifest
    for (const [, record] of this.manifests) {
      if (record.layerCids.includes(this.blobs.get(digest)?.cid ?? '')) {
        return c.json({ errors: [{ code: 'DENIED', message: 'Blob still in use' }] }, 400);
      }
    }

    this.blobs.delete(digest);
    return c.body(null, 202);
  }

  private async handleUploadInit(c: Context): Promise<Response> {
    const name = c.req.param('name');
    const account = this.getAccountFromRequest(c);

    if (!account || !this.hasAccess(account, 'push')) {
      return c.json({ 
        errors: [{ code: 'DENIED', message: 'Payment required for push' }],
        x402: this.createPaymentRequirement('push'),
      }, 402);
    }

    const uuid = crypto.randomUUID();
    const session: UploadSession = {
      uuid,
      repository: name,
      startedAt: Date.now(),
      chunks: [],
      totalSize: 0,
      account,
    };

    this.uploadSessions.set(uuid, session);

    // Check for monolithic upload
    const digest = c.req.query('digest');
    if (digest) {
      // Monolithic upload - redirect to PUT
      c.header('Location', `/v2/${name}/blobs/uploads/${uuid}?digest=${digest}`);
      c.header('Docker-Upload-UUID', uuid);
      return c.body(null, 202);
    }

    c.header('Location', `/v2/${name}/blobs/uploads/${uuid}`);
    c.header('Docker-Upload-UUID', uuid);
    c.header('Range', '0-0');

    return c.body(null, 202);
  }

  private async handleUploadStatus(c: Context): Promise<Response> {
    const uuid = c.req.param('uuid');
    const session = this.uploadSessions.get(uuid);

    if (!session) {
      return c.json({ errors: [{ code: 'BLOB_UPLOAD_UNKNOWN', message: 'Upload not found' }] }, 404);
    }

    c.header('Docker-Upload-UUID', uuid);
    c.header('Range', `0-${session.totalSize}`);

    return c.body(null, 204);
  }

  private async handleUploadPatch(c: Context): Promise<Response> {
    const uuid = c.req.param('uuid');
    const session = this.uploadSessions.get(uuid);

    if (!session) {
      return c.json({ errors: [{ code: 'BLOB_UPLOAD_UNKNOWN', message: 'Upload not found' }] }, 404);
    }

    const contentRange = c.req.header('Content-Range');
    const body = await c.req.arrayBuffer();
    const chunk = new Uint8Array(body);

    // Upload chunk to storage
    const cid = await this.uploadToStorage(chunk, this.config.storageBackend);

    let start = session.totalSize;
    let end = start + chunk.length - 1;

    if (contentRange) {
      const match = contentRange.match(/(\d+)-(\d+)/);
      if (match) {
        start = parseInt(match[1], 10);
        end = parseInt(match[2], 10);
      }
    }

    session.chunks.push({ start, end, cid });
    session.totalSize = end + 1;

    c.header('Location', `/v2/${session.repository}/blobs/uploads/${uuid}`);
    c.header('Docker-Upload-UUID', uuid);
    c.header('Range', `0-${session.totalSize}`);

    return c.body(null, 202);
  }

  private async handleUploadComplete(c: Context): Promise<Response> {
    const uuid = c.req.param('uuid');
    const digest = c.req.query('digest');
    const session = this.uploadSessions.get(uuid);

    if (!session) {
      return c.json({ errors: [{ code: 'BLOB_UPLOAD_UNKNOWN', message: 'Upload not found' }] }, 404);
    }

    if (!digest) {
      return c.json({ errors: [{ code: 'DIGEST_INVALID', message: 'Digest required' }] }, 400);
    }

    // Handle final chunk if present
    const body = await c.req.arrayBuffer();
    if (body.byteLength > 0) {
      const chunk = new Uint8Array(body);
      const cid = await this.uploadToStorage(chunk, this.config.storageBackend);
      session.chunks.push({ 
        start: session.totalSize, 
        end: session.totalSize + chunk.length - 1, 
        cid 
      });
      session.totalSize += chunk.length;
    }

    // Combine chunks if needed
    let finalCid: string;
    if (session.chunks.length === 1) {
      finalCid = session.chunks[0].cid;
    } else {
      // Combine chunks into single blob
      finalCid = await this.combineChunks(session.chunks);
    }

    // Verify digest
    const data = await this.fetchFromStorage(finalCid, this.config.storageBackend);
    if (data) {
      const computedDigest = this.computeDigest(new Uint8Array(data));
      if (computedDigest !== digest) {
        return c.json({ errors: [{ code: 'DIGEST_INVALID', message: 'Digest mismatch' }] }, 400);
      }
    }

    // Store blob reference
    this.blobs.set(digest, {
      cid: finalCid,
      size: session.totalSize,
      backend: this.config.storageBackend,
    });

    // Update account stats
    const acc = this.accounts.get(session.account);
    if (acc) {
      acc.totalPushes++;
      acc.totalStorageBytes += BigInt(session.totalSize);
    }

    // Clean up session
    this.uploadSessions.delete(uuid);

    c.header('Docker-Content-Digest', digest);
    c.header('Location', `/v2/${session.repository}/blobs/${digest}`);

    return c.body(null, 201);
  }

  private async handleUploadCancel(c: Context): Promise<Response> {
    const uuid = c.req.param('uuid');
    
    if (!this.uploadSessions.has(uuid)) {
      return c.json({ errors: [{ code: 'BLOB_UPLOAD_UNKNOWN', message: 'Upload not found' }] }, 404);
    }

    this.uploadSessions.delete(uuid);
    return c.body(null, 204);
  }

  private async uploadToStorage(data: Uint8Array, backend: StorageBackend): Promise<string> {
    if (backend === 'ipfs' || backend === 'hybrid') {
      return this.uploadToIPFS(data);
    } else if (backend === 'arweave') {
      return this.uploadToArweave(data);
    }
    throw new Error(`Unknown storage backend: ${backend}`);
  }

  private async uploadToIPFS(data: Uint8Array): Promise<string> {
    const formData = new FormData();
    formData.append('file', new Blob([data]));

    const response = await fetch(`${this.config.ipfsUrl}/api/v0/add`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`IPFS upload failed: ${await response.text()}`);
    }

    const result = await response.json() as { Hash: string };
    return result.Hash;
  }

  private async uploadToArweave(data: Uint8Array): Promise<string> {
    // Use Irys for Arweave uploads
    if (!this.config.privateKey) {
      throw new Error('Private key required for Arweave uploads');
    }

    // Try to use Irys SDK if available
    try {
      const { default: Irys } = await import('@irys/sdk');
      const irys = new Irys({
        url: 'https://devnet.irys.xyz',
        token: 'ethereum',
        key: this.config.privateKey.replace('0x', ''),
      });
      await irys.ready();

      const response = await irys.upload(Buffer.from(data));
      return response.id;
    } catch {
      // Fallback to direct Arweave gateway upload (for development)
      const formData = new FormData();
      formData.append('file', new Blob([data]));

      const response = await fetch(`${this.config.arweaveUrl}/tx`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Arweave upload failed: ${await response.text()}`);
      }

      const result = await response.json() as { id: string };
      return result.id;
    }
  }

  private async fetchFromStorage(cid: string, backend: StorageBackend): Promise<ArrayBuffer | null> {
    const errors: Error[] = [];
    
    if (backend === 'ipfs' || backend === 'hybrid') {
      const response = await fetch(`${this.config.ipfsUrl}/api/v0/cat?arg=${cid}`, {
        method: 'POST',
      }).catch((e: Error) => { errors.push(e); return null; });
      
      if (response?.ok) {
        return response.arrayBuffer();
      }
    }

    if (backend === 'arweave' || backend === 'hybrid') {
      const response = await fetch(`${this.config.arweaveUrl}/${cid}`)
        .catch((e: Error) => { errors.push(e); return null; });
        
      if (response?.ok) {
        return response.arrayBuffer();
      }
    }

    // Log errors for debugging but don't throw (data may not exist yet)
    if (errors.length > 0) {
      console.warn(`[Registry] Storage fetch errors for ${cid}:`, errors.map(e => e.message));
    }
    
    return null;
  }

  private async combineChunks(chunks: Array<{ cid: string }>): Promise<string> {
    const buffers: ArrayBuffer[] = [];
    for (const chunk of chunks) {
      const data = await this.fetchFromStorage(chunk.cid, this.config.storageBackend);
      if (data) {
        buffers.push(data);
      }
    }

    const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      combined.set(new Uint8Array(buffer), offset);
      offset += buffer.byteLength;
    }

    return this.uploadToStorage(combined, this.config.storageBackend);
  }

  private findManifest(repository: string, reference: string): ImageRecord | null {
    // Check if reference is a digest
    if (reference.startsWith('sha256:')) {
      return this.manifests.get(reference) ?? null;
    }

    // Find by tag
    for (const [, record] of this.manifests) {
      if (record.repository === repository && record.tag === reference) {
        return record;
      }
    }

    return null;
  }

  private computeDigest(data: Uint8Array): string {
    const hash = createHash('sha256').update(data).digest('hex');
    return `sha256:${hash}`;
  }

  private getAccountFromRequest(c: Context): string | null {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return null;

    // Parse Bearer token or Basic auth
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7); // Token is the address
    }

    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const [username] = decoded.split(':');
      return username;
    }

    return null;
  }

  private getOrCreateAccount(address: string): RegistryAccount {
    let account = this.accounts.get(address);
    if (!account) {
      account = {
        address,
        balance: 0n,
        stakedAmount: 0n,
        tier: 'free',
        totalPulls: 0,
        totalPushes: 0,
        totalStorageBytes: 0n,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      this.accounts.set(address, account);
    }
    return account;
  }

  private hasAccess(address: string | null, operation: 'push' | 'pull'): boolean {
    if (!address) return false;

    const account = this.accounts.get(address);
    if (!account) return false;

    // Unlimited tier has full access
    if (account.tier === 'unlimited') return true;

    // Check staking
    if (account.stakedAmount > 0n) return true;

    // Check balance for operation
    const cost = operation === 'push' ? 1000000n : 100000n; // Example costs
    return account.balance >= cost;
  }

  private createPaymentRequirement(operation: 'push' | 'pull'): object {
    const amount = operation === 'push' ? '0.001' : '0.0001';
    return {
      x402Version: 1,
      error: 'Payment required',
      accepts: [{
        scheme: 'exact',
        network: 'base-sepolia',
        maxAmountRequired: amount,
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // USDC
        payTo: this.config.paymentRecipient,
        resource: `/v2/_registry/${operation}`,
        description: `Registry ${operation} access`,
      }],
    };
  }

  private async checkIPFSHealth(): Promise<boolean> {
    const response = await fetch(`${this.config.ipfsUrl}/api/v0/id`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    }).catch((e: Error) => {
      console.warn('[Registry] IPFS health check failed:', e.message);
      return null;
    });
    return response?.ok ?? false;
  }
}

export function createOCIRegistry(config?: Partial<RegistryConfig>): OCIRegistry {
  return new OCIRegistry(config);
}

export function createRegistryRouter(config?: Partial<RegistryConfig>): Hono {
  const registry = createOCIRegistry(config);
  return registry.createRouter();
}

