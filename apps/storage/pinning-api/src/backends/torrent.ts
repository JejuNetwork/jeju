/**
 * TorrentBackend - WebTorrent-based storage backend
 *
 * Provides P2P content distribution via BitTorrent/WebTorrent:
 * - Hybrid browser (WebRTC) and Node.js (TCP/UDP) support
 * - DHT for trackerless peer discovery
 * - Integration with ContentRegistry for rewards
 * - Automatic seeding with configurable duration
 */

import WebTorrent, { type Torrent, type TorrentFile as WTFile } from 'webtorrent';
import { createHash } from 'crypto';
import type {
  StorageBackend,
  StorageUploadOptions,
  StorageUploadResult,
} from './index';
import type {
  TorrentInfo,
  TorrentStats,
  SwarmInfo,
  ContentTier,
} from '../../../../../packages/types/src';

// ============ Types ============

export interface TorrentBackendConfig {
  trackers: string[];
  dhtPort: number;
  maxConnections: number;
  uploadRateLimit: number;
  downloadRateLimit: number;
  seedingTimeout: number;
  contentRegistryUrl?: string;
}

interface SeedingRecord {
  infohash: string;
  startedAt: number;
  bytesUploaded: number;
  peersServed: Set<string>;
}

// ============ Default Config ============

const DEFAULT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'udp://tracker.openbittorrent.com:80',
  'udp://tracker.opentrackr.org:1337',
];

const DEFAULT_CONFIG: TorrentBackendConfig = {
  trackers: DEFAULT_TRACKERS,
  dhtPort: 20000 + Math.floor(Math.random() * 1000),
  maxConnections: 100,
  uploadRateLimit: -1,
  downloadRateLimit: -1,
  seedingTimeout: 3600000, // 1 hour default
};

// ============ TorrentBackend ============

export class TorrentBackend implements StorageBackend {
  readonly name = 'torrent';
  readonly type = 'torrent' as const;

  private client: WebTorrent.Instance;
  private config: TorrentBackendConfig;
  private seedingRecords: Map<string, SeedingRecord> = new Map();
  private contentHashToInfohash: Map<string, string> = new Map();

