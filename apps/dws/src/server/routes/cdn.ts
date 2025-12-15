/**
 * CDN Routes
 */

import { Hono } from 'hono';
import { EdgeCache, getEdgeCache, getOriginFetcher } from '../../cdn';

export function createCDNRouter(): Hono {
  const router = new Hono();
  const cache: EdgeCache = getEdgeCache({
    maxSizeBytes: parseInt(process.env.DWS_CDN_CACHE_MB ?? '512', 10) * 1024 * 1024,
    maxEntries: parseInt(process.env.DWS_CDN_CACHE_ENTRIES ?? '100000', 10),
    defaultTTL: parseInt(process.env.DWS_CDN_DEFAULT_TTL ?? '3600', 10),
  });
  const fetcher = getOriginFetcher();

  router.get('/health', (c) => {
    const stats = cache.getStats();
    return c.json({
      status: 'healthy',
      service: 'dws-cdn',
      cache: {
        entries: stats.entries,
        sizeBytes: stats.sizeBytes,
        maxSizeBytes: stats.maxSizeBytes,
        hitRate: stats.hitRate,
      },
    });
  });

  router.get('/stats', (c) => c.json(cache.getStats()));

  router.post('/invalidate', async (c) => {
    const body = await c.req.json<{ paths: string[] }>();
    let purged = 0;
    for (const path of body.paths) {
      purged += cache.purge(path);
    }
    return c.json({ success: true, entriesPurged: purged });
  });

  router.post('/purge', (c) => {
    const stats = cache.getStats();
    cache.clear();
    return c.json({ success: true, entriesPurged: stats.entries });
  });

  router.get('/ipfs/:cid{.+}', async (c) => {
    const cid = c.req.param('cid');
    const path = c.req.path.replace(`/cdn/ipfs/${cid}`, '') || '/';
    const cacheKey = cache.generateKey({ path: `/ipfs/${cid}${path}` });

    const { entry, status } = cache.get(cacheKey);
    if (entry && (status === 'HIT' || status === 'STALE')) {
      return new Response(entry.data, {
        headers: { ...entry.metadata.headers, 'X-Cache': status, 'X-Served-By': 'dws-cdn' },
      });
    }

    const ipfsGateway = process.env.IPFS_GATEWAY_URL || 'https://ipfs.io';
    const result = await fetcher.fetch(`/ipfs/${cid}${path}`, undefined, { headers: {} });

    if (!result.success) {
      return c.json({ error: result.error ?? 'Content not found' }, result.status || 404);
    }

    cache.set(cacheKey, result.body, {
      contentType: result.headers['content-type'],
      headers: result.headers,
      origin: result.origin,
      cacheControl: result.headers['cache-control'],
      immutable: (result.headers['cache-control'] ?? '').includes('immutable'),
    });

    return new Response(result.body, {
      headers: { ...result.headers, 'X-Cache': 'MISS', 'X-Served-By': 'dws-cdn' },
    });
  });

  router.get('/resolve/:name', async (c) => {
    const name = c.req.param('name');
    return c.json({
      name: name.endsWith('.jns') ? name : `${name}.jns`,
      contentHash: null,
      error: 'JNS contracts not configured',
    });
  });

  router.post('/warmup', async (c) => {
    const body = await c.req.json<{ urls: string[] }>();
    let success = 0;
    let failed = 0;
    for (const url of body.urls) {
      const urlObj = new URL(url);
      const result = await fetcher.fetch(urlObj.pathname, undefined, { headers: {} });
      if (result.success) {
        const cacheKey = cache.generateKey({ path: urlObj.pathname });
        cache.set(cacheKey, result.body, {
          contentType: result.headers['content-type'],
          headers: result.headers,
          origin: result.origin,
        });
        success++;
      } else {
        failed++;
      }
    }
    return c.json({ success, failed });
  });

  return router;
}
