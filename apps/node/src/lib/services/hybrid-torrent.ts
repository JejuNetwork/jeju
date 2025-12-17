/**
 * Hybrid Torrent Service
 *
 * Uses WebTorrent with DHT enabled for peer discovery.
 * Supports both WebRTC (browser) and TCP (node) peers.
 */

import WebTorrent, { type Torrent } from 'webtorrent';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { createHash } from 'crypto';
import type { Address } from 'viem';
import { CONTENT_REGISTRY_ABI } from '../abis';

// ============================================================================
// Types
// ============================================================================

export interface HybridTorrentConfig {
  trackers: string[];
  maxPeers: number;
  uploadLimitBytes: number;
  downloadLimitBytes: number;
  cachePath: string;
  maxCacheBytes: number;
  // On-chain integration
  rpcUrl?: string;
  privateKey?: string;
  contentRegistryAddress?: Address;
  seedingOracleUrl?: string;
  reportIntervalMs?: number;
  blocklistSyncIntervalMs?: number;
}

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
}

interface TorrentRecord {
  infohash: string;
  contentHash: string;
  bytesUploaded: number;
  peersServed: Set<string>;
  startedAt: number;
  lastActivity: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: HybridTorrentConfig = {
  trackers: [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.fastcast.nz',
  ],
  maxPeers: 100,
  uploadLimitBytes: -1,
  downloadLimitBytes: -1,
  cachePath: './cache/torrents',
  maxCacheBytes: 10 * 1024 * 1024 * 1024,
  reportIntervalMs: 3600000, // 1 hour
  blocklistSyncIntervalMs: 300000, // 5 min
};

// ============================================================================
// Hybrid Torrent Service
// ============================================================================

export class HybridTorrentService {
  private config: HybridTorrentConfig;
  private client: WebTorrent.Instance;
  private records: Map<string, TorrentRecord> = new Map();
  private blocklist: Set<string> = new Set();
  private running = false;
  private startTime = 0;

  // On-chain integration
  private provider: JsonRpcProvider | null = null;
  private wallet: Wallet | null = null;
  private contentRegistry: Contract | null = null;
  private reportInterval: ReturnType<typeof setInterval> | null = null;
  private blocklistSyncInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<HybridTorrentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.client = new WebTorrent({
      dht: true,
      tracker: { announce: this.config.trackers },
      maxConns: this.config.maxPeers,
      uploadLimit: this.config.uploadLimitBytes,
      downloadLimit: this.config.downloadLimitBytes,
    });

    this.client.on('error', (err) => {
      console.error('[HybridTorrent] Error:', err.message);
    });

    // Setup on-chain integration if configured
    if (config.rpcUrl && config.contentRegistryAddress) {
      this.provider = new JsonRpcProvider(config.rpcUrl);
      if (config.privateKey) {
        this.wallet = new Wallet(config.privateKey, this.provider);
        this.contentRegistry = new Contract(
          config.contentRegistryAddress,
          CONTENT_REGISTRY_ABI,
          this.wallet
        );
      }
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();

    // Sync blocklist if registry available
    if (this.contentRegistry) {
      await this.syncBlocklist();

      this.reportInterval = setInterval(
        () => this.reportAllSeeding(),
        this.config.reportIntervalMs ?? 3600000
      );

      this.blocklistSyncInterval = setInterval(
        () => this.syncBlocklist(),
        this.config.blocklistSyncIntervalMs ?? 300000
      );
    }

    console.log('[HybridTorrent] Started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.reportInterval) clearInterval(this.reportInterval);
    if (this.blocklistSyncInterval) clearInterval(this.blocklistSyncInterval);

    // Final report
    if (this.contentRegistry) {
      await this.reportAllSeeding();
    }

    await new Promise<void>((resolve) => {
      this.client.destroy(() => resolve());
    });

    console.log('[HybridTorrent] Stopped');
  }

  /**
   * Add torrent and start downloading
   */
  async addTorrent(magnetOrInfohash: string): Promise<TorrentStats> {
    const magnetUri = magnetOrInfohash.startsWith('magnet:')
      ? magnetOrInfohash
      : `magnet:?xt=urn:btih:${magnetOrInfohash}`;

    return new Promise((resolve, reject) => {
      const torrent = this.client.add(magnetUri, {
        announce: this.config.trackers,
      });

      torrent.on('ready', () => {
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
        });

        // Track uploads
        torrent.on('upload', (bytes) => {
          const record = this.records.get(infohash);
          if (record) {
            record.bytesUploaded += bytes;
            record.lastActivity = Date.now();
          }
        });

        torrent.on('wire', (wire) => {
          const record = this.records.get(infohash);
          if (record) record.peersServed.add(wire.peerId);
        });

        // Register on-chain
        if (this.contentRegistry) {
          this.registerSeeding(infohash).catch(console.error);
        }

        resolve(this.getTorrentStats(infohash));
      });

      torrent.on('error', (err) => {
        reject(new Error(`Failed to add torrent: ${err.message}`));
      });
    });
  }

