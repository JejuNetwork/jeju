/**
 * JejuDA HTTP Server
 * Implements OP Stack Alt-DA interface
 */

import { Hono } from 'hono';
import { keccak256 } from 'ethers';
import { IPFSClient } from './ipfs';
import { CommitmentStore } from './store';
import type { PutResponse, HealthResponse, ReadyResponse, Metrics } from './types';

export interface ServerConfig {
  port: number;
  ipfsApiUrl: string;
  ipfsGatewayUrl: string;
  dataDir: string;
}

export class DAServer {
  private app: Hono;
  private ipfs: IPFSClient;
  private store: CommitmentStore;
  private config: ServerConfig;
  private metrics: Metrics;
  private startTime: number;

  constructor(config: ServerConfig) {
    this.config = config;
    this.app = new Hono();
    this.ipfs = new IPFSClient(config.ipfsApiUrl, config.ipfsGatewayUrl);
    this.store = new CommitmentStore(config.dataDir);
    this.startTime = Date.now();
    this.metrics = {
      totalPuts: 0,
      totalGets: 0,
      totalBytes: 0,
      cacheSize: 0,
      lastPutTime: 0,
    };

    this.setupRoutes();
  }

  /**
   * Initialize the server (load commitments from disk)
   */
  async init(): Promise<void> {
    await this.store.init();
    this.metrics.cacheSize = this.store.size;
  }

