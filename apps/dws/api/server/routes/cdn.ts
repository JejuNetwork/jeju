/**
 * CDN Routes
 * Includes:
 * - JNS gateway for serving decentralized apps
 * - Local CDN for serving all Jeju app frontends in devnet
 * - IPFS content serving
 * - Cache management
 */

import {
  createAppConfig,
  getContract,
  getRpcUrl,
  getServiceUrl,
} from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { getAppRegistry } from '../../../src/cdn/app-registry'
import {
  getLocalCDNServer,
  initializeLocalCDN,
} from '../../../src/cdn/local-server'
import { type EdgeCache, getEdgeCache, getOriginFetcher } from '../../cdn'
import {
  JNSGateway,
  type JNSGatewayConfig,
} from '../../cdn/gateway/jns-gateway'

interface CDNRouterConfig {
  jnsRegistryAddress?: string
  jnsResolverAddress?: string
  rpcUrl?: string
  ipfsGatewayUrl?: string
  arweaveGatewayUrl?: string
  jnsDomain?: string
  cacheMb?: number
  maxEntries?: number
  defaultTTL?: number
  isDevnet?: boolean
  jejuAppsDir?: string
  nodeEnv?: string
  [key: string]: string | number | boolean | undefined
}

const { config: cdnRouterConfig, configure: configureCDNRouter } =
  createAppConfig<CDNRouterConfig>({
    cacheMb: 512,
    maxEntries: 100000,
    defaultTTL: 3600,
    ipfsGatewayUrl: 'https://ipfs.io',
    arweaveGatewayUrl: 'https://arweave.net',
    jnsDomain: 'jejunetwork.org',
    jejuAppsDir: '/apps',
  })

export function configureCDNRouterConfig(
  config: Partial<CDNRouterConfig>,
): void {
  configureCDNRouter(config)
}

let jnsGateway: JNSGateway | null = null
let localCDNInitialized = false

function getJNSGateway(): JNSGateway | null {
  if (jnsGateway) return jnsGateway

  const jnsRegistry =
    cdnRouterConfig.jnsRegistryAddress || getContract('jns', 'jnsRegistry')
  const jnsResolver =
    cdnRouterConfig.jnsResolverAddress || getContract('jns', 'jnsResolver')

  if (
    !jnsRegistry ||
    jnsRegistry === '0x0' ||
    !jnsResolver ||
    jnsResolver === '0x0'
  ) {
    return null
  }

  const rpcUrl = cdnRouterConfig.rpcUrl || getRpcUrl()

  const config: JNSGatewayConfig = {
    port: 0,
    rpcUrl,
    jnsRegistryAddress: jnsRegistry as Address,
    jnsResolverAddress: jnsResolver as Address,
    ipfsGateway:
      cdnRouterConfig.ipfsGatewayUrl ??
      getServiceUrl('storage', 'ipfsGateway') ??
      'https://ipfs.io',
    arweaveGateway: cdnRouterConfig.arweaveGatewayUrl ?? 'https://arweave.net',
    domain: cdnRouterConfig.jnsDomain ?? 'jejunetwork.org',
  }

  jnsGateway = new JNSGateway(config)
  return jnsGateway
}

const cacheMb = cdnRouterConfig.cacheMb ?? 512
const maxEntries = cdnRouterConfig.maxEntries ?? 100000
const defaultTTL = cdnRouterConfig.defaultTTL ?? 3600

const cache: EdgeCache = getEdgeCache({
  maxSizeBytes: cacheMb * 1024 * 1024,
  maxEntries,
  defaultTTL,
})
const fetcher = getOriginFetcher()

async function ensureLocalCDNInitialized(): Promise<void> {
  if (localCDNInitialized) return

  const isDevnet =
    cdnRouterConfig.isDevnet ??
    (cdnRouterConfig.nodeEnv !== 'production' || false)
  if (isDevnet) {
    // Use config or default path (workerd-compatible - no process.cwd())
    const appsDir = cdnRouterConfig.jejuAppsDir ?? '/apps'
    await initializeLocalCDN({ appsDir, cacheEnabled: true })
    console.log(`[CDN] Local CDN initialized for devnet (apps: ${appsDir})`)
  }
  localCDNInitialized = true
}

export function createCDNRouter() {
  // Initialize local CDN on router creation
  ensureLocalCDNInitialized().catch((e) => {
    console.warn(
      `[CDN] Local CDN initialization failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
    )
  })

  return (
    new Elysia({ prefix: '/cdn' })
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

        const result = await fetcher.fetch(
          `/ipfs/${cid}${cidPath}`,
          undefined,
          {
            headers: {},
          },
        )

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
          contentHash: {
            protocol: contentHash.protocol,
            hash: contentHash.hash,
          },
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
          mode:
            cdnRouterConfig.nodeEnv === 'production' ? 'production' : 'devnet',
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

      .get('/apps/:appName/*', async ({ params, request }) => {
        const { appName } = params
        const localCDN = getLocalCDNServer()

        const url = new URL(request.url)
        const appPath = url.pathname.replace(`/cdn/apps/${appName}`, '') || '/'
        const cdnRequest = new Request(
          `http://localhost/apps/${appName}${appPath}`,
        )

        // Return the Response directly - Elysia passes through Response objects with headers intact
        return localCDN.handleRequest(cdnRequest)
      })

      // Serve app by JNS name (e.g., /cdn/jns-app/dws.jeju/)
      .get('/jns-app/:jnsName/*', async ({ params, request, set }) => {
        const { jnsName } = params
        const registry = getAppRegistry()
        const apps = registry.getEnabledApps()
        const app = apps.find(
          (a) => a.jnsName === jnsName || a.jnsName === `${jnsName}.jeju`,
        )

        if (!app) {
          set.status = 404
          return { error: `App not found for JNS name: ${jnsName}` }
        }

        const localCDN = getLocalCDNServer()
        const url = new URL(request.url)
        const appPath =
          url.pathname.replace(`/cdn/jns-app/${jnsName}`, '') || '/'
        const cdnRequest = new Request(
          `http://localhost/apps/${app.name}${appPath}`,
        )

        return localCDN.handleRequest(cdnRequest)
      })
  )
}
