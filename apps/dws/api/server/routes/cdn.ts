/**
 * CDN Routes
 *
 * Decentralized CDN API providing:
 * - JNS gateway for serving decentralized apps
 * - IPFS/Arweave content serving
 * - P2P content distribution via WebTorrent
 * - Cache management with geo-routing
 *
 * Architecture:
 * - Permissionless: Anyone can run edge nodes
 * - Decentralized: P2P coordination via libp2p GossipSub
 * - Financialized: Staking, earnings, settlements via contracts
 */

import {
  CDN_TO_P2P_REGION,
  type CDNRegionType,
  getCDNConfig,
  getCDNContracts,
  getCurrentNetwork,
  getJNSContracts,
  getRpcUrl,
  getServiceUrl,
} from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { getAppRegistry } from '../../../src/cdn/app-registry'
import {
  CDNRegion,
  createDefaultCDNCoordinationConfig,
  getCDNCoordinator,
  initializeCDNCoordinator,
  shutdownCDNCoordinator,
} from '../../../src/cdn/coordination'
import {
  getLocalCDNServer,
  initializeLocalCDN,
} from '../../../src/cdn/local-server'
import {
  createHybridCDN,
  type HybridCDN,
  type HybridCDNConfig,
} from '../../../src/cdn/p2p'
import { type EdgeCache, getEdgeCache, getOriginFetcher } from '../../cdn'
import {
  JNSGateway,
  type JNSGatewayConfig,
} from '../../cdn/gateway/jns-gateway'
import type { ContentCategory } from '../../storage/types'

// Get config from packages/config (config-first approach)
const cdnConfig = getCDNConfig()

let jnsGateway: JNSGateway | null = null
let localCDNInitialized = false
let hybridCDN: HybridCDN | null = null
let coordinatorInitialized = false

function getJNSGateway(): JNSGateway | null {
  if (jnsGateway) return jnsGateway

  const jnsContracts = getJNSContracts()

  if (
    !jnsContracts.jnsRegistry ||
    jnsContracts.jnsRegistry === '0x0' ||
    !jnsContracts.jnsResolver ||
    jnsContracts.jnsResolver === '0x0'
  ) {
    return null
  }

  const rpcUrl = getRpcUrl()

  const config: JNSGatewayConfig = {
    port: 0,
    rpcUrl,
    jnsRegistryAddress: jnsContracts.jnsRegistry as Address,
    jnsResolverAddress: jnsContracts.jnsResolver as Address,
    ipfsGateway:
      cdnConfig.edge.ipfsGateway ??
      getServiceUrl('storage', 'ipfsGateway') ??
      'https://ipfs.io',
    arweaveGateway: cdnConfig.edge.arweaveGateway,
    domain: 'jejunetwork.org',
  }

  jnsGateway = new JNSGateway(config)
  return jnsGateway
}

// Initialize edge cache from config
const cache: EdgeCache = getEdgeCache({
  maxSizeBytes: cdnConfig.edge.cache.maxSizeBytes,
  maxEntries: cdnConfig.edge.cache.maxEntries,
  defaultTTL: cdnConfig.edge.cache.defaultTTL,
})
const fetcher = getOriginFetcher()

async function ensureLocalCDNInitialized(): Promise<void> {
  if (localCDNInitialized) return

  const network = getCurrentNetwork()
  const isDevnet = network === 'localnet'
  if (isDevnet) {
    const appsDir = process.cwd().replace('/apps/dws', '/apps')
    await initializeLocalCDN({ appsDir, cacheEnabled: true })
    console.log(`[CDN] Local CDN initialized for devnet (apps: ${appsDir})`)
  }
  localCDNInitialized = true
}

