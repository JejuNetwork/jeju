/**
 * CDN Routes
 * 
 * Includes JNS gateway for serving decentralized apps
 */

import { Hono } from 'hono';
import { EdgeCache, getEdgeCache, getOriginFetcher } from '../../cdn';
import { JNSGateway, type JNSGatewayConfig } from '../../cdn/gateway/jns-gateway';
import { validateBody, validateParams, cdnCacheParamsSchema } from '../../shared';
import { z } from 'zod';
import type { Address } from 'viem';

// JNS Gateway instance (initialized lazily)
let jnsGateway: JNSGateway | null = null;

function getJNSGateway(): JNSGateway | null {
  if (jnsGateway) return jnsGateway;
  
  // Only initialize if JNS contracts are configured
  const jnsRegistry = process.env.JNS_REGISTRY_ADDRESS;
  const jnsResolver = process.env.JNS_RESOLVER_ADDRESS;
  
  if (!jnsRegistry || jnsRegistry === '0x0' || !jnsResolver || jnsResolver === '0x0') {
    return null;
  }
  
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error('RPC_URL environment variable is required for JNS gateway');
  }
  
  const config: JNSGatewayConfig = {
    port: 0, // Not used when embedded
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

export function createCDNRouter(): Hono {
  const router = new Hono();
  // CDN cache configuration - defaults are sensible for development
  const cacheMb = parseInt(process.env.DWS_CDN_CACHE_MB || '512', 10);
  const maxEntries = parseInt(process.env.DWS_CDN_CACHE_ENTRIES || '100000', 10);
  const defaultTTL = parseInt(process.env.DWS_CDN_DEFAULT_TTL || '3600', 10);
  
  const cache: EdgeCache = getEdgeCache({
    maxSizeBytes: cacheMb * 1024 * 1024,
    maxEntries,
    defaultTTL,
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
    const body = await validateBody(z.object({ paths: z.array(z.string()).min(1) }), c);
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
    const { cid } = validateParams(cdnCacheParamsSchema, c);
    const path = c.req.path.replace(`/cdn/ipfs/${cid}`, '') || '/';
    const cacheKey = cache.generateKey({ path: `/ipfs/${cid}${path}` });

    const { entry, status } = cache.get(cacheKey);
    if (entry && (status === 'HIT' || status === 'STALE')) {
      return new Response(new Uint8Array(entry.data), {
        headers: { ...entry.metadata.headers, 'X-Cache': status, 'X-Served-By': 'dws-cdn' },
      });
    }

    const result = await fetcher.fetch(`/ipfs/${cid}${path}`, undefined, { headers: {} });

    if (!result.success) {
      throw new Error(result.error || 'Content not found');
    }

    const cacheControl = result.headers['cache-control'] || '';
    cache.set(cacheKey, result.body, {
      contentType: result.headers['content-type'],
      headers: result.headers,
      origin: result.origin,
      cacheControl,
      immutable: cacheControl.includes('immutable'),
    });

    return new Response(new Uint8Array(result.body), {
      headers: { ...result.headers, 'X-Cache': 'MISS', 'X-Served-By': 'dws-cdn' },
    });
  });

  // JNS name resolution
  router.get('/resolve/:name', async (c) => {
    const { name } = validateParams(z.object({ name: z.string().min(1) }), c);
    const fullName = name.endsWith('.jns') ? name : `${name}.jns`;
    
    const gateway = getJNSGateway();
    if (!gateway) {
      throw new Error('JNS contracts not configured. Set JNS_REGISTRY_ADDRESS and JNS_RESOLVER_ADDRESS.');
    }
    
    const contentHash = await gateway.resolveJNS(fullName);
    if (!contentHash) {
      throw new Error('Name not found');
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
  
  // Serve JNS content: /cdn/jns/:name/*
  router.get('/jns/:name{.+}', async (c) => {
    const { name } = validateParams(z.object({ name: z.string().min(1) }), c);
    const path = c.req.path.replace(`/cdn/jns/${name}`, '') || '/';
    
    const gateway = getJNSGateway();
    if (!gateway) {
      throw new Error('JNS not configured');
    }
    
    // Use the JNS gateway's app to handle the request
    const jnsApp = gateway.getApp();
    const newRequest = new Request(`http://localhost/jns/${name}${path}`, c.req.raw);
    return jnsApp.fetch(newRequest);
  });

  router.post('/warmup', async (c) => {
    const body = await validateBody(z.object({ urls: z.array(z.string().url()).min(1) }), c);
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