  private setupRoutes(): void {
    // ============================================
    // Alt-DA Interface (OP Stack spec)
    // ============================================

    /**
     * PUT /put - Store data and return commitment
     * Max size: 128KB (blob limit)
     */
    this.app.put('/put', async (c) => {
      const MAX_SIZE = 128 * 1024; // 128KB blob limit
      
      const data = await c.req.arrayBuffer();
      const buffer = Buffer.from(data);

      if (buffer.length === 0) {
        return c.json({ error: 'Empty data' }, 400);
      }

      if (buffer.length > MAX_SIZE) {
        return c.json({ error: `Data exceeds max size (${MAX_SIZE} bytes)` }, 413);
      }

      // Create commitment (keccak256 hash)
      const commitment = keccak256(buffer);

      // Store in IPFS
      let cid: string;
      try {
        cid = await this.ipfs.add(buffer);
      } catch (err) {
        console.error('[PUT] IPFS add failed:', err);
        return c.json({ error: 'Failed to store data in IPFS' }, 503);
      }

      // Save mapping
      await this.store.set(commitment, cid, buffer.length);

      // Update metrics
      this.metrics.totalPuts++;
      this.metrics.totalBytes += buffer.length;
      this.metrics.lastPutTime = Date.now();
      this.metrics.cacheSize = this.store.size;

      console.log(`[PUT] ${buffer.length} bytes -> ${commitment.slice(0, 18)}... -> ${cid}`);

      const response: PutResponse = {
        commitment,
        cid,
        size: buffer.length,
        timestamp: Date.now(),
      };

      return c.json(response);
    });

    /**
     * GET /get/:commitment - Retrieve data by commitment
     */
    this.app.get('/get/:commitment', async (c) => {
      const commitment = c.req.param('commitment');

      // Normalize commitment (add 0x prefix if missing)
      const normalizedCommitment = commitment.startsWith('0x')
        ? commitment
        : `0x${commitment}`;

      // Validate commitment format (0x + 64 hex chars)
      if (!/^0x[a-fA-F0-9]{64}$/.test(normalizedCommitment)) {
        return c.json({ error: 'Invalid commitment format' }, 400);
      }

      // Look up CID
      let data = this.store.get(normalizedCommitment);
      if (!data) {
        data = await this.store.loadIfMissing(normalizedCommitment);
      }

      if (!data) {
        console.log(`[GET] Not found: ${normalizedCommitment.slice(0, 18)}...`);
        return c.json({ error: 'Commitment not found' }, 404);
      }

      // Fetch from IPFS
      let content: Buffer | null;
      try {
        content = await this.ipfs.get(data.cid);
      } catch (err) {
        console.error('[GET] IPFS fetch failed:', err);
        return c.json({ error: 'Failed to fetch data from IPFS' }, 503);
      }

      if (!content) {
        console.log(`[GET] CID not in IPFS: ${data.cid}`);
        return c.json({ error: 'Data not found in IPFS' }, 404);
      }

      // Verify commitment
      const actualCommitment = keccak256(content);
      if (actualCommitment !== normalizedCommitment) {
        console.error(`[GET] Commitment mismatch: expected ${normalizedCommitment}, got ${actualCommitment}`);
        return c.json({ error: 'Commitment verification failed' }, 500);
      }

      this.metrics.totalGets++;
      console.log(`[GET] ${content.length} bytes <- ${normalizedCommitment.slice(0, 18)}...`);

      return new Response(content, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': content.length.toString(),
          'X-DA-Commitment': normalizedCommitment,
          'X-DA-CID': data.cid,
        },
      });
    });

    // ============================================
    // Health & Metrics
    // ============================================

    this.app.get('/health', async (c) => {
      const ipfsHealthy = await this.ipfs.isHealthy();

      const response: HealthResponse = {
        status: ipfsHealthy ? 'healthy' : 'degraded',
        ipfs: ipfsHealthy,
        uptime: (Date.now() - this.startTime) / 1000,
        version: '1.0.0',
      };

      return c.json(response, ipfsHealthy ? 200 : 503);
    });

    this.app.get('/ready', async (c) => {
      const ipfsHealthy = await this.ipfs.isHealthy();

      const response: ReadyResponse = {
        ready: ipfsHealthy,
        reason: ipfsHealthy ? undefined : 'IPFS unavailable',
      };

      return c.json(response, ipfsHealthy ? 200 : 503);
    });

    this.app.get('/metrics', (c) => {
      const metrics = `
# HELP jejuda_puts_total Total number of PUT requests
# TYPE jejuda_puts_total counter
jejuda_puts_total ${this.metrics.totalPuts}

# HELP jejuda_gets_total Total number of GET requests
# TYPE jejuda_gets_total counter
jejuda_gets_total ${this.metrics.totalGets}

# HELP jejuda_bytes_total Total bytes stored
# TYPE jejuda_bytes_total counter
jejuda_bytes_total ${this.metrics.totalBytes}

# HELP jejuda_cache_size Number of commitments in cache
# TYPE jejuda_cache_size gauge
jejuda_cache_size ${this.metrics.cacheSize}

# HELP jejuda_uptime_seconds Server uptime in seconds
# TYPE jejuda_uptime_seconds gauge
jejuda_uptime_seconds ${(Date.now() - this.startTime) / 1000}
`.trim();

      return new Response(metrics, {
        headers: { 'Content-Type': 'text/plain' },
      });
    });

    // ============================================
    // Admin endpoints
    // ============================================

    this.app.get('/stats', (c) => {
      return c.json({
        ...this.metrics,
        uptime: (Date.now() - this.startTime) / 1000,
      });
    });
  }

  /**
   * Get the Hono app for testing
   */
  getApp(): Hono {
    return this.app;
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    await this.init();

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                      JejuDA Server                         ║
║           Native Data Availability for OP Stack            ║
╠═══════════════════════════════════════════════════════════╣
║  IPFS API:      ${this.config.ipfsApiUrl.padEnd(38)}║
║  IPFS Gateway:  ${this.config.ipfsGatewayUrl.padEnd(38)}║
║  Data Dir:      ${this.config.dataDir.padEnd(38)}║
║  Port:          ${this.config.port.toString().padEnd(38)}║
╚═══════════════════════════════════════════════════════════╝
`);

    Bun.serve({
      port: this.config.port,
      fetch: this.app.fetch,
    });

    console.log(`JejuDA server listening on port ${this.config.port}`);
  }
}

