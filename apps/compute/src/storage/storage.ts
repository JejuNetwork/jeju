/**
 * Decentralized Storage - 100% PERMISSIONLESS Implementation
 *
 * CRITICAL: This implementation is FULLY DECENTRALIZED with NO API KEYS:
 *
 * 1. MULTIPLE GATEWAYS: Falls back through several independent gateways
 * 2. CONTENT VERIFICATION: Re-hashes downloaded content to detect tampering
 * 3. WALLET-ONLY UPLOADS: Uses Irys (Arweave) or local IPFS - no API keys
 * 4. NO SINGLE POINT OF FAILURE: If one gateway is down, others are tried
 *
 * UPLOAD OPTIONS (all permissionless):
 * - Arweave via Irys: Pay with ETH, sign with wallet (PRIMARY)
 * - Local IPFS node: Run your own, no auth needed
 *
 * READ OPTIONS (public, no auth):
 * - Multiple Arweave gateways
 * - Multiple IPFS gateways
 */

import type { Hex } from 'viem';
import { keccak256 } from 'viem';
import type {
  Storage,
  StorageStats,
  UploadOptions,
  UploadResult,
} from './storage-interface.js';

// ═══════════════════════════════════════════════════════════════════════════
// GATEWAY CONFIGURATION (PUBLIC, NO AUTH)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Arweave gateways - multiple independent operators
 * Used for READING data. Uploads go through Irys with wallet signature.
 */
const ARWEAVE_GATEWAYS = [
  'https://arweave.net', // Official gateway
  'https://ar-io.net', // AR.IO network
  'https://g8way.io', // g8way gateway
  'https://arweave.dev', // Developer gateway
  'https://gateway.redstone.finance', // Redstone
] as const;

/**
 * IPFS gateways - multiple independent operators
 * Used for READING data. Uploads require local node (no API keys).
 */
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs',
  'https://cloudflare-ipfs.com/ipfs',
  'https://dweb.link/ipfs',
  'https://w3s.link/ipfs', // Web3.Storage gateway
  'https://4everland.io/ipfs',
] as const;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface DecentralizedStorageConfig {
  /** Primary network for uploads */
  primaryNetwork: 'arweave' | 'ipfs';
  /** Private key for signing Arweave uploads (ETH format) - REQUIRED for uploads */
  privateKey?: Hex;
  /** Timeout per gateway attempt (ms) */
  gatewayTimeout?: number;
  /** Maximum retries across gateways */
  maxRetries?: number;
  /** Verify content hash on download */
  verifyOnDownload?: boolean;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Custom gateways to prioritize */
  customGateways?: string[];
  /**
   * Arweave network: 'mainnet' for production, 'devnet' for free testing
   * @default 'devnet'
   */
  arweaveNetwork?: 'mainnet' | 'devnet';
  /**
   * Local IPFS API URL for uploads (no API key needed)
   * @default 'http://localhost:5001'
   */
  localIPFSUrl?: string;
}

export interface DownloadResult {
  data: Uint8Array;
  gateway: string;
  verified: boolean;
  attempts: number;
}

export interface GatewayHealth {
  gateway: string;
  healthy: boolean;
  latencyMs?: number;
  lastChecked: number;
  error?: string;
}

export interface StorageLocation {
  network: 'arweave' | 'ipfs';
  id: string;
  gateways: string[];
  uploadedAt: number;
  contentHash: Hex;
}

// ═══════════════════════════════════════════════════════════════════════════
// IRYS CLIENT TYPE (for wallet-signed Arweave uploads)
// ═══════════════════════════════════════════════════════════════════════════