  /**
   * Seed content
   */
  async seedContent(data: Buffer, name?: string): Promise<TorrentStats> {
    return new Promise((resolve, reject) => {
      const torrent = this.client.seed(data, {
        announce: this.config.trackers,
        name: name ?? 'content',
      });

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
        });

        torrent.on('upload', (bytes) => {
          const record = this.records.get(infohash);
          if (record) {
            record.bytesUploaded += bytes;
            record.lastActivity = Date.now();
          }
        });

        torrent.on('wire', (wire) => {
          const record = this.records.get(infohash);
          if (record) record.peersServed.add(wire.peerId);
        });

        resolve(this.getTorrentStats(infohash));
      });

      torrent.on('error', (err) => {
        reject(new Error(`Failed to seed: ${err.message}`));
      });
    });
  }

  /**
   * Remove torrent
   */
  removeTorrent(infohash: string): void {
    const torrent = this.client.get(infohash);
    if (torrent) torrent.destroy();
    this.records.delete(infohash);

    if (this.contentRegistry) {
      this.unregisterSeeding(infohash).catch(console.error);
    }
  }

  /**
   * Get stats for a torrent
   */
  getTorrentStats(infohash: string): TorrentStats {
    const torrent = this.client.get(infohash);
    if (!torrent) throw new Error(`Torrent not found: ${infohash}`);

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
    };
  }

  /**
   * Get all torrent stats
   */
  getAllStats(): TorrentStats[] {
    return this.client.torrents.map((t) => this.getTorrentStats(t.infoHash));
  }

  /**
   * Get global stats
   */
  getGlobalStats(): {
    torrentsActive: number;
    totalDownload: number;
    totalUpload: number;
    downloadSpeed: number;
    uploadSpeed: number;
    peers: number;
    uptime: number;
    pendingRewards: bigint;
  } {
    let totalDownload = 0;
    let totalUpload = 0;
    let downloadSpeed = 0;
    let uploadSpeed = 0;
    let peers = 0;

    for (const torrent of this.client.torrents) {
      totalDownload += torrent.downloaded;
      totalUpload += torrent.uploaded;
      downloadSpeed += torrent.downloadSpeed;
      uploadSpeed += torrent.uploadSpeed;
      peers += torrent.numPeers;
    }

    return {
      torrentsActive: this.client.torrents.length,
      totalDownload,
      totalUpload,
      downloadSpeed,
      uploadSpeed,
      peers,
      uptime: Date.now() - this.startTime,
      pendingRewards: 0n, // Would query from contract
    };
  }

  /**
   * Get content buffer from torrent
   */
  async getContent(infohash: string): Promise<Buffer> {
    const torrent = this.client.get(infohash);
    if (!torrent) throw new Error(`Torrent not found: ${infohash}`);
    if (!torrent.done) throw new Error('Torrent download not complete');

    const file = torrent.files[0];
    if (!file) throw new Error('No files in torrent');

    return new Promise((resolve, reject) => {
      file.getBuffer((err, buffer) => {
        if (err) reject(err);
        else if (buffer) resolve(buffer);
        else reject(new Error('Empty buffer'));
      });
    });
  }

  // ============================================================================
  // On-Chain Integration
  // ============================================================================

  private async registerSeeding(infohash: string): Promise<void> {
    if (!this.contentRegistry) return;
    const tx = await this.contentRegistry.startSeeding(`0x${infohash}`);
    await tx.wait();
    console.log(`[HybridTorrent] Registered seeding: ${infohash}`);
  }

  private async unregisterSeeding(infohash: string): Promise<void> {
    if (!this.contentRegistry) return;
    const tx = await this.contentRegistry.stopSeeding(`0x${infohash}`);
    await tx.wait();
    console.log(`[HybridTorrent] Unregistered seeding: ${infohash}`);
  }

  private async reportAllSeeding(): Promise<void> {
    if (!this.contentRegistry || !this.wallet) return;

    for (const [infohash, record] of this.records) {
      if (record.bytesUploaded === 0) continue;

      const signature = await this.getOracleSignature(infohash, record.bytesUploaded);

      const tx = await this.contentRegistry.reportSeeding(
        `0x${infohash}`,
        record.bytesUploaded,
        signature
      );
      await tx.wait();

      // Reset stats
      record.bytesUploaded = 0;
      record.peersServed.clear();
    }
  }

  private async getOracleSignature(infohash: string, bytesUploaded: number): Promise<string> {
    if (!this.wallet) throw new Error('Wallet required for signing');

    if (!this.config.seedingOracleUrl) {
      // Self-sign for testing
      const messageHash = createHash('sha256')
        .update(`${this.wallet.address}${infohash}${bytesUploaded}${Math.floor(Date.now() / 3600000)}`)
        .digest('hex');
      return this.wallet.signMessage(messageHash);
    }

    const response = await fetch(`${this.config.seedingOracleUrl}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seeder: this.wallet.address,
        infohash,
        bytesUploaded,
        timestamp: Math.floor(Date.now() / 3600000),
      }),
    });

    const data = (await response.json()) as { signature: string };
    return data.signature;
  }

  async syncBlocklist(): Promise<void> {
    if (!this.contentRegistry) return;

    const length = await this.contentRegistry.getBlocklistLength();
    const batchSize = 100;

    for (let offset = 0; offset < length; offset += batchSize) {
      const batch = await this.contentRegistry.getBlocklistBatch(offset, batchSize);
      for (const hash of batch) {
        this.blocklist.add(hash);

        // Stop seeding blocked content
        for (const [infohash, record] of this.records) {
          if (record.contentHash === hash) {
            this.removeTorrent(infohash);
          }
        }
      }
    }

    console.log(`[HybridTorrent] Blocklist synced: ${this.blocklist.size} entries`);
  }

  private infohashToContentHash(infohash: string): string {
    return `0x${infohash.padStart(64, '0')}`;
  }
}

// ============================================================================
// Factory
// ============================================================================

let globalService: HybridTorrentService | null = null;

export function getHybridTorrentService(
  config?: Partial<HybridTorrentConfig>
): HybridTorrentService {
  if (!globalService) {
    globalService = new HybridTorrentService(config);
  }
  return globalService;
}

export function resetHybridTorrentService(): void {
  if (globalService) {
    globalService.stop();
    globalService = null;
  }
}
