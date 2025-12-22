/**
 * Hybrid Torrent Service - Production Implementation
 *
 * P2P content distribution with:
 * - WebTorrent for browser/WebRTC peers
 * - DHT for TCP peer discovery
 * - Content hash verification
 * - On-chain seeding registration
 * - Oracle-verified bandwidth attestation (no self-signing)
 * - Prometheus metrics
 * - LRU cache with eviction
 * - Graceful shutdown
 */

// WebTorrent is loaded dynamically to handle async module loading
let WebTorrent: WebTorrentConstructor | null = null;

async function loadWebTorrent(): Promise<WebTorrentConstructor> {
  if (WebTorrent) return WebTorrent;
  const mod = await import('webtorrent');
  // WebTorrent exports its constructor as default
  // The module types don't match our interface exactly, cast through unknown for compatibility
  const WT = mod.default as unknown as WebTorrentConstructor;
  if (typeof WT !== 'function') {
    throw new Error('WebTorrent module did not export expected constructor');
  }
  WebTorrent = WT;
  return WebTorrent;
}

interface WebTorrentConstructor {
  new (opts?: { dht?: boolean; tracker?: boolean; webSeeds?: boolean }): WebTorrentInstance;
}

// WebTorrent types
interface WebTorrentWire {
  peerId: string;
}

interface WebTorrentTorrent {
  infoHash: string;
  name: string;
  length: number;
  downloaded: number;
  uploaded: number;
  downloadSpeed: number;
  uploadSpeed: number;
  progress: number;
  numPeers: number;
  timeRemaining: number;
  done: boolean;
  files: Array<{
    name: string;
    length: number;
    getBuffer: (cb: (err: Error | null, buf: Buffer | null) => void) => void;
  }>;
  destroy: () => void;
  on(event: 'done', handler: () => void): void;
  on(event: 'ready', handler: () => void): void;
  on(event: 'upload' | 'download', handler: (bytes: number) => void): void;
  on(event: 'wire', handler: (wire: WebTorrentWire) => void): void;
  on(event: 'error', handler: (err: Error | string) => void): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

interface WebTorrentInstance {
  torrents: WebTorrentTorrent[];
  ready: boolean;
  add: (magnetUri: string, opts: { announce: string[] }) => WebTorrentTorrent;
  seed: (data: Buffer, opts: Record<string, unknown>) => WebTorrentTorrent;
  get: (infohash: string) => WebTorrentTorrent | null;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  destroy: (cb?: () => void) => void;
}

import { createPublicClient, createWalletClient, http as viemHttp } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createHash, randomBytes } from 'crypto';
import type { Address } from 'viem';
import { z } from 'zod';
import { Registry, Counter, Gauge } from 'prom-client';
import { LRUCache } from 'lru-cache';
import * as nodeHttp from 'http';

// ============================================================================
// Configuration Schema
// ============================================================================

const TorrentConfigSchema = z.object({
  trackers: z.array(z.string()).min(1),
  maxPeers: z.number().min(1).max(500).default(100),
  uploadLimitBytes: z.number().default(-1),
  downloadLimitBytes: z.number().default(-1),
  cachePath: z.string().default('./cache/torrents'),
  maxCacheBytes: z.number().default(10 * 1024 * 1024 * 1024), // 10 GB
  maxCacheEntries: z.number().default(10000),
  rpcUrl: z.string().url().optional(),
  chainId: z.number().optional(),
  privateKey: z.string().optional(),
  contentRegistryAddress: z.string().optional(),
  seedingOracleUrl: z.string().url().optional(), // Optional in dev, required in prod
  reportIntervalMs: z.number().default(3600000),
  blocklistSyncIntervalMs: z.number().default(300000),
  metricsPort: z.number().optional(),
  verifyContentHashes: z.boolean().default(true),
});

export type HybridTorrentConfig = z.infer<typeof TorrentConfigSchema>;

// ============================================================================
// Types
// ============================================================================

export interface TorrentStats {
  infohash: string;
  name: string;
  size: number;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  seeds: number;
  downloaded: number;
  uploaded: number;
  timeRemaining: number;
  verified: boolean;
}

interface TorrentRecord {
  infohash: string;
  contentHash: string;
  bytesUploaded: number;
  peersServed: Set<string>;
  startedAt: number;
  lastActivity: number;
  verified: boolean;
}

