/**
 * CDN Routes
 *
 * Includes JNS gateway for serving decentralized apps
 */

import { Hono } from 'hono';
import type { Address } from 'viem';
import { type EdgeCache, getEdgeCache, getOriginFetcher } from '../../cdn';
import {
  JNSGateway,
  type JNSGatewayConfig,
} from '../../cdn/gateway/jns-gateway';
import { validateBody, z } from '../../shared';

// JNS Gateway instance (initialized lazily)
let jnsGateway: JNSGateway | null = null;

function getJNSGateway(): JNSGateway | null {
  if (jnsGateway) return jnsGateway;

  const jnsRegistry = process.env.JNS_REGISTRY_ADDRESS;
  const jnsResolver = process.env.JNS_RESOLVER_ADDRESS;

  if (
    !jnsRegistry ||
    jnsRegistry === '0x0' ||
    !jnsResolver ||
    jnsResolver === '0x0'
  ) {
    return null;
  }

  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error('RPC_URL environment variable is required for JNS gateway');
  }

  const config: JNSGatewayConfig = {
    port: 0,
    rpcUrl,
    jnsRegistryAddress: jnsRegistry as Address,
    jnsResolverAddress: jnsResolver as Address,
    ipfsGateway: process.env.IPFS_GATEWAY_URL ?? 'https://ipfs.io',
    arweaveGateway: process.env.ARWEAVE_GATEWAY_URL ?? 'https://arweave.net',
    domain: process.env.JNS_DOMAIN ?? 'jejunetwork.org',
  };

  jnsGateway = new JNSGateway(config);
  return jnsGateway;
}

// CDN cache configuration
const cacheMb = parseInt(process.env.DWS_CDN_CACHE_MB || '512', 10);
const maxEntries = parseInt(process.env.DWS_CDN_CACHE_ENTRIES || '100000', 10);
const defaultTTL = parseInt(process.env.DWS_CDN_DEFAULT_TTL || '3600', 10);

const cache: EdgeCache = getEdgeCache({
  maxSizeBytes: cacheMb * 1024 * 1024,
  maxEntries,
  defaultTTL,
});
const fetcher = getOriginFetcher();

const invalidateSchema = z.object({
  paths: z.array(z.string()).min(1),
});

const warmupSchema = z.object({
  urls: z.array(z.string().url()).min(1),
});

export function createCDNRouter(): Hono {
  const router = new Hono();

  // Health check
  router.get('/health', (c) => {
    const stats = cache.getStats();
    return c.json({
      status: 'healthy' as const,
      service: 'dws-cdn',
      cache: {
        entries: stats.entries,
        sizeBytes: stats.sizeBytes,
        maxSizeBytes: stats.maxSizeBytes,
        hitRate: stats.hitRate,
      },
    });
  });

  // Cache stats
  router.get('/stats', (c) => c.json(cache.getStats()));

  // Invalidate cache paths
  router.post('/invalidate', async (c) => {
    const body = await validateBody(invalidateSchema, c);
    let purged = 0;
    for (const path of body.paths) {
      purged += cache.purge(path);
    }
    return c.json({ success: true, entriesPurged: purged });
  });

  // Purge entire cache
  router.post('/purge', (c) => {
    const stats = cache.getStats();
    cache.clear();
    return c.json({ success: true, entriesPurged: stats.entries });
  });

  // IPFS content via CDN
  router.get('/ipfs/:cid', async (c) => {
    const cid = c.req.param('cid');
    const path = c.req.path;
    const cidPath = path.replace(`/cdn/ipfs/${cid}`, '') || '/';
    const cacheKey = cache.generateKey({ path: `/ipfs/${cid}${cidPath}` });

    const { entry, status } = cache.get(cacheKey);
    if (entry && (status === 'HIT' || status === 'STALE')) {
      const headers: Record<string, string> = {
        ...entry.metadata.headers,
        'X-Cache': status,
        'X-Served-By': 'dws-cdn',
      };
      return new Response(new Uint8Array(entry.data), { headers });
    }

    const result = await fetcher.fetch(`/ipfs/${cid}${cidPath}`, undefined, {
      headers: {},
    });

    if (!result.success) {
      return c.json({ error: result.error || 'Content not found' }, 404);
    }

    const cacheControl = result.headers['cache-control'] || '';
    cache.set(cacheKey, result.body, {
      contentType: result.headers['content-type'],
      headers: result.headers,
      origin: result.origin,
      cacheControl,
      immutable: cacheControl.includes('immutable'),
    });

    const headers: Record<string, string> = {
      ...result.headers,
      'X-Cache': 'MISS',
      'X-Served-By': 'dws-cdn',
    };
    return new Response(new Uint8Array(result.body), { headers });
  });

  // Resolve JNS name
  router.get('/resolve/:name', async (c) => {
    const name = c.req.param('name');
    const fullName = name.endsWith('.jns') ? name : `${name}.jns`;

    const gateway = getJNSGateway();
    if (!gateway) {
      return c.json(
        {
          error:
            'JNS contracts not configured. Set JNS_REGISTRY_ADDRESS and JNS_RESOLVER_ADDRESS.',
        },
        503,
      );
    }

    const contentHash = await gateway.resolveJNS(fullName);
    if (!contentHash) {
      return c.json({ error: 'Name not found' }, 404);
    }

    return c.json({
      name: fullName,
      contentHash: {
        protocol: contentHash.protocol,
        hash: contentHash.hash,
      },
      resolvedAt: Date.now(),
    });
  });

  // JNS gateway
  router.get('/jns/:name/*', async (c) => {
    const name = c.req.param('name');
    const path = c.req.path;
    const jnsPath = path.replace(`/cdn/jns/${name}`, '') || '/';

    const gateway = getJNSGateway();
    if (!gateway) {
      return c.json({ error: 'JNS not configured' }, 503);
    }

    const jnsApp = gateway.getApp();
    const newRequest = new Request(`http://localhost/jns/${name}${jnsPath}`);
    return jnsApp.fetch(newRequest);
  });

  // Warmup cache
  router.post('/warmup', async (c) => {
    const body = await validateBody(warmupSchema, c);
    let success = 0;
    let failed = 0;

    for (const url of body.urls) {
      const urlObj = new URL(url);
      const result = await fetcher.fetch(urlObj.pathname, undefined, {
        headers: {},
      });
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
