/**
 * Storage Routes - Enhanced multi-backend storage API
 *
 * Features:
 * - Content tiering (System, Popular, Private)
 * - Multi-backend selection (IPFS, Arweave, WebTorrent)
 * - Encryption support
 * - Popularity tracking
 * - Regional prefetching
 * - IPFS-compatible API
 */

import { Hono } from 'hono';
import { extractClientRegion } from '../../shared/utils/common';
import type { BackendManager } from '../../storage/backends';
import { getMultiBackendManager } from '../../storage/multi-backend';
import type {
  ContentCategory,
  ContentTier,
  StorageBackendType,
} from '../../storage/types';

export function createStorageRouter(backend?: BackendManager): Hono {
  const router = new Hono();
  const storageManager = getMultiBackendManager();

  // Health & Stats
  router.get('/health', async (c) => {
    const backends = storageManager.listBackends();
    const health = await storageManager.healthCheck();
    const stats = storageManager.getNodeStats();

    return c.json({
      service: 'dws-storage',
      status: 'healthy' as const,
      backends,
      health,
      stats,
    });
  });

  router.get('/stats', (c) => c.json(storageManager.getNodeStats()));

  // Upload with multipart form
  router.post('/upload', async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const tier = (formData.get('tier') as string) || 'popular';
    const category = (formData.get('category') as string) || 'data';
    const encrypt = formData.get('encrypt') === 'true';
    const permanent = formData.get('permanent') === 'true';
    const backendsStr = formData.get('backends') as string | null;
    const accessPolicy = formData.get('accessPolicy') as string | null;

    const content = Buffer.from(await file.arrayBuffer());
    const preferredBackends = backendsStr
      ?.split(',')
      .filter(Boolean) as StorageBackendType[] | undefined;

    const result = await storageManager.upload(content, {
      filename: file.name,
      contentType: file.type,
      tier: tier as ContentTier,
      category: category as ContentCategory,
      encrypt,
      preferredBackends,
      accessPolicy: accessPolicy ?? undefined,
    });

    if (permanent) {
      const permanentResult = await storageManager.uploadPermanent(content, {
        filename: file.name,
        contentType: file.type,
        tier: tier as ContentTier,
        category: category as ContentCategory,
      });
      return c.json(permanentResult);
    }

    return c.json(result);
  });

  // Raw upload (simple body as content)
  router.post('/upload/raw', async (c) => {
    const contentType = c.req.header('content-type') || 'application/octet-stream';
    const filename = c.req.header('x-filename') || 'upload';
    const tier = (c.req.query('tier') as ContentTier) || 'popular';
    const category = (c.req.query('category') as ContentCategory) || 'data';

    const content = Buffer.from(await c.req.arrayBuffer());

    // Use the simple backend if provided, otherwise use multi-backend
    if (backend) {
      const cid = await backend.upload(content, { 
        filename,
        contentType,
      });
      return c.json({ cid, size: content.length });
    }

    const result = await storageManager.upload(content, {
      filename,
      contentType,
      tier,
      category,
    });

    return c.json(result);
  });

  // JSON upload
  router.post('/upload/json', async (c) => {
    const body = await c.req.json() as {
      data: unknown;
      name?: string;
      tier?: ContentTier;
      category?: ContentCategory;
      encrypt?: boolean;
    };

    const content = Buffer.from(JSON.stringify(body.data));

    const result = await storageManager.upload(content, {
      filename: body.name ?? 'data.json',
      contentType: 'application/json',
      tier: body.tier ?? 'popular',
      category: body.category ?? 'data',
      encrypt: body.encrypt,
    });

    return c.json(result);
  });

  // Permanent upload
  router.post('/upload/permanent', async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const tier = (formData.get('tier') as string) || 'popular';
    const category = (formData.get('category') as string) || 'data';
    const content = Buffer.from(await file.arrayBuffer());

    const result = await storageManager.uploadPermanent(content, {
      filename: file.name,
      contentType: file.type,
      tier: tier as ContentTier,
      category: category as ContentCategory,
    });

    return c.json(result);
  });

  // Download
  router.get('/download/:cid', async (c) => {
    const cid = c.req.param('cid');
    const region = extractClientRegion(
      c.req.header('x-region'),
      c.req.header('cf-ipcountry'),
    );
    const decrypt = c.req.query('decrypt') === 'true';
    const preferredBackend = c.req.query('backend') as StorageBackendType | undefined;

    // Use simple backend if provided
    if (backend) {
      const result = await backend.download(cid).catch(() => null);
      if (!result) {
        return c.json({ error: 'Not found' }, 404);
      }
      c.header('Content-Type', result.contentType);
      return new Response(result.content);
    }

    const result = await storageManager.download(cid, {
      region,
      preferredBackends: preferredBackend ? [preferredBackend] : undefined,
      decryptionKeyId: decrypt ? c.req.header('x-decryption-key-id') : undefined,
    });

    const metadata = result.metadata;
    const contentType = metadata?.contentType ?? 'application/octet-stream';

    c.header('Content-Type', contentType);
    c.header('Content-Length', String(result.content.length));
    c.header('X-Backend', result.backend);
    c.header('X-Latency-Ms', String(result.latencyMs));
    c.header('X-From-Cache', String(result.fromCache));
    if (metadata?.tier) {
      c.header('X-Content-Tier', metadata.tier);
    }

    return new Response(new Uint8Array(result.content));
  });

  // Download as JSON
  router.get('/download/:cid/json', async (c) => {
    const cid = c.req.param('cid');
    const region = c.req.header('x-region') ?? 'unknown';

    const result = await storageManager
      .download(cid, { region })
      .catch(() => null);

    if (!result) {
      return c.json({ error: 'Not found' }, 404);
    }

    return c.json(JSON.parse(result.content.toString('utf-8')));
  });

  // Get content metadata
  router.get('/content/:cid', (c) => {
    const cid = c.req.param('cid');
    const metadata = storageManager.getMetadata(cid);

    if (!metadata) {
      return c.json({ error: 'Not found' }, 404);
    }

    return c.json(metadata);
  });

  // List content
  router.get('/content', (c) => {
    const tier = c.req.query('tier') as ContentTier | undefined;
    const category = c.req.query('category') as ContentCategory | undefined;
    const limit = parseInt(c.req.query('limit') ?? '100', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    let items = tier
      ? storageManager.listByTier(tier)
      : category
        ? storageManager.listByCategory(category)
        : [
            ...storageManager.listByTier('system'),
            ...storageManager.listByTier('popular'),
            ...storageManager.listByTier('private'),
          ];

    const total = items.length;
    items = items.slice(offset, offset + limit);

    return c.json({ items, total, limit, offset });
  });

  // Check if content exists
  router.get('/exists/:cid', async (c) => {
    const cid = c.req.param('cid');
    
    // Use simple backend if provided
    if (backend) {
      const result = await backend.download(cid).catch(() => null);
      return c.json({ cid, exists: !!result });
    }

    const exists = await storageManager.exists(cid);
    return c.json({ cid, exists });
  });

  // Popular content
  router.get('/popular', (c) => {
    const limit = parseInt(c.req.query('limit') ?? '10', 10);
    const popular = storageManager.getPopularContent(limit);
    return c.json({ items: popular });
  });

  // Underseeded content
  router.get('/underseeded', (c) => {
    const minSeeders = parseInt(c.req.query('min') ?? '3', 10);
    const underseeded = storageManager.getUnderseededContent(minSeeders);
    return c.json({ items: underseeded });
  });

  // Regional popularity
  router.get('/regional/:region', (c) => {
    const region = c.req.param('region');
    const popularity = storageManager.getRegionalPopularity(region);
    return c.json(popularity);
  });

  // WebTorrent info
  router.get('/torrent/:cid', (c) => {
    const cid = c.req.param('cid');
    const metadata = storageManager.getMetadata(cid);

    if (!metadata || !metadata.addresses.magnetUri) {
      return c.json({ error: 'Torrent not found' }, 404);
    }

    return c.json({
      cid,
      magnetUri: metadata.addresses.magnetUri,
      infoHash: metadata.addresses.cid,
      size: metadata.size,
      tier: metadata.tier,
    });
  });

  // Get magnet URI
  router.get('/magnet/:cid', (c) => {
    const cid = c.req.param('cid');
    const metadata = storageManager.getMetadata(cid);

    if (!metadata || !metadata.addresses.magnetUri) {
      return c.json({ error: 'Magnet URI not found' }, 404);
    }

    c.header('Content-Type', 'text/plain');
    return c.text(metadata.addresses.magnetUri);
  });

  // Arweave content
  router.get('/arweave/:txId', async (c) => {
    const txId = c.req.param('txId');

    const result = await storageManager
      .download(txId, {
        preferredBackends: ['arweave'],
      })
      .catch(() => null);

    if (!result) {
      return c.json({ error: 'Not found' }, 404);
    }

    const contentType = result.metadata?.contentType ?? 'application/octet-stream';

    c.header('Content-Type', contentType);
    c.header('X-Arweave-Tx', txId);

    return new Response(new Uint8Array(result.content));
  });

  // IPFS Compatibility - Add
  router.post('/api/v0/add', async (c) => {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const content = Buffer.from(await file.arrayBuffer());
    const result = await storageManager.upload(content, {
      filename: file.name,
      contentType: file.type,
      tier: 'popular',
    });

    return c.json({
      Hash: result.cid,
      Size: String(result.size),
      Name: file.name,
    });
  });

  // IPFS Compatibility - ID
  router.post('/api/v0/id', async (c) => {
    const health = await storageManager.healthCheck();
    const allHealthy = Object.values(health).every((h) => h);

    if (!allHealthy) {
      return c.json({ error: 'Storage backends unhealthy' }, 503);
    }

    const backends = storageManager.listBackends();

    return c.json({
      ID: 'dws-storage',
      AgentVersion: 'dws/2.0.0',
      Addresses: [],
      Backends: backends,
    });
  });

  // IPFS Compatibility - Unpin
  router.post('/api/v0/pin/rm', (c) => {
    const arg = c.req.query('arg');
    return c.json({ Pins: [arg] });
  });

  // IPFS path
  router.get('/ipfs/:cid', async (c) => {
    const cid = c.req.param('cid');
    const region = c.req.header('x-region') ?? 'unknown';

    const result = await storageManager.download(cid, { region }).catch(() => null);

    if (!result) {
      return c.json({ error: 'Not found' }, 404);
    }

    const contentType = result.metadata?.contentType ?? 'application/octet-stream';

    c.header('Content-Type', contentType);
    c.header('X-Ipfs-Path', `/ipfs/${cid}`);
    c.header('X-Backend', result.backend);

    return new Response(new Uint8Array(result.content));
  });

  return router;
}