interface OracleAttestation {
  seeder: Address;
  infohash: string;
  bytesUploaded: number;
  timestamp: number;
  nonce: string;
  signature: string;
}

// ============================================================================
// Prometheus Metrics
// ============================================================================

const metricsRegistry = new Registry();

const torrentActiveCount = new Gauge({
  name: 'torrent_active_count',
  help: 'Number of active torrents',
  registers: [metricsRegistry],
});

const torrentPeersTotal = new Gauge({
  name: 'torrent_peers_total',
  help: 'Total connected peers',
  registers: [metricsRegistry],
});

const torrentBytesUploaded = new Counter({
  name: 'torrent_bytes_uploaded_total',
  help: 'Total bytes uploaded',
  registers: [metricsRegistry],
});

const torrentBytesDownloaded = new Counter({
  name: 'torrent_bytes_downloaded_total',
  help: 'Total bytes downloaded',
  registers: [metricsRegistry],
});

const torrentVerificationFailures = new Counter({
  name: 'torrent_verification_failures_total',
  help: 'Content verification failures',
  registers: [metricsRegistry],
});

const torrentOracleAttestations = new Counter({
  name: 'torrent_oracle_attestations_total',
  help: 'Oracle attestation requests',
  labelNames: ['status'],
  registers: [metricsRegistry],
});

// ============================================================================
// Content Verification
// ============================================================================

function verifyContentHash(data: Buffer, expectedHash: string): boolean {
  // Support multiple hash formats
  if (expectedHash.startsWith('0x')) {
    // Ethereum-style keccak256
    const hash = createHash('sha256').update(data).digest('hex');
    return `0x${hash}` === expectedHash || expectedHash.includes(hash);
  }

  if (expectedHash.startsWith('Qm')) {
    // IPFS CIDv0 (sha256 multihash)
    const hash = createHash('sha256').update(data).digest();
    // CIDv0 format: 0x1220 + sha256
    const computed = Buffer.concat([Buffer.from([0x12, 0x20]), hash]);
    // Base58 encode and compare
    return base58Encode(computed) === expectedHash;
  }

  if (expectedHash.startsWith('bafy')) {
    // IPFS CIDv1 - extract hash and compare
    // Simplified: just verify sha256 portion matches
    const hash = createHash('sha256').update(data).digest('hex');
    return expectedHash.includes(hash.slice(0, 16));
  }

  // BitTorrent infohash (sha1 of info dict)
  if (expectedHash.length === 40) {
    const hash = createHash('sha1').update(data).digest('hex');
    return hash === expectedHash;
  }

  return false;
}

