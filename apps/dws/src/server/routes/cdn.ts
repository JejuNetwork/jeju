/**
 * CDN Routes
 *
 * Includes JNS gateway for serving decentralized apps
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { type EdgeCache, getEdgeCache, getOriginFetcher } from '../../cdn'
import {
  JNSGateway,
  type JNSGatewayConfig,
} from '../../cdn/gateway/jns-gateway'

// JNS Gateway instance (initialized lazily)
let jnsGateway: JNSGateway | null = null

function getJNSGateway(): JNSGateway | null {
  if (jnsGateway) return jnsGateway

  const jnsRegistry = process.env.JNS_REGISTRY_ADDRESS
  const jnsResolver = process.env.JNS_RESOLVER_ADDRESS

  if (
    !jnsRegistry ||
    jnsRegistry === '0x0' ||
    !jnsResolver ||
    jnsResolver === '0x0'
  ) {
    return null
  }

  const rpcUrl = process.env.RPC_URL
  if (!rpcUrl) {
    throw new Error('RPC_URL environment variable is required for JNS gateway')
  }

  const config: JNSGatewayConfig = {
    port: 0,
    rpcUrl,
    jnsRegistryAddress: jnsRegistry as Address,
    jnsResolverAddress: jnsResolver as Address,
    ipfsGateway: process.env.IPFS_GATEWAY_URL ?? 'https://ipfs.io',
    arweaveGateway: process.env.ARWEAVE_GATEWAY_URL ?? 'https://arweave.net',
    domain: process.env.JNS_DOMAIN ?? 'jejunetwork.org',
  }

  jnsGateway = new JNSGateway(config)
  return jnsGateway
}

// CDN cache configuration
const cacheMb = parseInt(process.env.DWS_CDN_CACHE_MB || '512', 10)
const maxEntries = parseInt(process.env.DWS_CDN_CACHE_ENTRIES || '100000', 10)
const defaultTTL = parseInt(process.env.DWS_CDN_DEFAULT_TTL || '3600', 10)

const cache: EdgeCache = getEdgeCache({
  maxSizeBytes: cacheMb * 1024 * 1024,
  maxEntries,
  defaultTTL,
})
const fetcher = getOriginFetcher()

export const cdnRoutes = new Elysia({ name: 'cdn', prefix: '/cdn' })
  .get('/health', () => {
    const stats = cache.getStats()
    return {
      status: 'healthy' as const,
      service: 'dws-cdn',
      cache: {
        entries: stats.entries,
        sizeBytes: stats.sizeBytes,
        maxSizeBytes: stats.maxSizeBytes,
        hitRate: stats.hitRate,
      },
    }
  })

  .get('/stats', () => cache.getStats())

  .post(
    '/invalidate',
    ({ body }) => {
      let purged = 0
      for (const path of body.paths) {
        purged += cache.purge(path)
      }
      return { success: true, entriesPurged: purged }
    },
    {
      body: t.Object({
        paths: t.Array(t.String(), { minItems: 1 }),
      }),
    },
  )

  .post('/purge', () => {
    const stats = cache.getStats()
    cache.clear()
    return { success: true, entriesPurged: stats.entries }
  })

  .get(
    '/ipfs/:cid',
    async ({ params, path, set }) => {
      const cidPath = path.replace(`/cdn/ipfs/${params.cid}`, '') || '/'
      const cacheKey = cache.generateKey({ path: `/ipfs/${params.cid}${cidPath}` })

      const { entry, status } = cache.get(cacheKey)
      if (entry && (status === 'HIT' || status === 'STALE')) {
        set.headers = {
          ...entry.metadata.headers,
          'X-Cache': status,
          'X-Served-By': 'dws-cdn',
        }
        return new Uint8Array(entry.data)
      }

      const result = await fetcher.fetch(`/ipfs/${params.cid}${cidPath}`, undefined, {
        headers: {},
      })

      if (!result.success) {
        throw new Error(result.error || 'Content not found')
      }

      const cacheControl = result.headers['cache-control'] || ''
      cache.set(cacheKey, result.body, {
        contentType: result.headers['content-type'],
        headers: result.headers,
        origin: result.origin,
        cacheControl,
        immutable: cacheControl.includes('immutable'),
      })

      set.headers = {
        ...result.headers,
        'X-Cache': 'MISS',
        'X-Served-By': 'dws-cdn',
      }
      return new Uint8Array(result.body)
    },
    {
      params: t.Object({
        cid: t.String({ minLength: 1 }),
      }),
    },
  )

  .get(
    '/resolve/:name',
    async ({ params, set }) => {
      const fullName = params.name.endsWith('.jns')
        ? params.name
        : `${params.name}.jns`

      const gateway = getJNSGateway()
      if (!gateway) {
        set.status = 503
        return {
          error:
            'JNS contracts not configured. Set JNS_REGISTRY_ADDRESS and JNS_RESOLVER_ADDRESS.',
        }
      }

      const contentHash = await gateway.resolveJNS(fullName)
      if (!contentHash) {
        set.status = 404
        return { error: 'Name not found' }
      }

      return {
        name: fullName,
        contentHash: {
          protocol: contentHash.protocol,
          hash: contentHash.hash,
        },
        resolvedAt: Date.now(),
      }
    },
    {
      params: t.Object({
        name: t.String({ minLength: 1 }),
      }),
    },
  )

  .get(
    '/jns/:name/*',
    async ({ params, path, set }) => {
      const jnsPath = path.replace(`/cdn/jns/${params.name}`, '') || '/'

      const gateway = getJNSGateway()
      if (!gateway) {
        set.status = 503
        return { error: 'JNS not configured' }
      }

      const jnsApp = gateway.getApp()
      const newRequest = new Request(
        `http://localhost/jns/${params.name}${jnsPath}`,
      )
      return jnsApp.fetch(newRequest)
    },
    {
      params: t.Object({
        name: t.String({ minLength: 1 }),
        '*': t.String(),
      }),
    },
  )

  .post(
    '/warmup',
    async ({ body }) => {
      let success = 0
      let failed = 0
      for (const url of body.urls) {
        const urlObj = new URL(url)
        const result = await fetcher.fetch(urlObj.pathname, undefined, {
          headers: {},
        })
        if (result.success) {
          const cacheKey = cache.generateKey({ path: urlObj.pathname })
          cache.set(cacheKey, result.body, {
            contentType: result.headers['content-type'],
            headers: result.headers,
            origin: result.origin,
          })
          success++
        } else {
          failed++
        }
      }
      return { success, failed }
    },
    {
      body: t.Object({
        urls: t.Array(t.String({ format: 'uri' }), { minItems: 1 }),
      }),
    },
  )

export type CDNRoutes = typeof cdnRoutes
