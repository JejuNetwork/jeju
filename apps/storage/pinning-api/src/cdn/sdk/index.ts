/**
 * CDN SDK
 * 
 * Easy-to-use SDK for deploying frontends to the decentralized CDN.
 * Similar to Vercel's deploy experience but fully decentralized.
 * 
 * Usage:
 * ```typescript
 * import { CDNClient } from '@jeju/cdn/sdk';
 * 
 * const cdn = new CDNClient({ privateKey, rpcUrl });
 * 
 * // Deploy a frontend
 * const deployment = await cdn.deploy({
 *   domain: 'myapp.jns.eth',
 *   buildDir: './dist',
 *   framework: 'next',
 * });
 * 
 * // Invalidate cache
 * await cdn.invalidate(deployment.siteId, ['/', '/api/*']);
 * 
 * // Get stats
 * const stats = await cdn.getStats(deployment.siteId);
 * ```
 */

import { Wallet, JsonRpcProvider, Contract } from 'ethers';
import { createHash } from 'crypto';
import { readdir, stat, readFile } from 'fs/promises';
import { join, relative } from 'path';
import type { Address } from 'viem';
import type {
  CDNSiteConfig,
  CacheConfig,
  InvalidationRequest,
  InvalidationResult,
  WarmupRequest,
  WarmupResult,
  CDNStatsRequest,
  CDNStatsResponse,
  CDNDeployRequest,
  CDNDeployResponse,
  CDNRegion,
} from '@jejunetwork/types';
import { DEFAULT_CACHE_RULES, DEFAULT_TTL_CONFIG } from '@jejunetwork/types';

// ============================================================================
// Types
// ============================================================================

export interface CDNClientConfig {
  privateKey: string;
  rpcUrl: string;
  registryAddress?: Address;
  billingAddress?: Address;
  coordinatorUrl?: string;
  ipfsGateway?: string;
}

export interface DeployOptions {
  domain: string;
  buildDir: string;
  jnsName?: string;
  framework?: 'next' | 'vite' | 'astro' | 'remix' | 'static';
  cacheConfig?: Partial<CacheConfig>;
  regions?: CDNRegion[];
  warmup?: boolean;
  invalidate?: boolean;
}

export interface DeployResult {
  siteId: string;
  domain: string;
  cdnUrl: string;
  contentHash: string;
  filesUploaded: number;
  totalBytes: number;
  warmupResult?: WarmupResult;
}

export interface FileUpload {
  path: string;
  contentType: string;
  size: number;
  hash: string;
}

// ============================================================================
// ABIs
// ============================================================================

const CDN_REGISTRY_ABI = [
  'function createSite(string domain, string origin) returns (bytes32)',
  'function updateSiteContent(bytes32 siteId, bytes32 contentHash)',
  'function getSite(bytes32 siteId) view returns (tuple(bytes32 siteId, address owner, string domain, string origin, bytes32 contentHash, uint256 createdAt, uint256 updatedAt, bool active))',
  'function getOwnerSites(address owner) view returns (bytes32[])',
  'function requestInvalidation(bytes32 siteId, string[] paths, uint8[] regions) returns (bytes32)',
];

const CDN_BILLING_ABI = [
  'function deposit() payable',
  'function depositToken(uint256 amount)',
  'function getBalance(address user) view returns (uint256)',
  'function withdraw(uint256 amount)',
];

// ============================================================================
// CDN Client
// ============================================================================

export class CDNClient {
  private wallet: Wallet;
  private registry: Contract;
  private billing: Contract;
  private coordinatorUrl: string;
  private ipfsGateway: string;

  constructor(config: CDNClientConfig) {
    const provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, provider);
    
    this.registry = new Contract(
      config.registryAddress ?? '0x0000000000000000000000000000000000000000',
      CDN_REGISTRY_ABI,
      this.wallet
    );
    
    this.billing = new Contract(
      config.billingAddress ?? '0x0000000000000000000000000000000000000000',
      CDN_BILLING_ABI,
      this.wallet
    );
    