  constructor(config: Partial<TorrentBackendConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.client = new WebTorrent({
      dht: true,
      maxConns: this.config.maxConnections,
      tracker: {
        announce: this.config.trackers,
      },
      uploadLimit: this.config.uploadRateLimit,
      downloadLimit: this.config.downloadRateLimit,
    });

    this.client.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[TorrentBackend] Client error:', message);
    });
  }

  // ============ StorageBackend Interface ============

  async upload(
    content: Buffer,
    options: StorageUploadOptions
  ): Promise<StorageUploadResult> {
    const contentHash = this.hashContent(content);

    return new Promise((resolve, reject) => {
      const torrent = this.client.seed(content, {
        announce: this.config.trackers,
      });

      torrent.on('ready', () => {
        const infohash = torrent.infoHash;
        const magnetUri = torrent.magnetURI;

        // Track seeding
        this.seedingRecords.set(infohash, {
          infohash,
          startedAt: Date.now(),
          bytesUploaded: 0,
          peersServed: new Set(),
        });

        this.contentHashToInfohash.set(contentHash, infohash);

        // Track upload stats
        torrent.on('upload', (bytes) => {
          const record = this.seedingRecords.get(infohash);
          if (record) {
            record.bytesUploaded += bytes;
          }
        });

        torrent.on('wire', (wire) => {
          const record = this.seedingRecords.get(infohash);
          if (record) {
            record.peersServed.add(wire.peerId);
          }
        });

        resolve({
          cid: `torrent:${infohash}`,
          url: magnetUri,
          size: content.length,
          backend: 'torrent',
          provider: 'webtorrent',
        });
      });

      torrent.on('error', (err) => {
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(`Torrent seed failed: ${message}`));
      });
    });
  }

  async download(identifier: string): Promise<Buffer> {
    const magnetUri = this.toMagnetUri(identifier);

    return new Promise((resolve, reject) => {
      const existingTorrent = this.client.get(this.extractInfohash(identifier));
      
      if (existingTorrent?.done) {
        this.getTorrentContent(existingTorrent)
          .then(resolve)
          .catch(reject);
        return;
      }

      const torrent = this.client.add(magnetUri, {
        announce: this.config.trackers,
      });

      const timeout = setTimeout(() => {
        torrent.destroy();
        reject(new Error('Torrent download timeout'));
      }, 60000);

      torrent.on('done', () => {
        clearTimeout(timeout);
        this.getTorrentContent(torrent)
          .then(resolve)
          .catch(reject);
      });

      torrent.on('error', (err) => {
        clearTimeout(timeout);
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(`Torrent download failed: ${message}`));
      });
    });
  }

  async exists(identifier: string): Promise<boolean> {
    const infohash = this.extractInfohash(identifier);

    // Check if we're seeding
    if (this.seedingRecords.has(infohash)) {
      return true;
    }

    // Check if torrent is in client
    const torrent = this.client.get(infohash);
    if (torrent) {
      return true;
    }

    // Quick DHT check
    return this.checkDHT(infohash);
  }

  async delete(identifier: string): Promise<void> {
    const infohash = this.extractInfohash(identifier);
    const torrent = this.client.get(infohash);

    if (torrent) {
      torrent.destroy();
    }

    this.seedingRecords.delete(infohash);
  }

  getUrl(identifier: string): string {
    const infohash = this.extractInfohash(identifier);
    return `magnet:?xt=urn:btih:${infohash}&tr=${this.config.trackers.join('&tr=')}`;
  }

  async isAvailable(): Promise<boolean> {
    return true; // WebTorrent client is always available once constructed
  }

  // ============ Torrent-Specific Methods ============

  /**
   * Get torrent info by identifier
   */
  getTorrentInfo(identifier: string): TorrentInfo | null {
    const infohash = this.extractInfohash(identifier);
    const torrent = this.client.get(infohash);

    if (!torrent) return null;

    return {
      infohash: torrent.infoHash,
      magnetUri: torrent.magnetURI,
      name: torrent.name,
      size: torrent.length,
      files: torrent.files.map((f) => ({
        name: f.name,
        path: f.path,
        size: f.length,
        offset: 0,
      })),
      createdAt: this.seedingRecords.get(infohash)?.startedAt ?? Date.now(),
    };
  }

  /**
   * Get torrent download/upload stats
   */
  getTorrentStats(identifier: string): TorrentStats | null {
    const infohash = this.extractInfohash(identifier);
    const torrent = this.client.get(infohash);

    if (!torrent) return null;

    return {
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      peers: torrent.numPeers,
      seeds: torrent.numPeers,
      progress: torrent.progress,
      timeRemaining: torrent.timeRemaining,
    };
  }

  /**
   * Get swarm info for content
   */
  async getSwarmInfo(identifier: string): Promise<SwarmInfo> {
    const infohash = this.extractInfohash(identifier);
    const torrent = this.client.get(infohash);

    return {
      infohash,
      seeders: torrent?.numPeers ?? 0,
      leechers: 0,
      completed: torrent?.done ? 1 : 0,
      lastSeen: Date.now(),
    };
  }

  /**
   * Get all seeding stats
   */
  getSeedingStats(): {
    torrentsSeeding: number;
    totalUploaded: number;
    activePeers: number;
  } {
    let totalUploaded = 0;
    let activePeers = 0;

    for (const torrent of this.client.torrents) {
      totalUploaded += torrent.uploaded;
      activePeers += torrent.numPeers;
    }

    return {
      torrentsSeeding: this.client.torrents.length,
      totalUploaded,
      activePeers,
    };
  }

  /**
   * Get seeding record for reward reporting
   */
  getSeedingRecord(infohash: string): SeedingRecord | undefined {
    return this.seedingRecords.get(infohash);
  }

  /**
   * Reset seeding stats after reporting
   */
  resetSeedingStats(infohash: string): void {
    const record = this.seedingRecords.get(infohash);
    if (record) {
      record.bytesUploaded = 0;
      record.peersServed.clear();
    }
  }

  /**
   * Add external torrent to seed
   */
  async addTorrentToSeed(magnetUri: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const torrent = this.client.add(magnetUri, {
        announce: this.config.trackers,
      });

      torrent.on('ready', () => {
        this.seedingRecords.set(torrent.infoHash, {
          infohash: torrent.infoHash,
          startedAt: Date.now(),
          bytesUploaded: 0,
          peersServed: new Set(),
        });
        resolve(torrent.infoHash);
      });

      torrent.on('error', (err) => {
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(`Failed to add torrent: ${message}`));
      });
    });
  }

  /**
   * Stop seeding a torrent
   */
  stopSeeding(infohash: string): void {
    const torrent = this.client.get(infohash);
    if (torrent) {
      torrent.destroy();
    }
    this.seedingRecords.delete(infohash);
  }

  /**
   * Destroy the client and cleanup
   */
  async destroy(): Promise<void> {
    return new Promise((resolve) => {
      this.client.destroy(() => {
        this.seedingRecords.clear();
        this.contentHashToInfohash.clear();
        resolve();
      });
    });
  }

  // ============ Private Methods ============

  private hashContent(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private extractInfohash(identifier: string): string {
    if (identifier.startsWith('torrent:')) {
      return identifier.slice(8);
    }
    if (identifier.startsWith('magnet:')) {
      const match = identifier.match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
      return match?.[1] ?? identifier;
    }
    return identifier;
  }

  private toMagnetUri(identifier: string): string {
    if (identifier.startsWith('magnet:')) {
      return identifier;
    }
    const infohash = this.extractInfohash(identifier);
    return `magnet:?xt=urn:btih:${infohash}&tr=${this.config.trackers.join('&tr=')}`;
  }

  private async getTorrentContent(torrent: Torrent): Promise<Buffer> {
    const file = torrent.files[0];
    if (!file) {
      throw new Error('No files in torrent');
    }

    return new Promise((resolve, reject) => {
      file.getBuffer((err, buffer) => {
        if (err) reject(err);
        else if (buffer) resolve(buffer);
        else reject(new Error('Empty buffer'));
      });
    });
  }

  private async checkDHT(infohash: string): Promise<boolean> {
    return new Promise((resolve) => {
      const torrent = this.client.add(`magnet:?xt=urn:btih:${infohash}`, {
        announce: this.config.trackers,
      });

      let found = false;
      const timeout = setTimeout(() => {
        torrent.destroy();
        resolve(found);
      }, 5000);

      torrent.on('wire', () => {
        found = true;
        clearTimeout(timeout);
        torrent.destroy();
        resolve(true);
      });
    });
  }
}

// ============ Factory ============

let globalTorrentBackend: TorrentBackend | null = null;

export function getTorrentBackend(
  config?: Partial<TorrentBackendConfig>
): TorrentBackend {
  if (!globalTorrentBackend) {
    globalTorrentBackend = new TorrentBackend(config);
  }
  return globalTorrentBackend;
}

export function resetTorrentBackend(): void {
  if (globalTorrentBackend) {
    globalTorrentBackend.destroy();
    globalTorrentBackend = null;
  }
}
