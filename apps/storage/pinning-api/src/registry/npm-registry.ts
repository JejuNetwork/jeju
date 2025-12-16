/**
 * NPM Package Registry - NPM V2 API backed by IPFS/Arweave with x402 payments.
 * 
 * Provides decentralized package storage with:
 * - Content-addressed storage (IPFS/Arweave)
 * - On-chain package registry for verification
 * - JNS integration for human-readable package names
 * - x402 payments for premium features
 * - ERC-8004 reputation integration
 * - Cache layer for fast serving
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createHash } from 'crypto';
import type { Context } from 'hono';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type StorageBackend = 'ipfs' | 'arweave' | 'hybrid';

export interface NPMRegistryConfig {
  storageBackend: StorageBackend;
  ipfsUrl: string;
  arweaveUrl: string;
  privateKey?: string;
  paymentRecipient: string;
  allowPublicDownloads: boolean;
  allowFreePublish: boolean;
  maxPackageSize: number;
  upstreamRegistry: string;
  cacheEnabled: boolean;
  cacheTTL: number;
}

export interface PackageVersion {
  name: string;
  version: string;
  description?: string;
  main?: string;
  types?: string;
  repository?: { type: string; url: string };
  author?: string | { name: string; email?: string };
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dist: {
    shasum: string;
    tarball: string;
    integrity?: string;
    fileCount?: number;
    unpackedSize?: number;
  };
  _id: string;
  _nodeVersion?: string;
  _npmVersion?: string;
}

export interface PackageManifest {
  _id: string;
  _rev?: string;
  name: string;
  description?: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, PackageVersion>;
  time: Record<string, string>;
  maintainers: Array<{ name: string; email?: string }>;
  readme?: string;
  readmeFilename?: string;
  license?: string;
  repository?: { type: string; url: string };
  keywords?: string[];
  homepage?: string;
  bugs?: { url: string };
}

export interface PackageRecord {
  name: string;
  scope?: string;
  manifestCid: string;
  latestVersion: string;
  versions: string[];
  owner: string;
  createdAt: number;
  updatedAt: number;
  downloadCount: number;
  storageBackend: StorageBackend;
  verified: boolean;
  reputationScore?: number;
  councilProposalId?: string;
}

export interface PublisherAccount {
  address: string;
  balance: bigint;
  stakedAmount: bigint;
  tier: 'free' | 'basic' | 'pro' | 'unlimited';
  totalDownloads: number;
  totalPublishes: number;
  totalStorageBytes: bigint;
  packages: string[];
  reputationScore: number;
  createdAt: number;
  lastActivity: number;
}

interface TarballRecord {
  packageName: string;
  version: string;
  cid: string;
  size: number;
  shasum: string;
  integrity: string;
  backend: StorageBackend;
  uploadedAt: number;
}

interface CacheEntry {
  data: Buffer | string;
  timestamp: number;
  etag?: string;
}

export class NPMRegistry {
  private config: NPMRegistryConfig;
  private packages: Map<string, PackageRecord> = new Map();
  private manifests: Map<string, PackageManifest> = new Map();
  private tarballs: Map<string, TarballRecord> = new Map(); // `${name}@${version}` -> record
  private accounts: Map<string, PublisherAccount> = new Map();
  private cache: Map<string, CacheEntry> = new Map();

  constructor(config: Partial<NPMRegistryConfig> = {}) {
    this.config = {
      storageBackend: 'hybrid',
      ipfsUrl: process.env.IPFS_API_URL ?? 'http://localhost:5001',
      arweaveUrl: process.env.ARWEAVE_GATEWAY ?? 'https://arweave.net',
      privateKey: process.env.PRIVATE_KEY,
      paymentRecipient: process.env.REGISTRY_PAYMENT_RECIPIENT ?? '0x0000000000000000000000000000000000000000',
      allowPublicDownloads: true,
      allowFreePublish: process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test',
      maxPackageSize: 100 * 1024 * 1024, // 100MB
      upstreamRegistry: 'https://registry.npmjs.org',
      cacheEnabled: true,
      cacheTTL: 300000, // 5 minutes
      ...config,
    };
  }

  createRouter(): Hono {
    const app = new Hono();
    app.use('/*', cors());

    // Registry metadata
    app.get('/', (c) => {
      return c.json({
        db_name: 'jeju-registry',
        doc_count: this.packages.size,
        doc_del_count: 0,
        update_seq: Date.now(),
        purge_seq: 0,
        compact_running: false,
        disk_size: 0,
        instance_start_time: '0',
      });
    });

    // ========================================
    // IMPORTANT: Static routes must come BEFORE parameterized routes
    // Otherwise /:name will match "-" before "/-/..." routes
    // ========================================

    // Search packages (must be before /:name routes)
    app.get('/-/v1/search', async (c) => {
      return this.handleSearch(c);
    });

    // User endpoints (must be before /:name routes)
    app.put('/-/user/:user', async (c) => {
      return this.handleLogin(c);
    });

    app.get('/-/whoami', async (c) => {
      return this.handleWhoami(c);
    });

    // Registry-specific endpoints (must be before /:name routes)
    app.get('/-/registry/packages/:name', async (c) => {
      const name = c.req.param('name');
      const record = this.packages.get(name);
      if (!record) {
        return c.json({ error: 'Package not found' }, 404);
      }
      return c.json({
        ...record,
        totalStorageBytes: record.downloadCount.toString(),
      });
    });

    app.get('/-/registry/accounts/:address', async (c) => {
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

    // Health check (must be before /:name routes)
    app.get('/-/registry/health', async (c) => {
      const ipfsHealthy = await this.checkStorageHealth('ipfs');
      const arweaveHealthy = await this.checkStorageHealth('arweave');
      return c.json({
        status: ipfsHealthy || arweaveHealthy ? 'healthy' : 'degraded',
        storageBackend: this.config.storageBackend,
        ipfs: ipfsHealthy,
        arweave: arweaveHealthy,
        totalPackages: this.packages.size,
        totalVersions: this.tarballs.size,
        cacheEnabled: this.config.cacheEnabled,
        cacheSize: this.cache.size,
      });
    });

    // Sync with upstream (must be before /:name routes)
    app.post('/-/registry/sync/:name', async (c) => {
      const name = c.req.param('name');
      return this.handleSyncFromUpstream(c, name);
    });

    // ========================================
    // Parameterized routes come AFTER static routes
    // ========================================

    // Download tarball (specific route first)
    app.get('/:scope/:name/-/:filename', async (c) => {
      const scope = c.req.param('scope');
      const name = c.req.param('name');
      const filename = c.req.param('filename');
      const fullName = `${scope}/${name}`;
      return this.handleGetTarball(c, fullName, filename);
    });

    app.get('/:name/-/:filename', async (c) => {
      const name = c.req.param('name');
      const filename = c.req.param('filename');
      return this.handleGetTarball(c, name, filename);
    });

    // Unpublish
    app.delete('/:scope/:name/-rev/:rev', async (c) => {
      const scope = c.req.param('scope');
      const name = c.req.param('name');
      const fullName = `${scope}/${name}`;
      return this.handleUnpublish(c, fullName);
    });

    app.delete('/:name/-rev/:rev', async (c) => {
      const name = c.req.param('name');
      return this.handleUnpublish(c, name);
    });

    // Get specific version
    app.get('/:scope/:name/:version', async (c) => {
      const scope = c.req.param('scope');
      const name = c.req.param('name');
      const version = c.req.param('version');
      const fullName = `${scope}/${name}`;
      return this.handleGetVersion(c, fullName, version);
    });

    app.get('/:name/:version', async (c) => {
      const name = c.req.param('name');
      const version = c.req.param('version');
      return this.handleGetVersion(c, name, version);
    });

    // Get package manifest (most general routes last)
    app.get('/:scope/:name', async (c) => {
      const scope = c.req.param('scope');
      const name = c.req.param('name');
      const fullName = scope.startsWith('@') ? `${scope}/${name}` : scope;
      return this.handleGetPackage(c, fullName.startsWith('@') ? fullName : scope);
    });

    app.get('/:name', async (c) => {
      const name = c.req.param('name');
      if (name.startsWith('@')) {
        // Scoped package without the name part yet
        return c.json({ error: 'Invalid package name' }, 400);
      }
      return this.handleGetPackage(c, name);
    });

    // Publish package
    app.put('/:scope/:name', async (c) => {
      const scope = c.req.param('scope');
      const name = c.req.param('name');
      const fullName = `${scope}/${name}`;
      return this.handlePublish(c, fullName);
    });

    app.put('/:name', async (c) => {
      const name = c.req.param('name');
      return this.handlePublish(c, name);
    });

    return app;
  }

  private async handleGetPackage(c: Context, name: string): Promise<Response> {
    // Check cache first
    const cached = this.getFromCache(`pkg:${name}`);
    if (cached) {
      const etag = c.req.header('If-None-Match');
      if (etag && cached.etag === etag) {
        return c.body(null, 304);
      }
      c.header('ETag', cached.etag ?? '');
      return c.json(JSON.parse(cached.data as string));
    }

    // Check local registry
    const record = this.packages.get(name);
    if (record) {
      const manifest = this.manifests.get(name);
      if (manifest) {
        const etag = this.computeEtag(JSON.stringify(manifest));
        this.setCache(`pkg:${name}`, JSON.stringify(manifest), etag);
        c.header('ETag', etag);
        return c.json(manifest);
      }

      // Fetch manifest from storage
      const manifestData = await this.fetchFromStorage(record.manifestCid, record.storageBackend);
      if (manifestData) {
        const manifest = JSON.parse(manifestData.toString()) as PackageManifest;
        this.manifests.set(name, manifest);
        const etag = this.computeEtag(JSON.stringify(manifest));
        this.setCache(`pkg:${name}`, JSON.stringify(manifest), etag);
        c.header('ETag', etag);
        return c.json(manifest);
      }
    }

    // Proxy to upstream if not found locally
    if (this.config.upstreamRegistry) {
      const upstream = await this.fetchFromUpstream(name);
      if (upstream) {
        const etag = this.computeEtag(JSON.stringify(upstream));
        this.setCache(`pkg:${name}`, JSON.stringify(upstream), etag);
        c.header('ETag', etag);
        return c.json(upstream);
      }
    }

    return c.json({ error: 'not_found', reason: 'document not found' }, 404);
  }

  private async handleGetVersion(c: Context, name: string, version: string): Promise<Response> {
    const manifest = this.manifests.get(name);
    if (manifest && manifest.versions[version]) {
      return c.json(manifest.versions[version]);
    }

    // Try upstream
    if (this.config.upstreamRegistry) {
      const upstream = await this.fetchFromUpstream(name);
      if (upstream && upstream.versions[version]) {
        return c.json(upstream.versions[version]);
      }
    }

    return c.json({ error: 'version not found' }, 404);
  }

  private async handleGetTarball(c: Context, name: string, filename: string): Promise<Response> {
    const account = this.getAccountFromRequest(c);

    if (!this.config.allowPublicDownloads && !this.hasAccess(account, 'download')) {
      return c.json({
        error: 'Payment required',
        x402: this.createPaymentRequirement('download'),
      }, 402);
    }

    // Parse version from filename (e.g., "package-1.0.0.tgz")
    const versionMatch = filename.match(/^(.+)-(\d+\.\d+\.\d+(?:-[\w.]+)?)\.tgz$/);
    if (!versionMatch) {
      return c.json({ error: 'Invalid filename' }, 400);
    }

    const version = versionMatch[2];
    const key = `${name}@${version}`;

    // Check local storage
    const tarballRecord = this.tarballs.get(key);
    if (tarballRecord) {
      const data = await this.fetchFromStorage(tarballRecord.cid, tarballRecord.backend);
      if (data) {
        // Update download count
        tarballRecord.uploadedAt = Date.now();
        const packageRecord = this.packages.get(name);
        if (packageRecord) packageRecord.downloadCount++;
        if (account) {
          const acc = this.accounts.get(account);
          if (acc) acc.totalDownloads++;
        }

        c.header('Content-Type', 'application/octet-stream');
        c.header('Content-Length', data.byteLength.toString());
        return c.body(data);
      }
    }

    // Proxy to upstream
    if (this.config.upstreamRegistry) {
      const manifest = await this.fetchFromUpstream(name);
      if (manifest?.versions[version]) {
        const tarballUrl = manifest.versions[version].dist.tarball;
        const response = await fetch(tarballUrl);
        if (response.ok) {
          const data = await response.arrayBuffer();
          c.header('Content-Type', 'application/octet-stream');
          c.header('Content-Length', data.byteLength.toString());
          return c.body(data);
        }
      }
    }

    return c.json({ error: 'tarball not found' }, 404);
  }

  private async handlePublish(c: Context, name: string): Promise<Response> {
    const account = this.getAccountFromRequest(c);

    if (!account || !this.hasAccess(account, 'publish')) {
      return c.json({
        error: 'Payment required for publishing',
        x402: this.createPaymentRequirement('publish'),
      }, 402);
    }

    const body = await c.req.json() as {
      _id: string;
      name: string;
      description?: string;
      'dist-tags': Record<string, string>;
      versions: Record<string, PackageVersion>;
      _attachments: Record<string, { content_type: string; data: string; length: number }>;
      readme?: string;
      maintainers?: Array<{ name: string; email?: string }>;
    };

    // Validate package
    if (body.name !== name) {
      return c.json({ error: 'Package name mismatch' }, 400);
    }

    // Check if package exists and user is owner
    const existingRecord = this.packages.get(name);
    if (existingRecord && existingRecord.owner !== account) {
      return c.json({ error: 'Not authorized to publish this package' }, 403);
    }

    // Process attachments (tarballs)
    const attachments = body._attachments ?? {};
    for (const [filename, attachment] of Object.entries(attachments)) {
      const versionMatch = filename.match(/^(.+)-(\d+\.\d+\.\d+(?:-[\w.]+)?)\.tgz$/);
      if (!versionMatch) continue;

      const version = versionMatch[2];
      const tarballData = Buffer.from(attachment.data, 'base64');

      if (tarballData.length > this.config.maxPackageSize) {
        return c.json({ error: 'Package too large' }, 413);
      }

      // Compute hashes
      const shasum = createHash('sha1').update(tarballData).digest('hex');
      const integrity = `sha512-${createHash('sha512').update(tarballData).digest('base64')}`;

      // Upload to decentralized storage
      const cid = await this.uploadToStorage(tarballData, this.config.storageBackend);

      // Store tarball record
      const key = `${name}@${version}`;
      this.tarballs.set(key, {
        packageName: name,
        version,
        cid,
        size: tarballData.length,
        shasum,
        integrity,
        backend: this.config.storageBackend,
        uploadedAt: Date.now(),
      });

      // Update version dist info
      if (body.versions[version]) {
        body.versions[version].dist = {
          ...body.versions[version].dist,
          shasum,
          integrity,
          tarball: `${c.req.url.split('/').slice(0, 3).join('/')}/${name}/-/${filename}`,
        };
      }
    }

    // Create or update manifest
    const manifest: PackageManifest = {
      _id: name,
      name,
      description: body.description,
      'dist-tags': body['dist-tags'],
      versions: body.versions,
      time: {
        created: existingRecord ? new Date(existingRecord.createdAt).toISOString() : new Date().toISOString(),
        modified: new Date().toISOString(),
        ...Object.fromEntries(
          Object.keys(body.versions).map(v => [v, new Date().toISOString()])
        ),
      },
      maintainers: body.maintainers ?? [{ name: account }],
      readme: body.readme,
    };

    // Upload manifest to storage
    const manifestData = Buffer.from(JSON.stringify(manifest));
    const manifestCid = await this.uploadToStorage(manifestData, this.config.storageBackend);

    // Store manifest locally
    this.manifests.set(name, manifest);

    // Update package record
    const record: PackageRecord = {
      name,
      scope: name.startsWith('@') ? name.split('/')[0] : undefined,
      manifestCid,
      latestVersion: body['dist-tags'].latest ?? Object.keys(body.versions)[0],
      versions: Object.keys(body.versions),
      owner: existingRecord?.owner ?? account,
      createdAt: existingRecord?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      downloadCount: existingRecord?.downloadCount ?? 0,
      storageBackend: this.config.storageBackend,
      verified: false,
    };

    this.packages.set(name, record);

    // Update account
    const acc = this.getOrCreateAccount(account);
    acc.totalPublishes++;
    acc.totalStorageBytes += BigInt(manifestData.length);
    if (!acc.packages.includes(name)) {
      acc.packages.push(name);
    }

    // Invalidate cache
    this.cache.delete(`pkg:${name}`);

    return c.json({ ok: true, id: name, rev: `1-${manifestCid.slice(0, 8)}` }, 201);
  }

  private async handleUnpublish(c: Context, name: string): Promise<Response> {
    const account = this.getAccountFromRequest(c);
    const record = this.packages.get(name);

    if (!record) {
      return c.json({ error: 'Package not found' }, 404);
    }

    if (record.owner !== account) {
      return c.json({ error: 'Not authorized' }, 403);
    }

    // Note: We don't actually delete from IPFS/Arweave (data permanence)
    // We just mark as unpublished in our registry
    this.packages.delete(name);
    this.manifests.delete(name);
    
    // Remove tarball references
    for (const version of record.versions) {
      this.tarballs.delete(`${name}@${version}`);
    }

    this.cache.delete(`pkg:${name}`);

    return c.json({ ok: true });
  }

  private async handleSearch(c: Context): Promise<Response> {
    const text = c.req.query('text') ?? '';
    const size = parseInt(c.req.query('size') ?? '20', 10);
    const from = parseInt(c.req.query('from') ?? '0', 10);

    const results: Array<{
      package: { name: string; version: string; description?: string; links: { npm: string } };
      score: { final: number; detail: { quality: number; popularity: number; maintenance: number } };
    }> = [];

    for (const [name, record] of this.packages) {
      if (text && !name.toLowerCase().includes(text.toLowerCase())) {
        continue;
      }

      const manifest = this.manifests.get(name);
      results.push({
        package: {
          name,
          version: record.latestVersion,
          description: manifest?.description,
          links: { npm: `/-/package/${name}` },
        },
        score: {
          final: (record.reputationScore ?? 0.5),
          detail: {
            quality: 0.5,
            popularity: Math.min(1, record.downloadCount / 10000),
            maintenance: record.verified ? 1 : 0.5,
          },
        },
      });
    }

    // Sort by score
    results.sort((a, b) => b.score.final - a.score.final);

    return c.json({
      objects: results.slice(from, from + size),
      total: results.length,
      time: new Date().toISOString(),
    });
  }

  private async handleLogin(c: Context): Promise<Response> {
    const body = await c.req.json() as { name: string; password: string; email?: string };
    
    // In a decentralized registry, login is wallet-based
    // The "name" should be the wallet address or JNS name
    // Password is the signed message proving ownership
    
    // For now, create/return account
    const account = this.getOrCreateAccount(body.name);
    
    return c.json({
      ok: true,
      id: `org.couchdb.user:${body.name}`,
      token: body.name, // In production, this would be a JWT or session token
    }, 201);
  }

  private async handleWhoami(c: Context): Promise<Response> {
    const account = this.getAccountFromRequest(c);
    if (!account) {
      return c.json({ error: 'Not logged in' }, 401);
    }
    return c.json({ username: account });
  }

  private async handleSyncFromUpstream(c: Context, name: string): Promise<Response> {
    if (!this.config.upstreamRegistry) {
      return c.json({ error: 'No upstream registry configured' }, 400);
    }

    const upstream = await this.fetchFromUpstream(name);
    if (!upstream) {
      return c.json({ error: 'Package not found in upstream' }, 404);
    }

    // Store manifest
    const manifestData = Buffer.from(JSON.stringify(upstream));
    const manifestCid = await this.uploadToStorage(manifestData, this.config.storageBackend);
    this.manifests.set(name, upstream);

    // Create package record
    const record: PackageRecord = {
      name,
      scope: name.startsWith('@') ? name.split('/')[0] : undefined,
      manifestCid,
      latestVersion: upstream['dist-tags'].latest,
      versions: Object.keys(upstream.versions),
      owner: 'upstream-sync',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      downloadCount: 0,
      storageBackend: this.config.storageBackend,
      verified: true,
    };

    this.packages.set(name, record);

    // Sync tarballs for recent versions
    const versionsToSync = Object.keys(upstream.versions).slice(-5); // Last 5 versions
    for (const version of versionsToSync) {
      const versionData = upstream.versions[version];
      if (versionData.dist.tarball) {
        const response = await fetch(versionData.dist.tarball).catch(() => null);
        if (response?.ok) {
          const tarballData = new Uint8Array(await response.arrayBuffer());
          const cid = await this.uploadToStorage(tarballData, this.config.storageBackend);
          
          this.tarballs.set(`${name}@${version}`, {
            packageName: name,
            version,
            cid,
            size: tarballData.length,
            shasum: versionData.dist.shasum,
            integrity: versionData.dist.integrity ?? '',
            backend: this.config.storageBackend,
            uploadedAt: Date.now(),
          });
        }
      }
    }

    return c.json({ ok: true, synced: versionsToSync.length });
  }

  private async fetchFromUpstream(name: string): Promise<PackageManifest | null> {
    const url = `${this.config.upstreamRegistry}/${encodeURIComponent(name)}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    }).catch(() => null);

    if (!response?.ok) return null;
    return response.json() as Promise<PackageManifest>;
  }

  private async uploadToStorage(data: Uint8Array | Buffer, backend: StorageBackend): Promise<string> {
    const buffer = Buffer.from(data);
    
    if (backend === 'hybrid') {
      // Upload to both for redundancy
      const [ipfsCid, arweaveCid] = await Promise.all([
        this.uploadToIPFS(buffer).catch(() => null),
        this.uploadToArweave(buffer).catch(() => null),
      ]);
      return ipfsCid ?? arweaveCid ?? '';
    }
    
    if (backend === 'ipfs') {
      return this.uploadToIPFS(buffer);
    }
    
    return this.uploadToArweave(buffer);
  }

  private async uploadToIPFS(data: Buffer): Promise<string> {
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

  private async uploadToArweave(data: Buffer): Promise<string> {
    if (!this.config.privateKey) {
      throw new Error('Private key required for Arweave uploads');
    }

    // Use Irys SDK
    const { default: Irys } = await import('@irys/sdk');
    const irys = new Irys({
      url: 'https://devnet.irys.xyz',
      token: 'ethereum',
      key: this.config.privateKey.replace('0x', ''),
    });
    await irys.ready();

    const response = await irys.upload(data);
    return response.id;
  }

  private async fetchFromStorage(cid: string, backend: StorageBackend): Promise<ArrayBuffer | null> {
    if (backend === 'ipfs' || backend === 'hybrid') {
      const response = await fetch(`${this.config.ipfsUrl}/api/v0/cat?arg=${cid}`, {
        method: 'POST',
      }).catch(() => null);
      
      if (response?.ok) {
        return response.arrayBuffer();
      }
    }

    if (backend === 'arweave' || backend === 'hybrid') {
      const response = await fetch(`${this.config.arweaveUrl}/${cid}`).catch(() => null);
      if (response?.ok) {
        return response.arrayBuffer();
      }
    }

    return null;
  }

  private getFromCache(key: string): CacheEntry | null {
    if (!this.config.cacheEnabled) return null;
    
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    if (Date.now() - entry.timestamp > this.config.cacheTTL) {
      this.cache.delete(key);
      return null;
    }
    
    return entry;
  }

  private setCache(key: string, data: Buffer | string, etag?: string): void {
    if (!this.config.cacheEnabled) return;
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      etag,
    });
  }

  private computeEtag(data: string): string {
    return `"${createHash('md5').update(data).digest('hex')}"`;
  }

  private getAccountFromRequest(c: Context): string | null {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return null;

    if (authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
      const [username] = decoded.split(':');
      return username;
    }

    return null;
  }

  private getOrCreateAccount(address: string): PublisherAccount {
    let account = this.accounts.get(address);
    if (!account) {
      account = {
        address,
        balance: 0n,
        stakedAmount: 0n,
        tier: 'free',
        totalDownloads: 0,
        totalPublishes: 0,
        totalStorageBytes: 0n,
        packages: [],
        reputationScore: 0,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      this.accounts.set(address, account);
    }
    return account;
  }

  private hasAccess(address: string | null, operation: 'publish' | 'download'): boolean {
    if (!address) return false;

    // Allow free publish in dev/test mode
    if (operation === 'publish' && this.config.allowFreePublish) {
      // Ensure account exists
      this.getOrCreateAccount(address);
      return true;
    }

    const account = this.accounts.get(address);
    if (!account) return operation === 'download'; // Allow downloads for new users

    if (account.tier === 'unlimited') return true;
    if (account.stakedAmount > 0n) return true;

    // Check balance for operation
    const cost = operation === 'publish' ? 10000000n : 0n;
    return account.balance >= cost;
  }

  private createPaymentRequirement(operation: 'publish' | 'download'): object {
    const amount = operation === 'publish' ? '0.01' : '0.0001';
    return {
      x402Version: 1,
      error: 'Payment required',
      accepts: [{
        scheme: 'exact',
        network: 'base-sepolia',
        maxAmountRequired: amount,
        asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
        payTo: this.config.paymentRecipient,
        resource: `/-/registry/${operation}`,
        description: `NPM Registry ${operation} access`,
      }],
    };
  }

  private async checkStorageHealth(backend: 'ipfs' | 'arweave'): Promise<boolean> {
    if (backend === 'ipfs') {
      const response = await fetch(`${this.config.ipfsUrl}/api/v0/id`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      return response?.ok ?? false;
    }

    const response = await fetch(`${this.config.arweaveUrl}/info`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    return response?.ok ?? false;
  }

  // Public methods for integration with other services

  getPackage(name: string): PackageRecord | undefined {
    return this.packages.get(name);
  }

  getPackages(): PackageRecord[] {
    return Array.from(this.packages.values());
  }

  getAccount(address: string): PublisherAccount | undefined {
    return this.accounts.get(address);
  }

  setReputationScore(packageName: string, score: number): void {
    const record = this.packages.get(packageName);
    if (record) {
      record.reputationScore = score;
    }
  }

  linkToCouncilProposal(packageName: string, proposalId: string): void {
    const record = this.packages.get(packageName);
    if (record) {
      record.councilProposalId = proposalId;
    }
  }
}

export function createNPMRegistry(config?: Partial<NPMRegistryConfig>): NPMRegistry {
  return new NPMRegistry(config);
}

export function createNPMRegistryRouter(config?: Partial<NPMRegistryConfig>): Hono {
  const registry = createNPMRegistry(config);
  return registry.createRouter();
}