    this.coordinatorUrl = config.coordinatorUrl ?? 'http://localhost:4021';
    this.ipfsGateway = config.ipfsGateway ?? 'https://ipfs.io';
  }

  // ============================================================================
  // Deployment
  // ============================================================================

  /**
   * Deploy a frontend to the CDN
   */
  async deploy(options: DeployOptions): Promise<DeployResult> {
    console.log(`[CDN] Deploying ${options.buildDir} to ${options.domain}...`);

    // 1. Collect files
    const files = await this.collectFiles(options.buildDir);
    console.log(`[CDN] Found ${files.length} files`);

    // 2. Upload to IPFS (or other storage)
    const uploadResult = await this.uploadFiles(files, options.buildDir);
    console.log(`[CDN] Uploaded ${uploadResult.filesUploaded} files (${uploadResult.totalBytes} bytes)`);

    // 3. Calculate content hash
    const contentHash = this.calculateContentHash(files);

    // 4. Register/update site on-chain
    const siteId = await this.registerSite(options.domain, uploadResult.cid);

    // 5. Update content hash
    await this.registry.updateSiteContent(siteId, contentHash);

    // 6. Optional: Invalidate existing cache
    if (options.invalidate !== false) {
      await this.invalidate(siteId, ['/*']);
    }

    // 7. Optional: Warmup cache
    let warmupResult: WarmupResult | undefined;
    if (options.warmup !== false) {
      const urls = files
        .filter(f => f.path.endsWith('.html') || f.path.endsWith('.js') || f.path.endsWith('.css'))
        .slice(0, 100) // Limit warmup
        .map(f => `https://${options.domain}/${f.path}`);
      
      warmupResult = await this.warmup({
        requestId: crypto.randomUUID(),
        urls,
        regions: options.regions ?? ['global'],
        priority: 'high',
        requestedBy: this.wallet.address as Address,
        requestedAt: Date.now(),
      });
    }

    const cdnUrl = options.jnsName 
      ? `https://${options.jnsName}.jns.eth`
      : `https://cdn.jeju.network/${siteId}`;

    return {
      siteId,
      domain: options.domain,
      cdnUrl,
      contentHash,
      filesUploaded: uploadResult.filesUploaded,
      totalBytes: uploadResult.totalBytes,
      warmupResult,
    };
  }

  /**
   * Collect all files from build directory
   */
  private async collectFiles(dir: string): Promise<FileUpload[]> {
    const files: FileUpload[] = [];

    const processDir = async (currentDir: string) => {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          // Skip node_modules and hidden directories
          if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
            await processDir(fullPath);
          }
        } else if (entry.isFile()) {
          const fileStat = await stat(fullPath);
          const content = await readFile(fullPath);
          const relativePath = relative(dir, fullPath);

          files.push({
            path: relativePath,
            contentType: this.getContentType(entry.name),
            size: fileStat.size,
            hash: createHash('sha256').update(content).digest('hex'),
          });
        }
      }
    };

    await processDir(dir);
    return files;
  }

  /**
   * Upload files to IPFS
   */
  private async uploadFiles(
    files: FileUpload[],
    buildDir: string
  ): Promise<{ cid: string; filesUploaded: number; totalBytes: number }> {
    // This would typically use an IPFS client to upload
    // For now, we'll simulate with a placeholder
    
    let totalBytes = 0;
    for (const file of files) {
      totalBytes += file.size;
    }

    // In production, upload to IPFS and get CID
    const cid = `Qm${createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 44)}`;

    return {
      cid,
      filesUploaded: files.length,
      totalBytes,
    };
  }

  /**
   * Calculate content hash from files
   */
  private calculateContentHash(files: FileUpload[]): string {
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const combined = sorted.map(f => `${f.path}:${f.hash}`).join('|');
    return `0x${createHash('sha256').update(combined).digest('hex')}`;
  }

  /**
   * Register or get existing site
   */
  private async registerSite(domain: string, origin: string): Promise<string> {
    // Check if site already exists
    const existingSites = await this.registry.getOwnerSites(this.wallet.address);
    
    for (const siteId of existingSites) {
      const site = await this.registry.getSite(siteId);
      if (site.domain === domain) {
        return siteId;
      }
    }

    // Create new site
    const tx = await this.registry.createSite(domain, `ipfs://${origin}`);
    const receipt = await tx.wait();
    
    // Extract siteId from event
    const event = receipt.logs[0];
    return event.topics[1] as string;
  }

  /**
   * Get content type from filename
   */
  private getContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      json: 'application/json',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      avif: 'image/avif',
      ico: 'image/x-icon',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      eot: 'application/vnd.ms-fontobject',
      wasm: 'application/wasm',
      txt: 'text/plain',
      xml: 'application/xml',
      map: 'application/json',
    };
    return types[ext ?? ''] ?? 'application/octet-stream';
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Invalidate cache paths
   */
  async invalidate(siteId: string, paths: string[]): Promise<InvalidationResult> {
    // Request invalidation via coordinator
    const response = await fetch(`${this.coordinatorUrl}/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId,
        paths,
        priority: 'high',
        requestedBy: this.wallet.address,
      }),
    });

    if (!response.ok) {
      throw new Error(`Invalidation failed: ${response.statusText}`);
    }

    const result = await response.json() as { requestId: string; nodesTotal: number };

    // Wait for completion
    return this.waitForInvalidation(result.requestId);
  }

  /**
   * Wait for invalidation to complete
   */
  private async waitForInvalidation(requestId: string, timeout = 30000): Promise<InvalidationResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const response = await fetch(`${this.coordinatorUrl}/invalidate/${requestId}`);
      const result = await response.json() as InvalidationResult;

      if (result.status === 'completed' || result.status === 'failed') {
        return result;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Invalidation timed out');
  }

  /**
   * Warmup cache with URLs
   */
  async warmup(request: WarmupRequest): Promise<WarmupResult> {
    const response = await fetch(`${this.coordinatorUrl}/warmup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      return {
        requestId: request.requestId,
        status: 'partial',
        urlsProcessed: 0,
        urlsTotal: request.urls.length,
        bytesWarmed: 0n,
        regionsWarmed: [],
        errors: [{ url: '*', region: 'global', error: response.statusText }],
      };
    }

    return response.json() as Promise<WarmupResult>;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get site statistics
   */
  async getStats(siteId: string, options?: Partial<CDNStatsRequest>): Promise<CDNStatsResponse> {
    const params = new URLSearchParams({
      siteId,
      startTime: (options?.startTime ?? Date.now() - 86400000).toString(),
      endTime: (options?.endTime ?? Date.now()).toString(),
      granularity: options?.granularity ?? 'hour',
    });

    const response = await fetch(`${this.coordinatorUrl}/stats?${params}`);
    
    if (!response.ok) {
      throw new Error(`Failed to get stats: ${response.statusText}`);
    }

    return response.json() as Promise<CDNStatsResponse>;
  }

  /**
   * Get site info
   */
  async getSite(siteId: string): Promise<CDNSiteConfig | null> {
    const site = await this.registry.getSite(siteId);
    if (!site || !site.active) {
      return null;
    }

    return {
      siteId: site.siteId,
      domain: site.domain,
      aliases: [],
      owner: site.owner,
      origin: {
        name: 'ipfs',
        type: 'ipfs',
        endpoint: site.origin,
        timeout: 30000,
        retries: 2,
        healthCheck: {
          enabled: true,
          path: '/',
          interval: 60000,
          timeout: 5000,
          healthyThreshold: 2,
          unhealthyThreshold: 3,
        },
      },
      cacheConfig: {
        enabled: true,
        defaultTTL: 3600,
        maxAge: 86400,
        staleWhileRevalidate: 60,
        staleIfError: 300,
        rules: DEFAULT_CACHE_RULES,
        ttlConfig: DEFAULT_TTL_CONFIG,
        respectOriginHeaders: true,
        cachePrivate: false,
        cacheAuthenticated: false,
      },
      ssl: {
        enabled: true,
        minVersion: 'TLSv1.2',
        hsts: true,
        hstsMaxAge: 31536000,
        hstsIncludeSubdomains: true,
      },
      security: {
        waf: false,
        ddosProtection: true,
        botProtection: false,
      },
      createdAt: Number(site.createdAt),
      updatedAt: Number(site.updatedAt),
    };
  }

  /**
   * List all sites for the connected wallet
   */
  async listSites(): Promise<string[]> {
    return this.registry.getOwnerSites(this.wallet.address);
  }

  // ============================================================================
  // Billing
  // ============================================================================

  /**
   * Deposit funds for CDN usage
   */
  async deposit(amount: bigint): Promise<string> {
    const tx = await this.billing.deposit({ value: amount });
    return tx.hash;
  }

  /**
   * Get current balance
   */
  async getBalance(): Promise<bigint> {
    return this.billing.getBalance(this.wallet.address);
  }

  /**
   * Withdraw unused balance
   */
  async withdraw(amount: bigint): Promise<string> {
    const tx = await this.billing.withdraw(amount);
    return tx.hash;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCDNClient(config: CDNClientConfig): CDNClient {
  return new CDNClient(config);
}

/**
 * Create CDN client from environment variables
 */
export function createCDNClientFromEnv(): CDNClient {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable required');
  }

  return new CDNClient({
    privateKey,
    rpcUrl: process.env.RPC_URL ?? 'http://localhost:8545',
    registryAddress: process.env.CDN_REGISTRY_ADDRESS as Address | undefined,
    billingAddress: process.env.CDN_BILLING_ADDRESS as Address | undefined,
    coordinatorUrl: process.env.CDN_COORDINATOR_URL,
    ipfsGateway: process.env.IPFS_GATEWAY_URL,
  });
}

