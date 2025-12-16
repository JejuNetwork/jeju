/**
 * Torrent Seeder Service
 *
 * Runs as part of the node app to:
 * - Seed content for the network
 * - Track bandwidth served
 * - Report to on-chain registry for rewards
 * - Sync blocklist and refuse to serve banned content
 */

import WebTorrent, { type Torrent } from 'webtorrent';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { createHash } from 'crypto';
import type { Address } from '../../../../../packages/types/src';
import { CONTENT_REGISTRY_ABI } from '../../../../../packages/types/src';

// ============ Types ============

interface SeederConfig {
  rpcUrl: string;
  privateKey: string;
  contentRegistryAddress: Address;
  seedingOracleUrl?: string;
  maxTorrents: number;
  maxUploadRate: number;
  reportIntervalMs: number;
  blocklistSyncIntervalMs: number;
}

interface TorrentRecord {
  infohash: string;
  contentHash: string;
  bytesUploaded: number;
  peersServed: Set<string>;
  startedAt: number;
  lastActivity: number;
}

interface SeederStats {
  torrentsSeeding: number;
  totalBytesUploaded: number;
  totalPeersServed: number;
  pendingRewards: bigint;
  uptime: number;
}

// ============ TorrentSeederService ============

export class TorrentSeederService {
  private client: WebTorrent.Instance;
  private config: SeederConfig;
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private contentRegistry: Contract;

  private torrents: Map<string, TorrentRecord> = new Map();
  private blocklist: Set<string> = new Set();
  private startTime: number = Date.now();
  private reportInterval: ReturnType<typeof setInterval> | null = null;
  private blocklistSyncInterval: ReturnType<typeof setInterval> | null = null;
  private running: boolean = false;

  constructor(config: SeederConfig) {
    this.config = config;

    this.client = new WebTorrent({
      dht: true,
      maxConns: 55,
      uploadLimit: config.maxUploadRate,
    });

    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);
    this.contentRegistry = new Contract(
      config.contentRegistryAddress,
      CONTENT_REGISTRY_ABI,
      this.wallet
    );

