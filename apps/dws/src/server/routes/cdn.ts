/**
 * CDN Routes
 * Includes JNS gateway for serving decentralized apps
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { type EdgeCache, getEdgeCache, getOriginFetcher } from '../../cdn'
import {
  JNSGateway,
  type JNSGatewayConfig,
} from '../../cdn/gateway/jns-gateway'

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

const cacheMb = parseInt(process.env.DWS_CDN_CACHE_MB || '512', 10)
const maxEntries = parseInt(process.env.DWS_CDN_CACHE_ENTRIES || '100000', 10)
const defaultTTL = parseInt(process.env.DWS_CDN_DEFAULT_TTL || '3600', 10)

const cache: EdgeCache = getEdgeCache({
  maxSizeBytes: cacheMb * 1024 * 1024,
  maxEntries,
  defaultTTL,
})
const fetcher = getOriginFetcher()

export function createCDNRouter() {
  return new Elysia({ prefix: '/cdn' })
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
      { body: t.Object({ paths: t.Array(t.String(), { minItems: 1 }) }) },
    )
    .post('/purge', () => {
      const stats = cache.getStats()
      cache.clear()
      return { success: true, entriesPurged: stats.entries }
    })
    .get('/ipfs/:cid', async ({ params, request, set }) => {
      const cid = params.cid
      const url = new URL(request.url)
      const cidPath = url.pathname.replace(`/cdn/ipfs/${cid}`, '') || '/'
      const cacheKey = cache.generateKey({ path: `/ipfs/${cid}${cidPath}` })

      const { entry, status } = cache.get(cacheKey)
      if (entry && (status === 'HIT' || status === 'STALE')) {
        const headers: Record<string, string> = {
          ...entry.metadata.headers,
          'X-Cache': status,
          'X-Served-By': 'dws-cdn',
        }
        return new Response(new Uint8Array(entry.data), { headers })
      }

      const result = await fetcher.fetch(`/ipfs/${cid}${cidPath}`, undefined, {
        headers: {},
      })

      if (!result.success) {
        set.status = 404
        return { error: result.error || 'Content not found' }
      }

      const cacheControl = result.headers['cache-control'] || ''
      cache.set(cacheKey, result.body, {
        contentType: result.headers['content-type'],
        headers: result.headers,
        origin: result.origin,
        cacheControl,
        immutable: cacheControl.includes('immutable'),
      })

      const headers: Record<string, string> = {
        ...result.headers,
        'X-Cache': 'MISS',
        'X-Served-By': 'dws-cdn',
      }
      return new Response(new Uint8Array(result.body), { headers })
    })
    .get('/resolve/:name', async ({ params, set }) => {
      const name = params.name
      const fullName = name.endsWith('.jns') ? name : `${name}.jns`

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
        contentHash: { protocol: contentHash.protocol, hash: contentHash.hash },
        resolvedAt: Date.now(),
      }
    })
    .get('/jns/:name/*', async ({ params, request, set }) => {
      const name = params.name
      const url = new URL(request.url)
      const jnsPath = url.pathname.replace(`/cdn/jns/${name}`, '') || '/'

      const gateway = getJNSGateway()
      if (!gateway) {
        set.status = 503
        return { error: 'JNS not configured' }
      }

      const jnsApp = gateway.getApp()
      const newRequest = new Request(`http://localhost/jns/${name}${jnsPath}`)
      return jnsApp.fetch(newRequest)
    })
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
      { body: t.Object({ urls: t.Array(t.String(), { minItems: 1 }) }) },
    )
}
