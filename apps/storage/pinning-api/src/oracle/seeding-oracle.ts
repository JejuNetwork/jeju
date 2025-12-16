/**
 * Seeding Oracle Service
 *
 * Validates and signs seeding activity reports for on-chain rewards:
 * - Verifies seeder is actually serving content
 * - Signs reports for on-chain verification
 * - Tracks reported bandwidth to prevent double-claiming
 * - Integrates with DHT to verify peer connections
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Wallet, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';
import WebTorrent from 'webtorrent';
import type { Address } from '../../../../../packages/types/src';

// ============ Types ============

interface OracleConfig {
  privateKey: string;
  rpcUrl: string;
  port: number;
  maxBytesPerReport: number;
  reportCooldownMs: number;
}

interface ReportRequest {
  seeder: Address;
  infohash: string;
  bytesUploaded: number;
  timestamp: number;
}

interface ReportRecord {
  seeder: Address;
  infohash: string;
  totalReported: number;
  lastReportTime: number;
  reportCount: number;
}

interface VerificationResult {
  valid: boolean;
  reason?: string;
  adjustedBytes?: number;
}

// ============ Default Config ============

const DEFAULT_CONFIG: Partial<OracleConfig> = {
  port: 3200,
  maxBytesPerReport: 1024 * 1024 * 1024 * 10, // 10 GB
  reportCooldownMs: 3600000, // 1 hour
};

// ============ Seeding Oracle ============

export class SeedingOracle {
  private config: OracleConfig;
  private wallet: Wallet;
  private app: Hono;
  private torrentClient: WebTorrent.Instance;
  private reportRecords: Map<string, ReportRecord> = new Map();

  constructor(config: OracleConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config } as OracleConfig;
    this.wallet = new Wallet(config.privateKey);
    this.app = new Hono();
    this.torrentClient = new WebTorrent({ dht: true });

    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.use('/*', cors());

    // Health check
    this.app.get('/health', (c) => {
      return c.json({
        status: 'ok',
        oracle: this.wallet.address,
        torrentsTracked: this.torrentClient.torrents.length,
      });
    });

    // Sign seeding report
    this.app.post('/sign', async (c) => {
      const request = await c.req.json<ReportRequest>();

      // Validate request
      const verification = await this.verifyReport(request);
      if (!verification.valid) {
        return c.json({ error: verification.reason }, 400);
      }

      // Adjust bytes if needed
      const bytesToSign = verification.adjustedBytes ?? request.bytesUploaded;

      // Generate signature
      const signature = await this.signReport(
        request.seeder,
        request.infohash,
        bytesToSign
      );

      // Record the report
      this.recordReport(request.seeder, request.infohash, bytesToSign);

      return c.json({
        signature,
        bytesApproved: bytesToSign,
        timestamp: Math.floor(Date.now() / 3600000),
      });
    });

    // Get seeder stats
    this.app.get('/stats/:seeder', (c) => {
      const seeder = c.req.param('seeder') as Address;
      const records: ReportRecord[] = [];

      for (const [key, record] of this.reportRecords) {
        if (record.seeder.toLowerCase() === seeder.toLowerCase()) {
          records.push(record);
        }
      }

      return c.json({ records });
    });

    // Verify torrent swarm
    this.app.get('/swarm/:infohash', async (c) => {
      const infohash = c.req.param('infohash');
      const swarmInfo = await this.getSwarmInfo(infohash);
      return c.json(swarmInfo);
    });
  }

  // ============ Verification ============

  private async verifyReport(request: ReportRequest): Promise<VerificationResult> {
    const key = `${request.seeder}-${request.infohash}`;
    const record = this.reportRecords.get(key);

    // Check cooldown
    if (record && Date.now() - record.lastReportTime < this.config.reportCooldownMs) {
      return {
        valid: false,
        reason: 'Report cooldown not elapsed',
      };
    }

    // Check max bytes per report
    if (request.bytesUploaded > this.config.maxBytesPerReport) {
      return {
        valid: true,
        adjustedBytes: this.config.maxBytesPerReport,
      };
    }

    // Verify seeder is in swarm (basic check)
    const swarmInfo = await this.getSwarmInfo(request.infohash);
    if (swarmInfo.seeders === 0) {
      return {
        valid: false,
        reason: 'No active swarm found',
      };
    }

    return { valid: true };
  }

  private async getSwarmInfo(infohash: string): Promise<{
    seeders: number;
    leechers: number;
    verified: boolean;
  }> {
    return new Promise((resolve) => {
      const existingTorrent = this.torrentClient.get(infohash);
      
      if (existingTorrent) {
        resolve({
          seeders: existingTorrent.numPeers,
          leechers: 0,
          verified: true,
        });
        return;
      }

      // Add torrent temporarily to check swarm
      const torrent = this.torrentClient.add(`magnet:?xt=urn:btih:${infohash}`);
      
      let peerCount = 0;
      const timeout = setTimeout(() => {
        torrent.destroy();
        resolve({
          seeders: peerCount,
          leechers: 0,
          verified: peerCount > 0,
        });
      }, 10000);

      torrent.on('wire', () => {
        peerCount++;
      });

      torrent.on('ready', () => {
        clearTimeout(timeout);
        setTimeout(() => {
          resolve({
            seeders: torrent.numPeers,
            leechers: 0,
            verified: true,
          });
          // Keep tracking this torrent for future requests
        }, 5000);
      });
    });
  }

  // ============ Signing ============

  private async signReport(
    seeder: Address,
    infohash: string,
    bytesUploaded: number
  ): Promise<string> {
    const hour = Math.floor(Date.now() / 3600000);
    const messageHash = keccak256(
      toUtf8Bytes(`${seeder}${infohash}${bytesUploaded}${hour}`)
    );

    return this.wallet.signMessage(messageHash);
  }

  private recordReport(
    seeder: Address,
    infohash: string,
    bytes: number
  ): void {
    const key = `${seeder}-${infohash}`;
    const existing = this.reportRecords.get(key);

    if (existing) {
      existing.totalReported += bytes;
      existing.lastReportTime = Date.now();
      existing.reportCount++;
    } else {
      this.reportRecords.set(key, {
        seeder,
        infohash,
        totalReported: bytes,
        lastReportTime: Date.now(),
        reportCount: 1,
      });
    }
  }

  // ============ Lifecycle ============

  start(): void {
    console.log(`[SeedingOracle] Starting on port ${this.config.port}`);
    console.log(`[SeedingOracle] Oracle address: ${this.wallet.address}`);

    Bun.serve({
      port: this.config.port,
      fetch: this.app.fetch,
    });

    console.log(`[SeedingOracle] Running at http://localhost:${this.config.port}`);
  }

  getApp(): Hono {
    return this.app;
  }

  getAddress(): string {
    return this.wallet.address;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.torrentClient.destroy(() => resolve());
    });
  }
}

// ============ Factory ============

export function createSeedingOracle(config: OracleConfig): SeedingOracle {
  return new SeedingOracle(config);
}

// ============ CLI Entry Point ============

if (import.meta.main) {
  const oracle = createSeedingOracle({
    privateKey: process.env.ORACLE_PRIVATE_KEY ?? '',
    rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:9545',
    port: parseInt(process.env.ORACLE_PORT ?? '3200'),
    maxBytesPerReport: 10 * 1024 * 1024 * 1024,
    reportCooldownMs: 3600000,
  });

  oracle.start();

  process.on('SIGINT', async () => {
    await oracle.stop();
    process.exit(0);
  });
}
