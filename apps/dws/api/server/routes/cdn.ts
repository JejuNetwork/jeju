/**
 * CDN Routes
 * Includes:
 * - JNS gateway for serving decentralized apps
 * - Local CDN for serving all Jeju app frontends in devnet
 * - IPFS content serving
 * - Cache management
 */

import { getContract, getRpcUrl, getServiceUrl } from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { type EdgeCache, getEdgeCache, getOriginFetcher } from '../../cdn'
import { getAppRegistry, initializeAppRegistry } from '../../../src/cdn/app-registry'
import { getLocalCDNServer, initializeLocalCDN } from '../../../src/cdn/local-server'
import {
  JNSGateway,
  type JNSGatewayConfig,
} from '../../cdn/gateway/jns-gateway'

let jnsGateway: JNSGateway | null = null
let localCDNInitialized = false

function getJNSGateway(): JNSGateway | null {
  if (jnsGateway) return jnsGateway

  const jnsRegistry = process.env.JNS_REGISTRY_ADDRESS || getContract('naming', 'jnsRegistry')
  const jnsResolver = process.env.JNS_RESOLVER_ADDRESS || getContract('naming', 'jnsResolver')

  if (
    !jnsRegistry ||
    jnsRegistry === '0x0' ||
    !jnsResolver ||
    jnsResolver === '0x0'
  ) {
    return null
  }

  const rpcUrl = process.env.RPC_URL || getRpcUrl()

  const config: JNSGatewayConfig = {
    port: 0,
    rpcUrl,
    jnsRegistryAddress: jnsRegistry as Address,
    jnsResolverAddress: jnsResolver as Address,
    ipfsGateway: process.env.IPFS_GATEWAY_URL ?? getServiceUrl('storage', 'ipfsGateway') ?? 'https://ipfs.io',
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

async function ensureLocalCDNInitialized(): Promise<void> {
  if (localCDNInitialized) return

  const isDevnet = process.env.NODE_ENV !== 'production' || process.env.DEVNET === 'true'
  if (isDevnet) {
    const appsDir = process.env.JEJU_APPS_DIR ?? process.cwd().replace('/apps/dws', '/apps')
    await initializeLocalCDN({ appsDir, cacheEnabled: true })
    console.log(`[CDN] Local CDN initialized for devnet (apps: ${appsDir})`)
  }
  localCDNInitialized = true
}

export function createCDNRouter() {
  // Initialize local CDN on router creation
  ensureLocalCDNInitialized().catch((e) => {
    console.warn(`[CDN] Local CDN initialization failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
  })

  return new Elysia({ prefix: '/cdn' })
    .get('/health', () => {
      const stats = cache.getStats()
      const registry = getAppRegistry()
      const apps = registry.getEnabledApps()

      return {
        status: 'healthy' as const,
        service: 'dws-cdn',
        cache: {
          entries: stats.entries,
          sizeBytes: stats.sizeBytes,
          maxSizeBytes: stats.maxSizeBytes,
          hitRate: stats.hitRate,
        },
        apps: {
          registered: apps.length,
          names: apps.map((a) => a.name),
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

    // === Jeju App Frontend Routes (Local Devnet) ===

    .get('/apps', () => {
      const registry = getAppRegistry()
      const apps = registry.getEnabledApps().map((app) => ({
        name: app.name,
        displayName: app.displayName,
        jnsName: app.jnsName,
        port: app.port,
        spa: app.spa,
        staticDir: app.staticDir,
        cid: app.cid,
        routes: {
          frontend: `/cdn/apps/${app.name}/`,
          proxy: `http://localhost:${app.port}`,
        },
      }))

      return {
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'devnet',
        apps,
        count: apps.length,
      }
    })

    .get('/apps/:appName', async ({ params, set }) => {
      const { appName } = params
      const registry = getAppRegistry()
      const app = registry.getApp(appName)

      if (!app) {
        set.status = 404
        return { error: `App not found: ${appName}` }
      }

      return {
        name: app.name,
        displayName: app.displayName,
        jnsName: app.jnsName,
        port: app.port,
        spa: app.spa,
        staticDir: app.staticDir,
        absoluteDir: app.absoluteDir,
        cid: app.cid,
        cacheRules: app.cacheRules,
        routes: {
          index: `/cdn/apps/${app.name}/`,
          assets: `/cdn/apps/${app.name}/assets/`,
        },
      }
    })

    .get('/apps/:appName/*', async ({ params, request, set }) => {
      const { appName } = params
      const localCDN = getLocalCDNServer()

      // Construct request for local CDN
      const url = new URL(request.url)
      const appPath = url.pathname.replace(`/cdn/apps/${appName}`, '') || '/'
      const cdnRequest = new Request(`http://localhost/apps/${appName}${appPath}`)

      const response = await localCDN.handleRequest(cdnRequest)

      // Copy response headers
      const headers = new Headers(response.headers)
      set.status = response.status

      if (response.status === 200) {
        const body = await response.arrayBuffer()
        return new Response(body, { headers })
      }

      return response.json()
    })

    // Serve app by JNS name (e.g., /cdn/jns-app/dws.jeju/)
    .get('/jns-app/:jnsName/*', async ({ params, request, set }) => {
      const { jnsName } = params
      const registry = getAppRegistry()
      const apps = registry.getEnabledApps()
      const app = apps.find((a) => a.jnsName === jnsName || a.jnsName === `${jnsName}.jeju`)

      if (!app) {
        set.status = 404
        return { error: `App not found for JNS name: ${jnsName}` }
      }

      const localCDN = getLocalCDNServer()
      const url = new URL(request.url)
      const appPath = url.pathname.replace(`/cdn/jns-app/${jnsName}`, '') || '/'
      const cdnRequest = new Request(`http://localhost/apps/${app.name}${appPath}`)

      const response = await localCDN.handleRequest(cdnRequest)
      const headers = new Headers(response.headers)
      set.status = response.status

      if (response.status === 200) {
        const body = await response.arrayBuffer()
        return new Response(body, { headers })
      }

      return response.json()
    })
}