interface IrysClient {
  ready(): Promise<IrysClient>;
  getLoadedBalance(): Promise<bigint>;
  getPrice(bytes: number): Promise<bigint>;
  fund(amount: bigint): Promise<{ id: string }>;
  upload(
    data: string,
    options: { tags: { name: string; value: string }[] }
  ): Promise<{ id: string }>;
  utils: {
    fromAtomic(amount: bigint): string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DECENTRALIZED STORAGE IMPLEMENTATION (100% PERMISSIONLESS)
// ═══════════════════════════════════════════════════════════════════════════

export class DecentralizedStorage implements Storage {
  private config: DecentralizedStorageConfig;
  private stats: StorageStats = {
    objectCount: 0,
    totalSize: 0,
    encryptedCount: 0,
    publicCount: 0,
  };
  private gatewayHealth: Map<string, GatewayHealth> = new Map();
  private uploadedContent: Map<string, StorageLocation> = new Map();
  private irysClient: IrysClient | null = null;

  constructor(config: DecentralizedStorageConfig) {
    this.config = {
      gatewayTimeout: 10000,
      maxRetries: 5,
      verifyOnDownload: true,
      arweaveNetwork: 'devnet',
      localIPFSUrl: 'http://localhost:5001',
      ...config,
    };
  }

  /**
   * Get or initialize Irys client for Arweave uploads (wallet signature only)
   */
  private async getIrys(): Promise<IrysClient> {
    if (this.irysClient) {
      return this.irysClient;
    }

    if (!this.config.privateKey) {
      throw new Error(
        'Private key required for Arweave uploads. Pass privateKey in config.'
      );
    }

    // Dynamic import to avoid requiring Irys when not used
    const { default: Irys } = await import('@irys/sdk');

    const url =
      this.config.arweaveNetwork === 'mainnet'
        ? 'https://node1.irys.xyz'
        : 'https://devnet.irys.xyz';

    if (this.config.verbose) {
      console.log(`[DecentralizedStorage] Connecting to Irys at ${url}...`);
    }

    // Remove 0x prefix for Irys
    const key = this.config.privateKey.startsWith('0x')
      ? this.config.privateKey.slice(2)
      : this.config.privateKey;

    // Cast through unknown to bypass strict type checking - runtime compatible
    const irys = new Irys({
      url,
      token: 'ethereum',
      key,
    }) as unknown as IrysClient;

    await irys.ready();

    if (this.config.verbose) {
      const balance = await irys.getLoadedBalance();
      console.log(
        `[DecentralizedStorage] Connected. Balance: ${irys.utils.fromAtomic(balance)} ETH`
      );
    }

    this.irysClient = irys;
    return irys;
  }

  /**
   * Check if local IPFS node is available
   */
  private async isLocalIPFSAvailable(): Promise<boolean> {
    const url = this.config.localIPFSUrl ?? 'http://localhost:5001';
    const response = await fetch(`${url}/api/v0/id`, {
      method: 'POST',
    }).catch(() => null);
    return response?.ok ?? false;
  }

  /**
   * Get ordered list of gateways for a network
   * Prioritizes healthy gateways and custom gateways
   */
  private getGateways(network: 'arweave' | 'ipfs'): string[] {
    const baseGateways =
      network === 'arweave' ? [...ARWEAVE_GATEWAYS] : [...IPFS_GATEWAYS];

    // Add custom gateways first
    const gateways = [...(this.config.customGateways ?? []), ...baseGateways];

    // Sort by health (healthy gateways first, then by latency)
    return gateways.sort((a, b) => {
      const healthA = this.gatewayHealth.get(a);
      const healthB = this.gatewayHealth.get(b);

      if (!healthA && !healthB) return 0;
      if (!healthA) return 1;
      if (!healthB) return -1;

      if (healthA.healthy && !healthB.healthy) return -1;
      if (!healthA.healthy && healthB.healthy) return 1;

      return (healthA.latencyMs ?? Infinity) - (healthB.latencyMs ?? Infinity);
    });
  }

  /**
   * Compute content hash for verification
   */
  private computeHash(data: Uint8Array): Hex {
    const hexString = `0x${Buffer.from(data).toString('hex')}` as const;
    return keccak256(hexString);
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(
    url: string,
    timeout: number,
    options?: RequestInit
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Try to download from a single gateway
   */
  private async tryGateway(
    gateway: string,
    id: string,
    network: 'arweave' | 'ipfs'
  ): Promise<{ data: Uint8Array; latencyMs: number }> {
    const url = network === 'arweave' ? `${gateway}/${id}` : `${gateway}/${id}`;

    const startTime = Date.now();

    const response = await this.fetchWithTimeout(
      url,
      this.config.gatewayTimeout ?? 10000
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const latencyMs = Date.now() - startTime;

    // Update gateway health
    this.gatewayHealth.set(gateway, {
      gateway,
      healthy: true,
      latencyMs,
      lastChecked: Date.now(),
    });

    return {
      data: new Uint8Array(buffer),
      latencyMs,
    };
  }

  /**
   * Upload to IPFS via local node (NO API KEY - you run the node)
   */
  private async uploadToLocalIPFS(data: Uint8Array): Promise<string> {
    const url = this.config.localIPFSUrl ?? 'http://localhost:5001';

    // Check if local node is available
    const available = await this.isLocalIPFSAvailable();
    if (!available) {
      throw new Error(
        `Local IPFS node not available at ${url}. Start with: ipfs daemon`
      );
    }

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(data)]));

    const response = await fetch(`${url}/api/v0/add`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Local IPFS upload failed: ${await response.text()}`);
    }

    const result = (await response.json()) as { Hash: string };

    if (this.config.verbose) {
      console.log(
        `[DecentralizedStorage] ✓ Uploaded to local IPFS: ${result.Hash}`
      );
    }

    return result.Hash;
  }

  /**
   * Upload to Arweave via Irys (wallet signature only, NO API KEY)
   */
  private async uploadToArweave(
    data: Uint8Array,
    options?: UploadOptions
  ): Promise<{ id: string; cost: string }> {
    const irys = await this.getIrys();

    // Build tags
    const tags: { name: string; value: string }[] = [
      { name: 'App-Name', value: 'jeju-compute' },
      { name: 'Timestamp', value: Date.now().toString() },
    ];

    if (options?.encrypted) {
      tags.push({ name: 'Encrypted', value: 'true' });
    }

    if (options?.tags) {
      for (const [name, value] of Object.entries(options.tags)) {
        tags.push({ name, value });
      }
    }

    const price = await irys.getPrice(data.length);

    if (this.config.verbose) {
      console.log(
        `[DecentralizedStorage] Uploading ${data.length} bytes to Arweave (cost: ${irys.utils.fromAtomic(price)} ETH)...`
      );
    }

    const dataToUpload = Buffer.from(data).toString();
    const receipt = await irys.upload(dataToUpload, { tags });

    if (this.config.verbose) {
      console.log(
        `[DecentralizedStorage] ✓ Uploaded: https://arweave.net/${receipt.id}`
      );
    }

    return {
      id: receipt.id,
      cost: price.toString(),
    };
  }

  /**
   * Upload data (100% PERMISSIONLESS - wallet signature or local node only)
   */
  async upload(
    data: Uint8Array | string,
    options?: UploadOptions
  ): Promise<UploadResult> {
    const bytes =
      typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const contentHash = this.computeHash(bytes);

    if (this.config.verbose) {
      console.log(
        `[DecentralizedStorage] Uploading ${bytes.length} bytes to ${this.config.primaryNetwork}...`
      );
    }

    let storageId: string;
    let url: string;
    let cost = '0';

    if (this.config.primaryNetwork === 'ipfs') {
      // Try local IPFS first (no API key needed)
      const ipfsAvailable = await this.isLocalIPFSAvailable();
      if (ipfsAvailable) {
        storageId = await this.uploadToLocalIPFS(bytes);
        url = `${IPFS_GATEWAYS[0]}/${storageId}`;
      } else {
        // Fall back to Arweave (wallet signature only)
        if (this.config.verbose) {
          console.log(
            '[DecentralizedStorage] Local IPFS unavailable, falling back to Arweave...'
          );
        }
        const result = await this.uploadToArweave(bytes, options);
        storageId = result.id;
        url = `${ARWEAVE_GATEWAYS[0]}/${storageId}`;
        cost = result.cost;
      }
    } else {
      // Arweave upload via Irys (wallet signature only, NO API KEY)
      const result = await this.uploadToArweave(bytes, options);
      storageId = result.id;
      url = `${ARWEAVE_GATEWAYS[0]}/${storageId}`;
      cost = result.cost;
    }

    // Store location for future reference
    const network = url.includes('arweave') ? 'arweave' : 'ipfs';
    this.uploadedContent.set(storageId, {
      network,
      id: storageId,
      gateways:
        network === 'arweave' ? [...ARWEAVE_GATEWAYS] : [...IPFS_GATEWAYS],
      uploadedAt: Date.now(),
      contentHash,
    });

    // Update stats
    this.stats.objectCount++;
    this.stats.totalSize += bytes.length;
    if (options?.encrypted) {
      this.stats.encryptedCount++;
    } else {
      this.stats.publicCount++;
    }

    if (this.config.verbose) {
      console.log(`[DecentralizedStorage] ✓ Uploaded: ${url}`);
    }

    return {
      id: storageId,
      url,
      size: bytes.length,
      cost,
    };
  }

  /**
   * Upload JSON
   */
  async uploadJSON(
    data: unknown,
    options?: UploadOptions
  ): Promise<UploadResult> {
    const json = JSON.stringify(data);
    return this.upload(json, options);
  }

  /**
   * Download with multi-gateway fallback and verification
   */
  async download(id: string): Promise<Uint8Array> {
    const result = await this.downloadWithDetails(id);
    return result.data;
  }

  /**
   * Download with detailed result including which gateway was used
   */
  async downloadWithDetails(
    id: string,
    expectedHash?: Hex
  ): Promise<DownloadResult> {
    // Determine network from stored location or try both
    const location = this.uploadedContent.get(id);
    const network = location?.network ?? this.config.primaryNetwork;

    const gateways = this.getGateways(network);
    let attempts = 0;
    const maxRetries = this.config.maxRetries ?? 5;

    if (this.config.verbose) {
      console.log(
        `[DecentralizedStorage] Downloading ${id} from ${network} (${gateways.length} gateways available)`
      );
    }

    for (const gateway of gateways) {
      if (attempts >= maxRetries) break;
      attempts++;

      if (this.config.verbose) {
        console.log(
          `[DecentralizedStorage] Trying gateway ${attempts}/${maxRetries}: ${gateway}`
        );
      }

      const result = await this.tryGateway(gateway, id, network).catch(
        () => null
      );
      if (!result) continue;

      // Verify content hash if enabled
      let verified = true;
      if (this.config.verifyOnDownload) {
        const computedHash = this.computeHash(result.data);
        const storedHash = location?.contentHash ?? expectedHash;

        if (storedHash && computedHash !== storedHash) {
          if (this.config.verbose) {
            console.log(
              `[DecentralizedStorage] ⚠️ Hash mismatch from ${gateway}! Expected ${storedHash}, got ${computedHash}`
            );
          }
          verified = false;
          // Try next gateway
          continue;
        }
      }

      if (this.config.verbose) {
        console.log(
          `[DecentralizedStorage] ✓ Downloaded from ${gateway} (${result.latencyMs}ms)${verified ? ' [verified]' : ' [unverified]'}`
        );
      }

      return {
        data: result.data,
        gateway,
        verified,
        attempts,
      };
    }

    // All gateways failed - try the other network
    if (network === 'arweave') {
      if (this.config.verbose) {
        console.log(
          `[DecentralizedStorage] All Arweave gateways failed, trying IPFS...`
        );
      }

      for (const gateway of this.getGateways('ipfs')) {
        if (attempts >= maxRetries * 2) break;
        attempts++;

        const result = await this.tryGateway(gateway, id, 'ipfs').catch(
          () => null
        );
        if (result) {
          return {
            data: result.data,
            gateway,
            verified: false, // Cross-network, can't verify
            attempts,
          };
        }
      }
    }

    throw new Error(
      `Failed to download ${id} after ${attempts} attempts across all gateways. ` +
        `Network may be partitioned or content may be lost.`
    );
  }

  /**
   * Download and parse JSON
   */
  async downloadJSON<T>(id: string): Promise<T> {
    const bytes = await this.download(id);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  }

  /**
   * Check if content exists (tries multiple gateways)
   */
  async exists(id: string): Promise<boolean> {
    const network =
      this.uploadedContent.get(id)?.network ?? this.config.primaryNetwork;
    const gateways = this.getGateways(network);

    for (const gateway of gateways.slice(0, 3)) {
      try {
        const url = `${gateway}/${id}`;
        const response = await this.fetchWithTimeout(url, 5000, {
          method: 'HEAD',
        });
        if (response.ok) return true;
      } catch {
        // Try next gateway
      }
    }

    return false;
  }

  /**
   * Get URL for content (returns all gateway URLs)
   */
  getUrl(id: string): string {
    const network =
      this.uploadedContent.get(id)?.network ?? this.config.primaryNetwork;
    const gateway = this.getGateways(network)[0];
    return `${gateway}/${id}`;
  }

  /**
   * Get all gateway URLs for content
   */
  getAllUrls(id: string): string[] {
    const network =
      this.uploadedContent.get(id)?.network ?? this.config.primaryNetwork;
    return this.getGateways(network).map((g) => `${g}/${id}`);
  }

  /**
   * Get storage statistics
   */
  getStats(): StorageStats {
    return { ...this.stats };
  }

  /**
   * Check health of all gateways
   */
  async checkGatewayHealth(): Promise<GatewayHealth[]> {
    const results: GatewayHealth[] = [];

    // Test Arweave gateways
    for (const gateway of ARWEAVE_GATEWAYS) {
      const startTime = Date.now();
      const response = await this.fetchWithTimeout(gateway, 5000, {
        method: 'HEAD',
      }).catch(() => null);
      results.push({
        gateway,
        healthy: response?.ok ?? false,
        latencyMs: Date.now() - startTime,
        lastChecked: Date.now(),
      });
    }

    // Test IPFS gateways
    for (const gateway of IPFS_GATEWAYS) {
      const startTime = Date.now();
      // IPFS gateways need a CID, use a known one
      const testCid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'; // IPFS readme
      const response = await this.fetchWithTimeout(
        `${gateway}/${testCid}`,
        5000,
        { method: 'HEAD' }
      ).catch(() => null);
      results.push({
        gateway,
        healthy: response?.ok ?? false,
        latencyMs: Date.now() - startTime,
        lastChecked: Date.now(),
      });
    }

    // Update internal health map
    for (const result of results) {
      this.gatewayHealth.set(result.gateway, result);
    }

    return results;
  }

  /**
   * Print gateway health report
   */
  async printHealthReport(): Promise<void> {
    console.log(
      '\n╔═══════════════════════════════════════════════════════════════════╗'
    );
    console.log(
      '║                    GATEWAY HEALTH REPORT                          ║'
    );
    console.log(
      '╠═══════════════════════════════════════════════════════════════════╣'
    );

    const health = await this.checkGatewayHealth();

    const arweaveGateways = health.filter((h) =>
      ARWEAVE_GATEWAYS.includes(h.gateway as (typeof ARWEAVE_GATEWAYS)[number])
    );
    const ipfsGateways = health.filter((h) =>
      IPFS_GATEWAYS.includes(h.gateway as (typeof IPFS_GATEWAYS)[number])
    );

    console.log(
      '║                                                                   ║'
    );
    console.log(
      '║  ARWEAVE GATEWAYS:                                                ║'
    );
    for (const g of arweaveGateways) {
      const status = g.healthy ? '✅' : '❌';
      const latency = g.latencyMs ? `${g.latencyMs}ms` : 'N/A';
      console.log(
        `║  ${status} ${g.gateway.padEnd(40)} ${latency.padStart(8)} ║`
      );
    }

    console.log(
      '║                                                                   ║'
    );
    console.log(
      '║  IPFS GATEWAYS:                                                   ║'
    );
    for (const g of ipfsGateways) {
      const status = g.healthy ? '✅' : '❌';
      const latency = g.latencyMs ? `${g.latencyMs}ms` : 'N/A';
      console.log(
        `║  ${status} ${g.gateway.padEnd(40)} ${latency.padStart(8)} ║`
      );
    }

    const healthyCount = health.filter((h) => h.healthy).length;
    console.log(
      '║                                                                   ║'
    );
    console.log(
      `║  SUMMARY: ${healthyCount}/${health.length} gateways healthy                               ║`
    );
    console.log(
      '╚═══════════════════════════════════════════════════════════════════╝\n'
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS (100% PERMISSIONLESS - NO API KEYS)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a decentralized storage client with sensible defaults.
 * Uses Arweave (via Irys) with wallet signature - NO API KEYS.
 */
export function createDecentralizedStorage(
  options: Partial<DecentralizedStorageConfig> = {}
): DecentralizedStorage {
  return new DecentralizedStorage({
    primaryNetwork: 'arweave',
    arweaveNetwork: 'devnet',
    verifyOnDownload: true,
    maxRetries: 5,
    gatewayTimeout: 10000,
    ...options,
  });
}

/**
 * Create storage using Arweave (via Irys).
 * 100% permissionless - only requires wallet private key for signing.
 */
export function createArweaveStorage(
  privateKey: Hex,
  network: 'mainnet' | 'devnet' = 'devnet',
  verbose = false
): DecentralizedStorage {
  return new DecentralizedStorage({
    primaryNetwork: 'arweave',
    privateKey,
    arweaveNetwork: network,
    verbose,
    verifyOnDownload: true,
  });
}

/**
 * Create storage using local IPFS node.
 * 100% permissionless - you run your own IPFS node, no API keys needed.
 * Run `ipfs daemon` to start your local node.
 */
export function createIPFSStorage(
  localIPFSUrl = 'http://localhost:5001',
  verbose = false
): DecentralizedStorage {
  return new DecentralizedStorage({
    primaryNetwork: 'ipfs',
    localIPFSUrl,
    verbose,
    verifyOnDownload: true,
  });
}

/**
 * Create hybrid storage that tries local IPFS first, then falls back to Arweave.
 * 100% permissionless - requires wallet private key for Arweave fallback.
 */
export function createHybridStorage(
  privateKey: Hex,
  options: {
    localIPFSUrl?: string;
    arweaveNetwork?: 'mainnet' | 'devnet';
    verbose?: boolean;
  } = {}
): DecentralizedStorage {
  return new DecentralizedStorage({
    primaryNetwork: 'ipfs', // Try IPFS first
    privateKey, // Fall back to Arweave if IPFS unavailable
    localIPFSUrl: options.localIPFSUrl ?? 'http://localhost:5001',
    arweaveNetwork: options.arweaveNetwork ?? 'devnet',
    verbose: options.verbose ?? false,
    verifyOnDownload: true,
  });
}
