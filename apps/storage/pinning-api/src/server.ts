/**
 * Unified Storage API Server
 *
 * Main entry point for the storage service that integrates:
 * - Content upload/download via multiple backends
 * - Torrent seeding and rewards
 * - Content moderation
 * - Smart routing
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createUnifiedStorage, type UnifiedStorageConfig } from './sdk/unified-storage';
import { getContentRouter } from './router/content-router';
import { getModerationService } from './moderation';
import { getTorrentBackend } from './backends/torrent';
import { ContentTier, ContentViolationType, type Address } from '../../../../packages/types/src';
import {
  isStorageError,
  toStorageError,
  ContentTooLargeError,
  InvalidInputError,
  TorrentNotFoundError,
} from './errors';

// ============ Types ============

interface ServerConfig {
  port: number;
  storage: UnifiedStorageConfig;
  enableModeration: boolean;
  maxUploadSize: number;
}

// ============ Create Server ============

export function createServer(config: ServerConfig) {
  const app = new Hono();
  const storage = createUnifiedStorage(config.storage);
  const router = getContentRouter();
  const moderation = getModerationService();
  const torrent = getTorrentBackend();

  // Middleware
  app.use('/*', cors());
  app.use('/*', logger());

  // Error handler
  app.onError((err, c) => {
    const storageError = toStorageError(err);
    return c.json(
      {
        error: storageError.message,
        code: storageError.code,
      },
      storageError.statusCode as 400 | 401 | 403 | 404 | 408 | 413 | 429 | 500 | 503
    );
  });

  // ============ Health ============

  app.get('/health', async (c) => {
    const torrentStats = torrent.getSeedingStats();
    const blocklistSize = moderation.getBlocklistSize();

    return c.json({
      status: 'healthy',
      storage: {
        torrentsSeeding: torrentStats.torrentsSeeding,
        totalUploaded: torrentStats.totalUploaded,
        activePeers: torrentStats.activePeers,
      },
      moderation: {
        blocklistSize,
      },
    });
  });

  // ============ Upload ============

  app.post('/upload', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || typeof file === 'string') {
      throw new InvalidInputError('file', 'No file provided');
    }

    const content = Buffer.from(await file.arrayBuffer());

    if (content.length > config.maxUploadSize) {
      throw new ContentTooLargeError(content.length, config.maxUploadSize);
    }

    const tierParam = c.req.query('tier');
    const tier = tierParam ? parseInt(tierParam) as ContentTier : ContentTier.STANDARD;
    const encrypt = c.req.query('encrypt') === 'true';

    const result = await storage.upload(content, {
      filename: file.name,
      tier,
      encrypt,
      scanContent: config.enableModeration,
    });

    return c.json({
      success: true,
      ...result,
      magnetUri: result.magnetUri,
      cid: result.cid,
    });
  });

  // ============ Download ============

  app.get('/download/:identifier', async (c) => {
    const identifier = c.req.param('identifier');
    const preferTorrent = c.req.query('preferTorrent') !== 'false';

    const content = await storage.download(identifier, { preferTorrent });

    c.header('Content-Type', 'application/octet-stream');
    return new Response(new Uint8Array(content));
  });

  // ============ Content Info ============

  app.get('/content/:hash', async (c) => {
    const hash = c.req.param('hash') as `0x${string}`;
    const record = await storage.getContent(hash);
    return c.json(record);
  });

  // ============ Routing ============

  app.post('/route', async (c) => {
    const body = await c.req.json<{
      contentHash: `0x${string}`;
      cid?: string;
      infohash?: string;
      size?: number;
    }>();

    const clientIp = c.req.header('x-forwarded-for') ?? 'unknown';
    const preferTorrent = c.req.query('preferTorrent') === 'true';

    const route = await router.route(
      {
        contentHash: body.contentHash,
        cid: body.cid,
        infohash: body.infohash,
      },
      {
        ip: clientIp,
        preferTorrent,
      },
      body.size
    );

    return c.json(route);
  });

  // ============ Seeding ============

  app.post('/seeding/start', async (c) => {
    const { infohash } = await c.req.json<{ infohash: string }>();
    await storage.startSeeding(infohash);
    return c.json({ success: true, infohash });
  });

  app.post('/seeding/stop', async (c) => {
    const { infohash } = await c.req.json<{ infohash: string }>();
    await storage.stopSeeding(infohash);
    return c.json({ success: true, infohash });
  });

  app.get('/seeding/stats', async (c) => {
    const stats = storage.getLocalSeedingStats();
    return c.json(stats);
  });

  app.get('/seeding/stats/:address', async (c) => {
    const address = c.req.param('address') as `0x${string}`;
    const stats = await storage.getSeederStats(address);
    return c.json(stats);
  });

  app.post('/seeding/claim', async (c) => {
    const txHash = await storage.claimRewards();
    return c.json({ success: true, txHash });
  });

  // ============ Moderation ============

  app.post('/report', async (c) => {
    const body = await c.req.json<{
      contentHash: string;
      violationType: ContentViolationType;
      evidence: string;
    }>();

    const evidenceBuffer = Buffer.from(body.evidence, 'base64');
    const txHash = await storage.reportContent(
      body.contentHash,
      body.violationType,
      evidenceBuffer
    );

    return c.json({ success: true, txHash });
  });

  app.get('/blocked/:hash', async (c) => {
    const hash = c.req.param('hash');
    const blocked = await storage.isBlocked(hash);
    return c.json({ blocked });
  });

  // ============ Torrent Direct ============

  app.get('/torrent/:infohash/info', (c) => {
    const infohash = c.req.param('infohash');
    const info = torrent.getTorrentInfo(infohash);

    if (!info) {
      throw new TorrentNotFoundError(infohash);
    }

    return c.json(info);
  });

  app.get('/torrent/:infohash/stats', (c) => {
    const infohash = c.req.param('infohash');
    const stats = torrent.getTorrentStats(infohash);

    if (!stats) {
      throw new TorrentNotFoundError(infohash);
    }

    return c.json(stats);
  });

  app.get('/torrent/:infohash/swarm', async (c) => {
    const infohash = c.req.param('infohash');
    const swarm = await torrent.getSwarmInfo(infohash);
    return c.json(swarm);
  });

  // ============ Reward Rates ============

  app.get('/rates', async (c) => {
    const rates: Record<string, bigint> = {};

    for (let tier = 0; tier <= 4; tier++) {
      const rate = await storage.getRewardRate(tier as ContentTier);
      rates[ContentTier[tier]] = rate;
    }

    return c.json(rates);
  });

  return app;
}

// ============ CLI Entry Point ============

if (import.meta.main) {
  const config: ServerConfig = {
    port: parseInt(process.env.PORT ?? '3100'),
    storage: {
      rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:9545',
      privateKey: process.env.PRIVATE_KEY,
      contentRegistryAddress: (process.env.CONTENT_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      ipfsApiUrl: process.env.IPFS_API_URL,
      ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL,
    },
    enableModeration: process.env.ENABLE_MODERATION !== 'false',
    maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE ?? String(100 * 1024 * 1024)),
  };

  const app = createServer(config);

  console.log(`Starting storage server on port ${config.port}`);

  Bun.serve({
    port: config.port,
    fetch: app.fetch,
  });

  console.log(`Storage server running at http://localhost:${config.port}`);
}

export { ServerConfig };