    this.client.on('error', (err) => {
      console.error('[TorrentSeeder] Client error:', err.message);
    });
  }

  // ============ Lifecycle ============

  async start(): Promise<void> {
    if (this.running) return;

    console.log('[TorrentSeeder] Starting...');
    this.running = true;
    this.startTime = Date.now();

    // Sync blocklist
    await this.syncBlocklist();

    // Start periodic reporting
    this.reportInterval = setInterval(
      () => this.reportAllSeeding(),
      this.config.reportIntervalMs
    );

    // Start blocklist sync
    this.blocklistSyncInterval = setInterval(
      () => this.syncBlocklist(),
      this.config.blocklistSyncIntervalMs
    );

    console.log('[TorrentSeeder] Started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    console.log('[TorrentSeeder] Stopping...');
    this.running = false;

    if (this.reportInterval) {
      clearInterval(this.reportInterval);
      this.reportInterval = null;
    }

    if (this.blocklistSyncInterval) {
      clearInterval(this.blocklistSyncInterval);
      this.blocklistSyncInterval = null;
    }

    // Final report before shutdown
    await this.reportAllSeeding();

    // Destroy client
    await new Promise<void>((resolve) => {
      this.client.destroy(() => resolve());
    });

    console.log('[TorrentSeeder] Stopped');
  }

  // ============ Seeding Operations ============

  async addTorrent(magnetUri: string): Promise<string> {
    if (this.torrents.size >= this.config.maxTorrents) {
      throw new Error('Max torrents reached');
    }

    return new Promise((resolve, reject) => {
      const torrent = this.client.add(magnetUri);

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
        this.torrents.set(infohash, {
          infohash,
          contentHash,
          bytesUploaded: 0,
          peersServed: new Set(),
          startedAt: Date.now(),
          lastActivity: Date.now(),
        });

        // Track uploads
        torrent.on('upload', (bytes) => {
          const record = this.torrents.get(infohash);
          if (record) {
            record.bytesUploaded += bytes;
            record.lastActivity = Date.now();
          }
        });

        torrent.on('wire', (wire) => {
          const record = this.torrents.get(infohash);
          if (record) {
            record.peersServed.add(wire.peerId);
          }
        });

        // Register on-chain
        this.registerSeeding(infohash).catch(console.error);

        resolve(infohash);
      });

      torrent.on('error', (err) => {
        reject(new Error(`Failed to add torrent: ${err.message}`));
      });
    });
  }

  removeTorrent(infohash: string): void {
    const torrent = this.client.get(infohash);
    if (torrent) {
      torrent.destroy();
    }
    this.torrents.delete(infohash);

    // Unregister on-chain
    this.unregisterSeeding(infohash).catch(console.error);
  }

  // ============ On-Chain Operations ============

  private async registerSeeding(infohash: string): Promise<void> {
    const tx = await this.contentRegistry.startSeeding(`0x${infohash}`);
    await tx.wait();
    console.log(`[TorrentSeeder] Registered seeding: ${infohash}`);
  }

  private async unregisterSeeding(infohash: string): Promise<void> {
    const tx = await this.contentRegistry.stopSeeding(`0x${infohash}`);
    await tx.wait();
    console.log(`[TorrentSeeder] Unregistered seeding: ${infohash}`);
  }

  private async reportAllSeeding(): Promise<void> {
    for (const [infohash, record] of this.torrents) {
      if (record.bytesUploaded === 0) continue;

      // Get oracle signature (would call oracle service)
      const signature = await this.getOracleSignature(infohash, record.bytesUploaded);

      const tx = await this.contentRegistry.reportSeeding(
        `0x${infohash}`,
        record.bytesUploaded,
        signature
      );
      await tx.wait();

      // Reset stats after reporting
      record.bytesUploaded = 0;
      record.peersServed.clear();
    }
  }

  private async getOracleSignature(
    infohash: string,
    bytesUploaded: number
  ): Promise<string> {
    if (!this.config.seedingOracleUrl) {
      // Self-sign for testing (not valid for rewards in production)
      const messageHash = this.hashMessage(
        this.wallet.address,
        infohash,
        bytesUploaded
      );
      return this.wallet.signMessage(messageHash);
    }

    // Call oracle service
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

    const data = await response.json() as { signature: string };
    return data.signature;
  }

  // ============ Blocklist ============

  async syncBlocklist(): Promise<void> {
    const length = await this.contentRegistry.getBlocklistLength();
    const batchSize = 100;

    for (let offset = 0; offset < length; offset += batchSize) {
      const batch = await this.contentRegistry.getBlocklistBatch(offset, batchSize);
      for (const hash of batch) {
        this.blocklist.add(hash);

        // Stop seeding if we're seeding blocked content
        for (const [infohash, record] of this.torrents) {
          if (record.contentHash === hash) {
            this.removeTorrent(infohash);
          }
        }
      }
    }

    console.log(`[TorrentSeeder] Blocklist synced: ${this.blocklist.size} entries`);
  }

  // ============ Stats ============

  getStats(): SeederStats {
    let totalBytesUploaded = 0;
    let totalPeersServed = 0;

    for (const record of this.torrents.values()) {
      totalBytesUploaded += record.bytesUploaded;
      totalPeersServed += record.peersServed.size;
    }

    // Add client-level stats
    for (const torrent of this.client.torrents) {
      totalBytesUploaded += torrent.uploaded;
    }

    return {
      torrentsSeeding: this.torrents.size,
      totalBytesUploaded,
      totalPeersServed,
      pendingRewards: 0n, // Would query from contract
      uptime: Date.now() - this.startTime,
    };
  }

  getTorrentList(): Array<{
    infohash: string;
    bytesUploaded: number;
    peersServed: number;
    startedAt: number;
  }> {
    return Array.from(this.torrents.values()).map((record) => ({
      infohash: record.infohash,
      bytesUploaded: record.bytesUploaded,
      peersServed: record.peersServed.size,
      startedAt: record.startedAt,
    }));
  }

  // ============ Helpers ============

  private infohashToContentHash(infohash: string): string {
    // In production, would query the mapping from contract
    return `0x${infohash.padStart(64, '0')}`;
  }

  private hashMessage(seeder: string, infohash: string, bytes: number): string {
    const hour = Math.floor(Date.now() / 3600000);
    return createHash('sha256')
      .update(`${seeder}${infohash}${bytes}${hour}`)
      .digest('hex');
  }
}

// ============ CLI Entry Point ============

if (import.meta.main) {
  const config: SeederConfig = {
    rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:9545',
    privateKey: process.env.PRIVATE_KEY ?? '',
    contentRegistryAddress: (process.env.CONTENT_REGISTRY_ADDRESS ?? '') as Address,
    seedingOracleUrl: process.env.SEEDING_ORACLE_URL,
    maxTorrents: parseInt(process.env.MAX_TORRENTS ?? '100'),
    maxUploadRate: parseInt(process.env.MAX_UPLOAD_RATE ?? '-1'),
    reportIntervalMs: parseInt(process.env.REPORT_INTERVAL_MS ?? '3600000'),
    blocklistSyncIntervalMs: parseInt(process.env.BLOCKLIST_SYNC_INTERVAL_MS ?? '300000'),
  };

  const seeder = new TorrentSeederService(config);

  seeder.start().then(() => {
    console.log('[TorrentSeeder] Service started');

    // Handle shutdown
    process.on('SIGINT', async () => {
      await seeder.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await seeder.stop();
      process.exit(0);
    });
  });
}