async function ensureHybridCDNInitialized(): Promise<HybridCDN> {
  if (hybridCDN) return hybridCDN

  const p2pConfig = cdnConfig.edge.p2p
  const coordConfig = cdnConfig.edge.coordination

  // Initialize coordinator if not already done
  if (!coordinatorInitialized && p2pConfig.enabled) {
    // Map CDN region to P2P region
    const cdnRegion = cdnConfig.edge.region as CDNRegionType
    const p2pRegion = CDN_TO_P2P_REGION[cdnRegion] ?? 'global'

    // Map P2P region to CDNRegion enum
    const p2pToEnum: Record<string, string> = {
      'na-east': CDNRegion.NA_EAST,
      'na-west': CDNRegion.NA_WEST,
      'eu-west': CDNRegion.EU_WEST,
      'eu-central': CDNRegion.EU_CENTRAL,
      'apac-east': CDNRegion.APAC_EAST,
      'apac-south': CDNRegion.APAC_SOUTH,
      sa: CDNRegion.SA,
      global: CDNRegion.GLOBAL,
    }

    const config = createDefaultCDNCoordinationConfig({
      nodeId: coordConfig.nodeId ?? `cdn-node-${Date.now()}`,
      region: (p2pToEnum[p2pRegion] ??
        CDNRegion.GLOBAL) as (typeof CDNRegion)[keyof typeof CDNRegion],
      endpoint: coordConfig.endpoint ?? cdnConfig.edge.endpoint,
      bootstrapPeers: coordConfig.bootstrapPeers,
    })

    await initializeCDNCoordinator(config).catch((err) => {
      console.warn(`[CDN] Coordinator initialization failed: ${err.message}`)
    })
    coordinatorInitialized = true
  }

  // Create hybrid CDN with optional coordinator
  const coordinator = coordinatorInitialized
    ? getCDNCoordinator(undefined)
    : undefined

  const hybridConfig: Partial<HybridCDNConfig> = {
    enableP2P: p2pConfig.enabled,
    p2pThreshold: p2pConfig.threshold,
    p2pMinSize: p2pConfig.minSize,
    p2pMaxSize: p2pConfig.maxSize,
    autoSeedPopular: p2pConfig.autoSeedPopular,
    popularityThreshold: p2pConfig.popularityThreshold,
    maxSeedingTorrents: p2pConfig.maxSeedingTorrents,
    seedRatioTarget: p2pConfig.seedRatioTarget,
    p2pBandwidthPercent: p2pConfig.bandwidthPercent,
    systemContentPriority: p2pConfig.systemContentPriority,
    p2pTimeout: p2pConfig.timeout,
    fallbackToOrigin: p2pConfig.fallbackToOrigin,
  }

  hybridCDN = createHybridCDN(cache, hybridConfig, coordinator)
  console.log(`[CDN] Hybrid CDN initialized (P2P: ${p2pConfig.enabled})`)

  return hybridCDN
}