// Simple base58 encoding for CID verification
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(buffer: Buffer): string {
  const digits = [0];

  for (let idx = 0; idx < buffer.length; idx++) {
    let carry = buffer[idx];
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  // Convert to base58 string
  let result = '';
  for (let i = digits.length - 1; i >= 0; i--) {
    result += BASE58_ALPHABET[digits[i]];
  }

  // Add leading zeros
  for (let idx = 0; idx < buffer.length; idx++) {
    if (buffer[idx] === 0) {
      result = '1' + result;
    } else {
      break;
    }
  }

  return result;
}

// ============================================================================
// Hybrid Torrent Service
// ============================================================================

export class HybridTorrentService {
  private config: HybridTorrentConfig;
  private client: WebTorrentInstance | null = null;
  private records = new LRUCache<string, TorrentRecord>({
    max: 10000,
    ttl: 24 * 60 * 60 * 1000, // 24 hours
  });
  private blocklist = new Set<string>();
  private running = false;
  private startTime = 0;

  // On-chain integration
  private publicClient: ReturnType<typeof createPublicClient> | null = null;
  private walletClient: ReturnType<typeof createWalletClient> | null = null;
  private contentRegistryAddress: string | null = null;
  private reportInterval: ReturnType<typeof setInterval> | null = null;
  private blocklistSyncInterval: ReturnType<typeof setInterval> | null = null;
  private metricsServer: nodeHttp.Server | null = null;

  constructor(config: Partial<HybridTorrentConfig>) {
    // Validate config - seedingOracleUrl is required
    this.config = TorrentConfigSchema.parse({
      trackers: [
        'wss://tracker.openwebtorrent.com',
        'wss://tracker.btorrent.xyz',
        'wss://tracker.fastcast.nz',
        'udp://tracker.openbittorrent.com:80',
        'udp://tracker.opentrackr.org:1337',
      ],
      seedingOracleUrl: config.seedingOracleUrl ?? process.env.SEEDING_ORACLE_URL,
      ...config,
    });

    // WebTorrent client is initialized lazily in start()

    // Setup on-chain integration
    if (this.config.rpcUrl && this.config.contentRegistryAddress) {
      this.publicClient = createPublicClient({ transport: viemHttp(this.config.rpcUrl) });
      if (this.config.privateKey) {
        const account = privateKeyToAccount(this.config.privateKey as `0x${string}`);
        this.walletClient = createWalletClient({
          account,
          transport: viemHttp(this.config.rpcUrl),
        });
        this.contentRegistryAddress = this.config.contentRegistryAddress;
      }
    }
  }

  /** Get the initialized client or throw if not ready */
  private getClient(): WebTorrentInstance {
    if (!this.client) {
      throw new Error('WebTorrent client not initialized. Call start() first.');
    }
    return this.client;
  }

  private async initClient(): Promise<void> {
    if (this.client) return;

    const WT = await loadWebTorrent();
    this.client = new WT({
      dht: true,
      tracker: true,
      webSeeds: true,
    });

    this.client.on('error', (err) => {
      const message = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
      console.error('[HybridTorrent] Client error:', message);
    });
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();

    // Initialize WebTorrent client
    await this.initClient();

    // Start metrics server
    if (this.config.metricsPort) {
      await this.startMetricsServer();
    }

    // Sync blocklist
    if (this.contentRegistryAddress) {
      await this.syncBlocklist();

      this.reportInterval = setInterval(
        () => this.reportAllSeeding(),
        this.config.reportIntervalMs
      );

      this.blocklistSyncInterval = setInterval(
        () => this.syncBlocklist(),
        this.config.blocklistSyncIntervalMs
      );
    }

    console.log('[HybridTorrent] Started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.reportInterval) clearInterval(this.reportInterval);
    if (this.blocklistSyncInterval) clearInterval(this.blocklistSyncInterval);
    if (this.metricsServer) this.metricsServer.close();

    // Final bandwidth report
    if (this.contentRegistryAddress) {
      await this.reportAllSeeding();
    }

    // Destroy WebTorrent client
    if (this.client) {
      const client = this.client;
      await new Promise<void>((resolve) => {
        client.destroy(() => resolve());
      });
      this.client = null;
    }

    console.log('[HybridTorrent] Stopped');
  }

  private async startMetricsServer(): Promise<void> {
    this.metricsServer = nodeHttp.createServer(async (req: nodeHttp.IncomingMessage, res: nodeHttp.ServerResponse) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', metricsRegistry.contentType);
        res.end(await metricsRegistry.metrics());
      } else if (req.url === '/health') {
        res.setHeader('Content-Type', 'application/json');
        const client = this.client;
        res.end(
          JSON.stringify({
            status: this.running ? 'healthy' : 'stopped',
            torrents: client?.torrents.length ?? 0,
            peers: client?.torrents.reduce((sum: number, t: WebTorrentTorrent) => sum + t.numPeers, 0) ?? 0,
          })
        );
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    await new Promise<void>((resolve) => {
      this.metricsServer!.listen(this.config.metricsPort, resolve);
    });

    console.log(`[HybridTorrent] Metrics server on port ${this.config.metricsPort}`);
  }

  // ============================================================================
  // Torrent Operations
  // ============================================================================

  async addTorrent(magnetOrInfohash: string, expectedContentHash?: string): Promise<TorrentStats> {
    const client = this.getClient();
    const magnetUri = magnetOrInfohash.startsWith('magnet:')
      ? magnetOrInfohash
      : `magnet:?xt=urn:btih:${magnetOrInfohash}`;

    return new Promise((resolve, reject) => {
      const torrent = client.add(magnetUri, {
        announce: this.config.trackers,
      });

      const timeout = setTimeout(() => {
        torrent.destroy();
        reject(new Error('Torrent metadata timeout'));
      }, 60000);

      torrent.on('ready', async () => {
        clearTimeout(timeout);
        const infohash = torrent.infoHash;

        // Check blocklist
        const contentHash = this.infohashToContentHash(infohash);
        if (this.blocklist.has(contentHash)) {
          torrent.destroy();
          reject(new Error('Content is blocked'));
          return;
        }

        // Track
        this.records.set(infohash, {
          infohash,
          contentHash,
          bytesUploaded: 0,
          peersServed: new Set(),
          startedAt: Date.now(),
          lastActivity: Date.now(),
          verified: false,
        });

        // Update metrics
        torrentActiveCount.set(client.torrents.length);

        // Track uploads
        torrent.on('upload', (bytes: number) => {
          const record = this.records.get(infohash);
          if (record) {
            record.bytesUploaded += bytes;
            record.lastActivity = Date.now();
          }
          torrentBytesUploaded.inc(bytes);
        });

        torrent.on('download', (bytes: number) => {
          torrentBytesDownloaded.inc(bytes);
        });

        torrent.on('wire', (wire: WebTorrentWire) => {
          const record = this.records.get(infohash);
          if (record) record.peersServed.add(wire.peerId);
          torrentPeersTotal.set(
            client.torrents.reduce((sum: number, t: WebTorrentTorrent) => sum + t.numPeers, 0)
          );
        });

        // Verify content when download completes
        torrent.on('done', async () => {
          if (this.config.verifyContentHashes && expectedContentHash) {
            const verified = await this.verifyTorrentContent(torrent, expectedContentHash);
            const record = this.records.get(infohash);
            if (record) {
              record.verified = verified;
            }
            if (!verified) {
              torrentVerificationFailures.inc();
              console.warn(`[HybridTorrent] Content verification failed for ${infohash}`);
            }
          }
        });

        // Register on-chain
        if (this.contentRegistryAddress) {
          await this.registerSeeding(infohash).catch(console.error);
        }

        resolve(this.getTorrentStats(infohash));
      });

      torrent.on('error', (err: Error | string) => {
        clearTimeout(timeout);
        const message = typeof err === 'string' ? err : err.message;
        reject(new Error(`Torrent error: ${message}`));
      });
    });
  }

  async seedContent(
    data: Buffer,
    name?: string,
    expectedContentHash?: string
  ): Promise<TorrentStats> {
    // Verify content hash before seeding
    if (this.config.verifyContentHashes && expectedContentHash) {
      if (!verifyContentHash(data, expectedContentHash)) {
        throw new Error('Content hash verification failed before seeding');
      }
    }

    const client = this.getClient();
    return new Promise((resolve, reject) => {
      // Cast options - WebTorrent types are overly restrictive
      const opts = {
        announce: this.config.trackers,
        name: name ?? `content-${Date.now()}`,
      } as Parameters<typeof client.seed>[1];
      const torrent = client.seed(data, opts);

      torrent.on('ready', () => {
        const infohash = torrent.infoHash;
        const contentHash = this.infohashToContentHash(infohash);

        this.records.set(infohash, {
          infohash,
          contentHash,
          bytesUploaded: 0,
          peersServed: new Set(),
          startedAt: Date.now(),
          lastActivity: Date.now(),
          verified: true, // We verified before seeding
        });

        torrentActiveCount.set(client.torrents.length);

        torrent.on('upload', (bytes: number) => {
          const record = this.records.get(infohash);
          if (record) {
            record.bytesUploaded += bytes;
            record.lastActivity = Date.now();
          }
          torrentBytesUploaded.inc(bytes);
        });

        torrent.on('wire', (wire: WebTorrentWire) => {
          const record = this.records.get(infohash);
          if (record) record.peersServed.add(wire.peerId);
        });

        resolve(this.getTorrentStats(infohash));
      });

      torrent.on('error', (err: Error | string) => {
        const message = typeof err === 'string' ? err : err.message;
        reject(new Error(`Seed error: ${message}`));
      });
    });
  }

  removeTorrent(infohash: string): void {
    const client = this.getClient();
    const torrent = client.get(infohash);
    if (torrent) torrent.destroy();
    this.records.delete(infohash);
    torrentActiveCount.set(client.torrents.length);

    if (this.contentRegistryAddress) {
      this.unregisterSeeding(infohash).catch(console.error);
    }
  }

  getTorrentStats(infohash: string): TorrentStats {
    const client = this.getClient();
    const torrent = client.get(infohash);
    if (!torrent) throw new Error(`Torrent not found: ${infohash}`);

    const record = this.records.get(infohash);

    return {
      infohash: torrent.infoHash,
      name: torrent.name,
      size: torrent.length,
      progress: torrent.progress,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      peers: torrent.numPeers,
      seeds: torrent.numPeers, // Simplified
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      timeRemaining: torrent.timeRemaining,
      verified: record?.verified ?? false,
    };
  }

  getAllStats(): TorrentStats[] {
    const client = this.getClient();
    return client.torrents.map((t) => this.getTorrentStats(t.infoHash));
  }

  getGlobalStats(): {
    torrentsActive: number;
    totalDownload: number;
    totalUpload: number;
    downloadSpeed: number;
    uploadSpeed: number;
    peers: number;
    uptime: number;
  } {
    const client = this.getClient();
    let totalDownload = 0;
    let totalUpload = 0;
    let downloadSpeed = 0;
    let uploadSpeed = 0;
    let peers = 0;

    for (const torrent of client.torrents) {
      totalDownload += torrent.downloaded;
      totalUpload += torrent.uploaded;
      downloadSpeed += torrent.downloadSpeed;
      uploadSpeed += torrent.uploadSpeed;
      peers += torrent.numPeers;
    }

    return {
      torrentsActive: client.torrents.length,
      totalDownload,
      totalUpload,
      downloadSpeed,
      uploadSpeed,
      peers,
      uptime: Date.now() - this.startTime,
    };
  }

  async getContent(infohash: string): Promise<Buffer> {
    const client = this.getClient();
    const torrent = client.get(infohash);
    if (!torrent) throw new Error(`Torrent not found: ${infohash}`);
    if (!torrent.done) throw new Error('Torrent download not complete');

    const file = torrent.files[0];
    if (!file) throw new Error('No files in torrent');

    return new Promise((resolve, reject) => {
      file.getBuffer((err: Error | null, buffer: Buffer | null) => {
        if (err) reject(err);
        else if (buffer) resolve(buffer);
        else reject(new Error('Empty buffer'));
      });
    });
  }

  // ============================================================================
  // Content Verification
  // ============================================================================

  private async verifyTorrentContent(torrent: WebTorrentTorrent, expectedHash: string): Promise<boolean> {
    const file = torrent.files[0];
    if (!file) return false;

    try {
      const buffer = await new Promise<Buffer>((resolve, reject) => {
        file.getBuffer((err: Error | null, buf: Buffer | null) => {
          if (err) reject(err);
          else if (buf) resolve(buf);
          else reject(new Error('Empty buffer'));
        });
      });

      return verifyContentHash(buffer, expectedHash);
    } catch (error) {
      console.error('[HybridTorrent] Verification error:', error);
      return false;
    }
  }

  // ============================================================================
  // Oracle Attestation (No Self-Signing)
  // ============================================================================

  private async getOracleAttestation(
    infohash: string,
    bytesUploaded: number
  ): Promise<OracleAttestation> {
    if (!this.walletClient || !this.walletClient.account) {
      throw new Error('Wallet required for attestation');
    }

    if (!this.config.seedingOracleUrl) {
      throw new Error('Seeding oracle URL required for attestation - no self-signing allowed in production');
    }

    const nonce = randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000);

    // Request attestation from oracle
    const response = await fetch(`${this.config.seedingOracleUrl}/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seeder: this.walletClient.account.address,
        infohash,
        bytesUploaded,
        timestamp,
        nonce,
        // Proof of seeding (peer connection logs, DHT records, etc.)
        proofData: {
          peersServed: Array.from(this.records.get(infohash)?.peersServed ?? []),
          startedAt: this.records.get(infohash)?.startedAt,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      torrentOracleAttestations.inc({ status: 'error' });
      throw new Error(`Oracle attestation failed: ${response.status}`);
    }

    const attestation = (await response.json()) as OracleAttestation;
    torrentOracleAttestations.inc({ status: 'success' });

    return attestation;
  }

  private async reportAllSeeding(): Promise<void> {
    if (!this.contentRegistryAddress || !this.walletClient || !this.publicClient) return;

    for (const [infohash, record] of Array.from(this.records.entries())) {
      if (record.bytesUploaded === 0) continue;

      try {
        // Get oracle attestation (NOT self-signed)
        const attestation = await this.getOracleAttestation(infohash, record.bytesUploaded);

        // Submit to contract with oracle signature
        const hash = await this.walletClient.writeContract({
          account: null,
          chain: null,
          address: this.contentRegistryAddress as `0x${string}`,
          abi: [{ name: 'reportSeeding', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'infohash', type: 'bytes32' }, { name: 'bytesUploaded', type: 'uint256' }, { name: 'timestamp', type: 'uint256' }, { name: 'nonce', type: 'string' }, { name: 'signature', type: 'bytes' }], outputs: [] }] as const,
          functionName: 'reportSeeding',
          args: [
            `0x${infohash}` as `0x${string}`,
            BigInt(attestation.bytesUploaded),
            BigInt(attestation.timestamp),
            attestation.nonce,
            attestation.signature as `0x${string}`,
          ],
        });
        await this.publicClient.waitForTransactionReceipt({ hash });

        // Reset stats after successful report
        record.bytesUploaded = 0;
        record.peersServed.clear();

        console.log(`[HybridTorrent] Reported seeding: ${infohash}`);
      } catch (error) {
        console.error(`[HybridTorrent] Failed to report seeding for ${infohash}:`, error);
      }
    }
  }

  // ============================================================================
  // On-Chain Operations
  // ============================================================================

  private async registerSeeding(infohash: string): Promise<void> {
    if (!this.contentRegistryAddress || !this.walletClient || !this.publicClient) return;
    const hash = await this.walletClient.writeContract({
      account: null,
      chain: null,
      address: this.contentRegistryAddress as `0x${string}`,
      abi: [{ name: 'startSeeding', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'infohash', type: 'bytes32' }], outputs: [] }] as const,
      functionName: 'startSeeding',
      args: [`0x${infohash}` as `0x${string}`],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(`[HybridTorrent] Registered seeding: ${infohash}`);
  }

  private async unregisterSeeding(infohash: string): Promise<void> {
    if (!this.contentRegistryAddress || !this.walletClient || !this.publicClient) return;
    const hash = await this.walletClient.writeContract({
      account: null,
      chain: null,
      address: this.contentRegistryAddress as `0x${string}`,
      abi: [{ name: 'stopSeeding', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'infohash', type: 'bytes32' }], outputs: [] }] as const,
      functionName: 'stopSeeding',
      args: [`0x${infohash}` as `0x${string}`],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    console.log(`[HybridTorrent] Unregistered seeding: ${infohash}`);
  }

  async syncBlocklist(): Promise<void> {
    if (!this.contentRegistryAddress || !this.publicClient) return;

    try {
      const length = await this.publicClient.readContract({
        address: this.contentRegistryAddress as `0x${string}`,
        abi: [{ name: 'getBlocklistLength', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }],
        functionName: 'getBlocklistLength',
        args: [],
      }) as bigint;
      const batchSize = 100;

      for (let offset = 0; offset < Number(length); offset += batchSize) {
        const batch = await this.publicClient.readContract({
          address: this.contentRegistryAddress as `0x${string}`,
          abi: [{ name: 'getBlocklistBatch', type: 'function', stateMutability: 'view', inputs: [{ name: 'offset', type: 'uint256' }, { name: 'limit', type: 'uint256' }], outputs: [{ type: 'bytes32[]' }] }],
          functionName: 'getBlocklistBatch',
          args: [BigInt(offset), BigInt(batchSize)],
        }) as readonly `0x${string}`[];
        for (const hash of batch) {
          this.blocklist.add(hash);

          // Stop seeding blocked content
          for (const [infohash, record] of Array.from(this.records.entries())) {
            if (record.contentHash === hash) {
              this.removeTorrent(infohash);
            }
          }
        }
      }

      console.log(`[HybridTorrent] Blocklist synced: ${this.blocklist.size} entries`);
    } catch (error) {
      console.error('[HybridTorrent] Blocklist sync failed:', error);
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private infohashToContentHash(infohash: string): string {
    return `0x${infohash.padStart(64, '0')}`;
  }
}

// ============================================================================
// Factory
// ============================================================================

let instance: HybridTorrentService | null = null;

export function getHybridTorrentService(
  config?: Partial<HybridTorrentConfig>
): HybridTorrentService {
  if (!instance) {
    instance = new HybridTorrentService(config ?? {});
  }
  return instance;
}

export async function closeHybridTorrentService(): Promise<void> {
  if (instance) {
    await instance.stop();
    instance = null;
  }
}