export async function shutdownHybridCDN(): Promise<void> {
  if (coordinatorInitialized) {
    await shutdownCDNCoordinator()
    coordinatorInitialized = false
  }
  hybridCDN = null
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
          const { paths } = body as { paths: string[] }
          let purged = 0
          for (const path of paths) {
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
          const { urls } = body as { urls: string[] }
          let success = 0
          let failed = 0

          for (const url of urls) {
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

      // ============================================================================
      // P2P/WebTorrent Routes - Hybrid CDN with P2P distribution
      // ============================================================================

      .get('/p2p/health', async () => {
        const cdn = await ensureHybridCDNInitialized()
        const health = await cdn.healthCheck()

        return {
          status:
            health.webtorrent && health.edgeCache ? 'healthy' : 'degraded',
          service: 'dws-hybrid-cdn',
          components: {
            edgeCache: health.edgeCache ? 'healthy' : 'unhealthy',
            webtorrent: health.webtorrent ? 'healthy' : 'unhealthy',
            p2pEnabled: health.p2pEnabled,
          },
          timestamp: Date.now(),
        }
      })

      .get('/p2p/stats', async () => {
        const cdn = await ensureHybridCDNInitialized()
        const swarmStats = cdn.getSwarmStats()
        const cacheStats = cache.getStats()

        return {
          cache: {
            entries: cacheStats.entries,
            sizeBytes: cacheStats.sizeBytes,
            maxSizeBytes: cacheStats.maxSizeBytes,
            hitRate: cacheStats.hitRate,
          },
          p2p: {
            activeTorrents: swarmStats.activeTorrents,
            seedingTorrents: swarmStats.seedingTorrents,
            totalPeers: swarmStats.totalPeers,
            downloadSpeed: swarmStats.downloadSpeed,
            uploadSpeed: swarmStats.uploadSpeed,
          },
          timestamp: Date.now(),
        }
      })

      .get('/p2p/popular', async ({ query }) => {
        const cdn = await ensureHybridCDNInitialized()
        const limit = parseInt(
          (query as Record<string, string>).limit ?? '100',
          10,
        )
        const popular = cdn.getPopularContent(limit)

        return {
          content: popular.map((p) => ({
            cid: p.cid,
            accessCount: p.accessCount,
            accessCount24h: p.accessCount24h,
            p2pEnabled: p.p2pEnabled,
            magnetUri: p.magnetUri,
            seederCount: p.seederCount,
            downloadCount: p.downloadCount,
          })),
          count: popular.length,
        }
      })

      .get('/p2p/magnet/:cid', async ({ params, set }) => {
        const cdn = await ensureHybridCDNInitialized()
        const { cid } = params
        const magnetUri = cdn.getMagnet(cid)

        if (!magnetUri) {
          set.status = 404
          return { error: 'No magnet URI found for this content' }
        }

        return {
          cid,
          magnetUri,
          hasP2P: cdn.hasP2P(cid),
        }
      })

      .get('/p2p/torrent/:cid/stats', async ({ params, set }) => {
        const cdn = await ensureHybridCDNInitialized()
        const { cid } = params
        const stats = cdn.getTorrentStats(cid)

        if (!stats) {
          set.status = 404
          return { error: 'Torrent not found' }
        }

        return {
          cid,
          stats: {
            peers: stats.peers,
            seeds: stats.seeds,
            downloaded: stats.downloaded,
            uploaded: stats.uploaded,
            downloadSpeed: stats.downloadSpeed,
            uploadSpeed: stats.uploadSpeed,
            progress: stats.progress,
            ratio: stats.ratio,
          },
        }
      })

      .get('/p2p/content/:cid', async ({ params, request }) => {
        const cdn = await ensureHybridCDNInitialized()
        const { cid } = params
        const url = new URL(request.url)
        const cidPath =
          url.pathname.replace(`/cdn/p2p/content/${cid}`, '') || '/'
        const fullPath = `/ipfs/${cid}${cidPath}`

        // Use hybrid CDN with fallback to origin
        const result = await cdn.get(cid, {
          originFetcher: async () => {
            const fetchResult = await fetcher.fetch(fullPath, undefined, {
              headers: {},
            })
            if (!fetchResult.success) {
              throw new Error(
                fetchResult.error ?? 'Failed to fetch from origin',
              )
            }
            return Buffer.from(fetchResult.body)
          },
          contentType: 'application/octet-stream',
        })

        const headers: Record<string, string> = {
          'Content-Type': 'application/octet-stream',
          'X-Cache': result.source === 'edge-cache' ? 'HIT' : 'MISS',
          'X-Source': result.source,
          'X-Latency-Ms': String(result.latencyMs),
          'X-Served-By': 'dws-hybrid-cdn',
        }

        if (result.p2pStats) {
          headers['X-P2P-Peers'] = String(result.p2pStats.peers)
        }

        return new Response(new Uint8Array(result.content), { headers })
      })

      .post(
        '/p2p/seed',
        async ({ body, set }) => {
          const cdn = await ensureHybridCDNInitialized()
          const { cid, name, content, tier, category, enableP2P } = body as {
            cid: string
            name?: string
            content: string // Base64 encoded
            tier?: 'system' | 'popular' | 'private'
            category?: string
            enableP2P?: boolean
          }

          const contentBuffer = Buffer.from(content, 'base64')
          const result = await cdn.put(cid, contentBuffer, {
            name,
            tier: tier ?? 'popular',
            category: category as ContentCategory,
            enableP2P: enableP2P ?? true,
          })

          if (!result.magnetUri) {
            set.status = 500
            return { error: 'Failed to create torrent', cid }
          }

          return {
            success: true,
            cid,
            magnetUri: result.magnetUri,
            hasP2P: cdn.hasP2P(cid),
          }
        },
        {
          body: t.Object({
            cid: t.String(),
            name: t.Optional(t.String()),
            content: t.String(), // Base64 encoded
            tier: t.Optional(
              t.Union([
                t.Literal('system'),
                t.Literal('popular'),
                t.Literal('private'),
              ]),
            ),
            category: t.Optional(t.String()),
            enableP2P: t.Optional(t.Boolean()),
          }),
        },
      )

      .post(
        '/p2p/add-magnet',
        async ({ body }) => {
          const cdn = await ensureHybridCDNInitialized()
          const { cid, magnetUri } = body as { cid: string; magnetUri: string }

          cdn.addMagnet(cid, magnetUri)

          return {
            success: true,
            cid,
            magnetUri,
            hasP2P: cdn.hasP2P(cid),
          }
        },
        {
          body: t.Object({
            cid: t.String(),
            magnetUri: t.String(),
          }),
        },
      )

      .post(
        '/p2p/sync-popular',
        async ({ body }) => {
          const cdn = await ensureHybridCDNInitialized()
          const { content } = body as {
            content: Array<{ cid: string; magnetUri: string; score: number }>
          }

          await cdn.syncPopularContent(content)

          return {
            success: true,
            synced: content.length,
          }
        },
        {
          body: t.Object({
            content: t.Array(
              t.Object({
                cid: t.String(),
                magnetUri: t.String(),
                score: t.Number(),
              }),
            ),
          }),
        },
      )

      .delete('/p2p/seed/:cid', async ({ params }) => {
        const cdn = await ensureHybridCDNInitialized()
        const { cid } = params

        await cdn.stopSeeding(cid)

        return {
          success: true,
          cid,
          hasP2P: cdn.hasP2P(cid),
        }
      })

      // ============================================================================
      // Staking & Billing Routes - Permissionless registration and financialization
      // ============================================================================

      .get('/staking/config', () => {
        const cdnContracts = getCDNContracts()
        const stakingConfig = cdnConfig.staking

        return {
          contracts: {
            cdnRegistry: cdnContracts.cdnRegistry,
            cdnBilling: cdnContracts.cdnBilling,
            cdnCoordinator: cdnContracts.cdnCoordinator,
            contentRegistry: cdnContracts.contentRegistry,
          },
          requirements: {
            minStake: stakingConfig.minStake.toString(),
            settlementInterval: stakingConfig.settlementInterval,
            minSettlementAmount: stakingConfig.minSettlementAmount.toString(),
          },
          p2p: {
            trackers: cdnConfig.edge.p2p.trackers,
            bootstrapPeers: cdnConfig.edge.coordination.bootstrapPeers,
          },
        }
      })

      .get('/staking/regions', () => {
        // Return available regions for edge node registration
        const regions = [
          {
            id: 'us-east-1',
            name: 'US East (N. Virginia)',
            p2pRegion: 'na-east',
          },
          { id: 'us-east-2', name: 'US East (Ohio)', p2pRegion: 'na-east' },
          {
            id: 'us-west-1',
            name: 'US West (N. California)',
            p2pRegion: 'na-west',
          },
          { id: 'us-west-2', name: 'US West (Oregon)', p2pRegion: 'na-west' },
          { id: 'eu-west-1', name: 'EU West (Ireland)', p2pRegion: 'eu-west' },
          { id: 'eu-west-2', name: 'EU West (London)', p2pRegion: 'eu-west' },
          {
            id: 'eu-central-1',
            name: 'EU Central (Frankfurt)',
            p2pRegion: 'eu-central',
          },
          {
            id: 'ap-northeast-1',
            name: 'Asia Pacific (Tokyo)',
            p2pRegion: 'apac-east',
          },
          {
            id: 'ap-northeast-2',
            name: 'Asia Pacific (Seoul)',
            p2pRegion: 'apac-east',
          },
          {
            id: 'ap-southeast-1',
            name: 'Asia Pacific (Singapore)',
            p2pRegion: 'apac-south',
          },
          {
            id: 'ap-southeast-2',
            name: 'Asia Pacific (Sydney)',
            p2pRegion: 'apac-south',
          },
          {
            id: 'ap-south-1',
            name: 'Asia Pacific (Mumbai)',
            p2pRegion: 'apac-south',
          },
          {
            id: 'sa-east-1',
            name: 'South America (São Paulo)',
            p2pRegion: 'sa',
          },
          { id: 'af-south-1', name: 'Africa (Cape Town)', p2pRegion: 'global' },
          {
            id: 'me-south-1',
            name: 'Middle East (Bahrain)',
            p2pRegion: 'global',
          },
          { id: 'global', name: 'Global (Any Region)', p2pRegion: 'global' },
        ]

        return { regions, defaultRegion: 'global' }
      })

      .get('/staking/provider-types', () => {
        // Return available provider types for CDN registration
        return {
          types: [
            {
              id: 0,
              name: 'decentralized',
              description: 'Individual node operator',
            },
            {
              id: 1,
              name: 'enterprise',
              description: 'Enterprise provider with SLA',
            },
            { id: 2, name: 'data_center', description: 'Data center provider' },
            {
              id: 3,
              name: 'residential',
              description: 'Residential node operator',
            },
          ],
          defaultType: 0,
        }
      })

      .get('/network/nodes', async () => {
        // Return connected nodes from coordination
        const coordinator = getCDNCoordinator(undefined)
        if (!coordinator) {
          return {
            nodes: [],
            total: 0,
            message: 'Coordination not initialized',
          }
        }

        const nodes = coordinator.getConnectedNodes()
        return {
          nodes: nodes.map((n) => ({
            nodeId: n.nodeId,
            region: n.region,
            endpoint: n.endpoint,
            lastSeen: n.lastSeen,
            capabilities: n.capabilities,
          })),
          total: nodes.length,
          regions: coordinator.getStats().regions.length,
        }
      })

      .get('/network/stats', async () => {
        const coordinator = getCDNCoordinator(undefined)
        const swarmStats = hybridCDN ? hybridCDN.getSwarmStats() : null
        const cacheStats = cache.getStats()

        return {
          cache: {
            entries: cacheStats.entries,
            sizeBytes: cacheStats.sizeBytes,
            hitRate: cacheStats.hitRate,
          },
          p2p: swarmStats ?? {
            activeTorrents: 0,
            seedingTorrents: 0,
            totalPeers: 0,
            downloadSpeed: 0,
            uploadSpeed: 0,
          },
          coordination: coordinator
            ? coordinator.getStats()
            : { connectedNodes: 0, regionsConnected: 0 },
        }
      })

      // ============================================================================
      // Billing Routes - Usage-based billing and settlements
      // ============================================================================

      .get('/billing/config', () => {
        const cdnContracts = getCDNContracts()
        const stakingConfig = cdnConfig.staking

        return {
          contracts: {
            cdnBilling: cdnContracts.cdnBilling,
            cdnRegistry: cdnContracts.cdnRegistry,
          },
          parameters: {
            minBalance: '0.001', // ETH
            protocolFeeBps: 300, // 3%
            settlementPeriod: 86400, // 1 day in seconds
          },
          rates: {
            pricePerGBEgress: '0.0001', // ETH per GB
            pricePerMillionRequests: '0.00001', // ETH per million requests
            pricePerGBStorage: '0.00005', // ETH per GB per month
          },
          staking: {
            settlementInterval: stakingConfig.settlementInterval,
            minSettlementAmount: stakingConfig.minSettlementAmount.toString(),
            autoClaim: stakingConfig.autoClaim,
            autoCompound: stakingConfig.autoCompound,
          },
        }
      })

      .get('/billing/provider-info', () => {
        // Returns info for providers to understand how billing works
        return {
          howItWorks: {
            step1: 'Register as CDN provider via CDNRegistry contract',
            step2: 'Stake minimum amount to activate edge node',
            step3: 'Start serving traffic and reporting metrics',
            step4: 'Earnings accumulate based on bytes served',
            step5: 'Claim earnings via CDNBilling contract',
          },
          earnings: {
            formula: 'bytesServed * pricePerByte + requests * pricePerRequest',
            settlementPeriod: '24 hours',
            protocolFee: '3%',
            payoutCurrency: 'ETH or JEJU (configurable)',
          },
          requirements: {
            minStake: cdnConfig.staking.minStake.toString(),
            uptimeTarget: '99.5%',
            slashingConditions: [
              'Extended downtime (>4 hours)',
              'Serving malicious content',
              'Bandwidth manipulation',
            ],
          },
        }
      })

      .get('/billing/user-info', () => {
        // Returns info for users (app developers) about billing
        return {
          howItWorks: {
            step1: 'Deposit balance to CDNBilling contract',
            step2: 'Deploy app with JNS name and CDN configuration',
            step3: 'Traffic is served by edge nodes',
            step4: 'Usage is metered and deducted from balance',
            step5: 'Top up balance as needed or enable auto-replenish',
          },
          pricing: {
            egress: '$0.01 per GB equivalent in ETH',
            requests: '$0.001 per million requests',
            storage: '$0.005 per GB per month',
            included: {
              cacheMiss: 'No charge for cache misses',
              p2pEgress: 'P2P egress is free (paid by peers)',
            },
          },
          freeUsage: {
            description: 'Small apps under threshold are free',
            threshold: {
              egress: '10 GB per month',
              requests: '1 million per month',
            },
          },
        }
      })
  )
}
