/**
 * DWS Server
 * Decentralized Web Services - Storage, Compute, CDN, and Git
 *
 * Fully decentralized architecture:
 * - Frontend served from IPFS/CDN
 * - Node discovery via on-chain registry
 * - P2P coordination between nodes
 * - Distributed rate limiting
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { createAgentRouter, initExecutor, initRegistry } from '../agents'
import { initializeMarketplace } from '../api-marketplace'
import { WorkflowEngine } from '../ci/workflow-engine'
import { initializeContainerSystem } from '../containers'
import {
  createDecentralizedServices,
  type DistributedRateLimiter,
  type P2PCoordinator,
} from '../decentralized'
import { createEmailRouter } from '../email/routes'
import { GitRepoManager } from '../git/repo-manager'
import {
  createHelmProviderRouter,
  createK3sRouter,
  createTerraformProviderRouter,
  setDeploymentContext,
} from '../infrastructure'
// Ban check middleware available for future use
// import { banCheckMiddleware } from '../middleware/ban-check'
import { PkgRegistryManager } from '../pkg/registry-manager'
import { createBackendManager } from '../storage/backends'
import type { ServiceHealth } from '../types'
import { WorkerdExecutor } from '../workers/workerd/executor'
import {
  a2aRoutes,
  cdnRoutes,
  computeRoutes,
  createAPIMarketplaceRouter,
  createCIRouter,
  createContainerRouter,
  createDARouter,
  createDefaultWorkerdRouter,
  createEdgeRouter,
  createFundingRouter,
  createGitRouter,
  createKMSRouter,
  createMCPRouter,
  createModerationRouter,
  createOAuth3Router,
  createPkgRegistryProxyRouter,
  createPkgRouter,
  createPricesRouter,
  createS3Router,
  createScrapingRouter,
  createVPNRouter,
  createWorkersRouter,
  getPriceService,
  handleEdgeWebSocket,
  rpcRoutes,
  type SubscribableWebSocket,
  shutdownDA,
  storageRoutes,
} from './routes'

// Server port
const PORT = parseInt(process.env.DWS_PORT || process.env.PORT || '4030', 10)

// Rate limiter store
interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX = process.env.NODE_ENV === 'test' ? 100000 : 1000
const SKIP_RATE_LIMIT_PATHS = ['/health', '/.well-known/']

// Cleanup stale rate limit entries periodically
const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key)
    }
  }
}, RATE_LIMIT_WINDOW_MS)

const backendManager = createBackendManager()

// Environment validation
const isProduction = process.env.NODE_ENV === 'production'
const LOCALNET_DEFAULTS = {
  rpcUrl: 'http://localhost:6546',
  repoRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  packageRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  triggerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  identityRegistry: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  const value = process.env[key]
  if (!value && isProduction) {
    throw new Error(
      `Required environment variable ${key} is not set in production`,
    )
  }
  return value || defaultValue
}

// Git configuration
const gitConfig = {
  rpcUrl: getEnvOrDefault('RPC_URL', LOCALNET_DEFAULTS.rpcUrl),
  repoRegistryAddress: getEnvOrDefault(
    'REPO_REGISTRY_ADDRESS',
    LOCALNET_DEFAULTS.repoRegistry,
  ) as Address,
  privateKey: process.env.DWS_PRIVATE_KEY as Hex | undefined,
}

const repoManager = new GitRepoManager(gitConfig, backendManager)

// Package registry configuration
const pkgConfig = {
  rpcUrl: getEnvOrDefault('RPC_URL', LOCALNET_DEFAULTS.rpcUrl),
  packageRegistryAddress: getEnvOrDefault(
    'PACKAGE_REGISTRY_ADDRESS',
    LOCALNET_DEFAULTS.packageRegistry,
  ) as Address,
  privateKey: process.env.DWS_PRIVATE_KEY as Hex | undefined,
}

const registryManager = new PkgRegistryManager(pkgConfig, backendManager)

// CI configuration
const ciConfig = {
  rpcUrl: getEnvOrDefault('RPC_URL', LOCALNET_DEFAULTS.rpcUrl),
  triggerRegistryAddress: getEnvOrDefault(
    'TRIGGER_REGISTRY_ADDRESS',
    LOCALNET_DEFAULTS.triggerRegistry,
  ) as Address,
  privateKey: process.env.DWS_PRIVATE_KEY as Hex | undefined,
}

const workflowEngine = new WorkflowEngine(ciConfig, backendManager, repoManager)

// Decentralized services configuration
const decentralizedConfig = {
  rpcUrl: getEnvOrDefault('RPC_URL', LOCALNET_DEFAULTS.rpcUrl),
  identityRegistryAddress: getEnvOrDefault(
    'IDENTITY_REGISTRY_ADDRESS',
    LOCALNET_DEFAULTS.identityRegistry,
  ) as Address,
  frontendCid: process.env.DWS_FRONTEND_CID,
}

const decentralized = createDecentralizedServices(
  decentralizedConfig,
  backendManager,
)
let p2pCoordinator: P2PCoordinator | null = null
let distributedRateLimiter: DistributedRateLimiter | null = null

// DA Layer config
const daConfig = {
  operatorPrivateKey: process.env.DA_OPERATOR_PRIVATE_KEY as Hex | undefined,
  operatorEndpoint: process.env.DWS_BASE_URL || `http://localhost:${PORT}`,
  operatorRegion: process.env.DA_OPERATOR_REGION || 'default',
  operatorCapacityGB: parseInt(
    process.env.DA_OPERATOR_CAPACITY_GB || '100',
    10,
  ),
  daContractAddress: process.env.DA_CONTRACT_ADDRESS as Address | undefined,
  rpcUrl: getEnvOrDefault('RPC_URL', LOCALNET_DEFAULTS.rpcUrl),
}

// Elysia route instances (for use() mounting with type safety)
const elysiaRoutes = {
  oauth3: () => createOAuth3Router(),
  kms: () => createKMSRouter(),
  vpn: () => createVPNRouter(),
  scraping: () => createScrapingRouter(),
  prices: () => createPricesRouter(),
  moderation: () => createModerationRouter(),
  mcp: () => createMCPRouter(),
  s3: () => createS3Router(backendManager),
  workers: () => createWorkersRouter(backendManager),
  workerd: () => createDefaultWorkerdRouter(backendManager),
  containers: () => createContainerRouter(),
  da: () => createDARouter(daConfig),
  git: () => createGitRouter({ repoManager, backend: backendManager }),
  pkg: () => createPkgRouter({ registryManager, backend: backendManager }),
  ci: () =>
    createCIRouter({ workflowEngine, repoManager, backend: backendManager }),
  api: () => createAPIMarketplaceRouter(),
  registry: () => createPkgRegistryProxyRouter(),
  agents: () => createAgentRouter(),
}

// Routes mounted via fetch handlers
const mountedRoutes = {
  edge: () => createEdgeRouter(),
  email: () => createEmailRouter(),
  funding: () => createFundingRouter(),
  k3s: () => createK3sRouter(),
  helm: () => createHelmProviderRouter(),
  terraform: () => createTerraformProviderRouter(),
}

// Initialize deployment context
setDeploymentContext({
  localDockerEnabled: true,
  nodeEndpoints: process.env.DWS_NODE_ENDPOINTS?.split(',') || [],
  k3sCluster: process.env.DWS_K3S_CLUSTER,
})

// Main Elysia app
export const app = new Elysia({ name: 'dws' })
  .use(cors({ origin: '*' }))

  // Rate limiting middleware
  .onBeforeHandle(({ path, request, set }) => {
    if (SKIP_RATE_LIMIT_PATHS.some((p) => path.startsWith(p))) {
      return undefined
    }

    const forwardedFor = request.headers.get('x-forwarded-for')
    const clientIp =
      forwardedFor?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      request.headers.get('cf-connecting-ip') ||
      'local'
    const now = Date.now()

    let entry = rateLimitStore.get(clientIp)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
      rateLimitStore.set(clientIp, entry)
    }

    entry.count++

    set.headers['X-RateLimit-Limit'] = String(RATE_LIMIT_MAX)
    set.headers['X-RateLimit-Remaining'] = String(
      Math.max(0, RATE_LIMIT_MAX - entry.count),
    )
    set.headers['X-RateLimit-Reset'] = String(Math.ceil(entry.resetAt / 1000))

    if (entry.count > RATE_LIMIT_MAX) {
      set.status = 429
      return {
        error: 'Too Many Requests',
        message: 'Rate limit exceeded',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      }
    }

    return undefined
  })

  // Error handler
  .onError(({ error, set }) => {
    const message = 'message' in error ? String(error.message) : String(error)
    const lowerMessage = message.toLowerCase()

    const isAuthError =
      lowerMessage.includes('x-jeju-address') ||
      lowerMessage.includes('authentication') ||
      lowerMessage.includes('x-jeju-signature') ||
      lowerMessage.includes('x-jeju-nonce')

    const isNotFound = lowerMessage.includes('not found')

    const isForbidden =
      lowerMessage.includes('access denied') ||
      lowerMessage.includes('permission') ||
      lowerMessage.includes('not authorized')

    const isBadRequest =
      lowerMessage.includes('invalid') ||
      lowerMessage.includes('required') ||
      lowerMessage.includes('validation failed') ||
      lowerMessage.includes('expected') ||
      lowerMessage.includes('no version data') ||
      lowerMessage.includes('no attachment') ||
      lowerMessage.includes('unknown tool') ||
      lowerMessage.includes('unknown resource') ||
      lowerMessage.includes('unsupported')

    set.status = isAuthError
      ? 401
      : isNotFound
        ? 404
        : isForbidden
          ? 403
          : isBadRequest
            ? 400
            : 500

    return { error: message }
  })

  // Health endpoint
  .get('/health', async () => {
    const backends = backendManager.listBackends()
    const backendHealth = await backendManager.healthCheck()
    const nodeCount = await decentralized.discovery
      .getNodeCount()
      .catch(() => 0)
    const peerCount = p2pCoordinator?.getPeers().length ?? 0
    const frontendCid = await decentralized.frontend.getFrontendCid()

    const health: ServiceHealth = {
      status: 'healthy',
      service: 'dws',
      version: '1.0.0',
      uptime: process.uptime() * 1000,
    }

    return {
      ...health,
      decentralized: {
        identityRegistry: decentralizedConfig.identityRegistryAddress,
        registeredNodes: nodeCount,
        connectedPeers: peerCount,
        frontendCid: frontendCid ?? 'local',
        p2pEnabled: p2pCoordinator !== null,
      },
      services: {
        storage: { status: 'healthy', backends },
        compute: { status: 'healthy' },
        cdn: { status: 'healthy' },
        git: { status: 'healthy' },
        pkg: { status: 'healthy' },
        ci: { status: 'healthy' },
        oauth3: {
          status: process.env.OAUTH3_AGENT_URL ? 'available' : 'not-configured',
        },
        s3: { status: 'healthy' },
        workers: { status: 'healthy' },
        workerd: { status: 'healthy', runtime: 'V8 isolates' },
        agents: { status: 'healthy', description: 'ElizaOS agent runtime' },
        kms: { status: 'healthy' },
        vpn: { status: 'healthy' },
        scraping: { status: 'healthy' },
        rpc: { status: 'healthy' },
        da: { status: 'healthy', description: 'Data Availability layer' },
      },
      backends: { available: backends, health: backendHealth },
    }
  })

  // Root endpoint
  .get('/', () => ({
    name: 'DWS',
    description: 'Decentralized Web Services',
    version: '1.0.0',
    services: [
      'storage',
      'compute',
      'cdn',
      'git',
      'pkg',
      'ci',
      'oauth3',
      'api-marketplace',
      'containers',
      's3',
      'workers',
      'workerd',
      'kms',
      'vpn',
      'scraping',
      'rpc',
      'edge',
      'da',
      'funding',
      'registry',
    ],
    endpoints: {
      storage: '/storage/*',
      compute: '/compute/*',
      cdn: '/cdn/*',
      git: '/git/*',
      pkg: '/pkg/*',
      ci: '/ci/*',
      oauth3: '/oauth3/*',
      api: '/api/*',
      containers: '/containers/*',
      a2a: '/a2a/*',
      mcp: '/mcp/*',
      s3: '/s3/*',
      workers: '/workers/*',
      workerd: '/workerd/*',
      kms: '/kms/*',
      vpn: '/vpn/*',
      scraping: '/scraping/*',
      rpc: '/rpc/*',
      edge: '/edge/*',
      da: '/da/*',
      funding: '/funding/*',
      registry: '/registry/*',
    },
  }))

  // Mount Elysia routes
  .use(storageRoutes)
  .use(computeRoutes)
  .use(cdnRoutes)
  .use(a2aRoutes)

  // Internal P2P endpoints
  .get('/internal/ratelimit/:clientKey', ({ params }) => {
    const count = distributedRateLimiter?.getLocalCount(params.clientKey) ?? 0
    return { count }
  })

  .get('/internal/peers', () => {
    const peers = p2pCoordinator?.getPeers() ?? []
    return {
      peers: peers.map((p) => ({
        agentId: p.agentId.toString(),
        endpoint: p.endpoint,
        owner: p.owner,
        stake: p.stake.toString(),
        isBanned: p.isBanned,
      })),
    }
  })

  // Agent card for discovery
  .get('/.well-known/agent-card.json', () => {
    const baseUrl = process.env.DWS_BASE_URL || `http://localhost:${PORT}`
    return {
      name: 'DWS',
      description: 'Decentralized Web Services',
      version: '1.0.0',
      url: baseUrl,
      capabilities: [
        { name: 'storage', endpoint: `${baseUrl}/storage` },
        { name: 'compute', endpoint: `${baseUrl}/compute` },
        { name: 'cdn', endpoint: `${baseUrl}/cdn` },
        { name: 'git', endpoint: `${baseUrl}/git` },
        { name: 'pkg', endpoint: `${baseUrl}/pkg` },
        { name: 'ci', endpoint: `${baseUrl}/ci` },
        { name: 'oauth3', endpoint: `${baseUrl}/oauth3` },
        {
          name: 's3',
          endpoint: `${baseUrl}/s3`,
          description: 'S3-compatible object storage',
        },
        {
          name: 'workers',
          endpoint: `${baseUrl}/workers`,
          description: 'Serverless functions (Bun)',
        },
        {
          name: 'workerd',
          endpoint: `${baseUrl}/workerd`,
          description: 'V8 isolate workers (Cloudflare compatible)',
        },
        {
          name: 'kms',
          endpoint: `${baseUrl}/kms`,
          description: 'Key management service',
        },
        {
          name: 'vpn',
          endpoint: `${baseUrl}/vpn`,
          description: 'VPN/Proxy service',
        },
        {
          name: 'scraping',
          endpoint: `${baseUrl}/scraping`,
          description: 'Web scraping service',
        },
        {
          name: 'rpc',
          endpoint: `${baseUrl}/rpc`,
          description: 'Multi-chain RPC service',
        },
        {
          name: 'da',
          endpoint: `${baseUrl}/da`,
          description: 'Data Availability layer',
        },
      ],
      a2aEndpoint: `${baseUrl}/a2a`,
      mcpEndpoint: `${baseUrl}/mcp`,
    }
  })

  // Frontend serving
  .get('/app', async ({ set }) => {
    const decentralizedResponse =
      await decentralized.frontend.serveAsset('index.html')
    if (decentralizedResponse) return decentralizedResponse

    const file = Bun.file('./frontend/index.html')
    if (await file.exists()) {
      const html = await file.text()
      set.headers['Content-Type'] = 'text/html'
      set.headers['X-DWS-Source'] = 'local'
      return html
    }

    set.status = 404
    return {
      error:
        'Frontend not available. Set DWS_FRONTEND_CID or run in development mode.',
    }
  })

  .get('/app/ci', async ({ set }) => {
    const decentralizedResponse =
      await decentralized.frontend.serveAsset('ci.html')
    if (decentralizedResponse) return decentralizedResponse

    const file = Bun.file('./frontend/ci.html')
    if (await file.exists()) {
      const html = await file.text()
      set.headers['Content-Type'] = 'text/html'
      set.headers['X-DWS-Source'] = 'local'
      return html
    }

    set.status = 404
    return { error: 'CI frontend not available' }
  })

  .get('/app/da', async ({ set }) => {
    const decentralizedResponse =
      await decentralized.frontend.serveAsset('da.html')
    if (decentralizedResponse) return decentralizedResponse

    const file = Bun.file('./frontend/da.html')
    if (await file.exists()) {
      const html = await file.text()
      set.headers['Content-Type'] = 'text/html'
      set.headers['X-DWS-Source'] = 'local'
      return html
    }

    set.status = 404
    return { error: 'DA dashboard not available' }
  })

  .get('/app/*', async ({ path, set }) => {
    const assetPath = path.replace('/app', '')
    const decentralizedResponse =
      await decentralized.frontend.serveAsset(assetPath)
    if (decentralizedResponse) return decentralizedResponse

    const file = Bun.file('./frontend/index.html')
    if (await file.exists()) {
      const html = await file.text()
      set.headers['Content-Type'] = 'text/html'
      set.headers['X-DWS-Source'] = 'local'
      return html
    }

    set.status = 404
    return { error: 'Frontend not available' }
  })

  // Elysia routes with built-in prefixes (use() for type safety)
  .use(elysiaRoutes.oauth3())
  .use(elysiaRoutes.kms())
  .use(elysiaRoutes.vpn())
  .use(elysiaRoutes.scraping())
  .use(elysiaRoutes.prices())
  .use(elysiaRoutes.moderation())
  .use(elysiaRoutes.mcp())
  .use(elysiaRoutes.s3())
  .use(elysiaRoutes.workers())
  .use(elysiaRoutes.workerd())
  .use(elysiaRoutes.containers())
  .use(elysiaRoutes.da())
  .use(elysiaRoutes.git())
  .use(elysiaRoutes.pkg())
  .use(elysiaRoutes.ci())
  .use(elysiaRoutes.api())
  .use(elysiaRoutes.registry())
  .use(elysiaRoutes.agents())
  .use(rpcRoutes)

  // Routes mounted via fetch handlers
  .mount('/edge', mountedRoutes.edge().fetch)
  .mount('/email', mountedRoutes.email().fetch)
  .mount('/funding', mountedRoutes.funding().fetch)
  .mount('/k3s', mountedRoutes.k3s().fetch)
  .mount('/', mountedRoutes.helm().fetch)
  .mount('/', mountedRoutes.terraform().fetch)

// Export app type for Eden
export type App = typeof app

let server: ReturnType<typeof Bun.serve> | null = null

function shutdown(signal: string) {
  console.log(`[DWS] Received ${signal}, shutting down gracefully...`)
  clearInterval(rateLimitCleanupInterval)
  shutdownDA()
  console.log('[DWS] DA layer stopped')
  if (p2pCoordinator) {
    p2pCoordinator.stop()
    console.log('[DWS] P2P coordinator stopped')
  }
  if (server) {
    server.stop()
    console.log('[DWS] Server stopped')
  }
  process.exit(0)
}

if (import.meta.main) {
  // Initialize services
  initializeMarketplace()
  initializeContainerSystem()

  const CQL_URL =
    process.env.CQL_BLOCK_PRODUCER_ENDPOINT ?? 'http://127.0.0.1:4028'
  const AGENTS_DB_ID = process.env.AGENTS_DATABASE_ID ?? 'dws-agents'
  initRegistry({ cqlUrl: CQL_URL, databaseId: AGENTS_DB_ID }).catch((err) => {
    console.warn(
      '[DWS] Agent registry init failed (CQL may not be running):',
      err.message,
    )
  })

  const workerdExecutor = new WorkerdExecutor(backendManager)
  workerdExecutor
    .initialize()
    .then(() => {
      // Cast to IWorkerdExecutor - the implementation satisfies the interface
      initExecutor(workerdExecutor as Parameters<typeof initExecutor>[0], {
        inferenceUrl:
          process.env.DWS_INFERENCE_URL ?? 'http://127.0.0.1:4030/compute',
        kmsUrl: process.env.DWS_KMS_URL ?? 'http://127.0.0.1:4030/kms',
        cqlUrl: CQL_URL,
      })
      console.log('[DWS] Agent executor initialized')
    })
    .catch((err) => {
      console.warn('[DWS] Agent executor init failed:', err.message)
    })

  const baseUrl = process.env.DWS_BASE_URL || `http://localhost:${PORT}`

  console.log(`[DWS] Running at ${baseUrl}`)
  console.log(
    `[DWS] Environment: ${isProduction ? 'production' : 'development'}`,
  )
  console.log(`[DWS] Git registry: ${gitConfig.repoRegistryAddress}`)
  console.log(`[DWS] Package registry: ${pkgConfig.packageRegistryAddress}`)
  console.log(
    `[DWS] Identity registry (ERC-8004): ${decentralizedConfig.identityRegistryAddress}`,
  )

  if (decentralizedConfig.frontendCid) {
    console.log(`[DWS] Frontend CID: ${decentralizedConfig.frontendCid}`)
  } else {
    console.log(
      `[DWS] Frontend: local filesystem (set DWS_FRONTEND_CID for decentralized)`,
    )
  }

  // Start P2P coordination if enabled
  if (process.env.DWS_P2P_ENABLED === 'true') {
    p2pCoordinator = decentralized.createP2P(baseUrl)
    distributedRateLimiter = decentralized.createRateLimiter(p2pCoordinator)
    p2pCoordinator
      .start()
      .then(() => {
        console.log(`[DWS] P2P coordination started`)
      })
      .catch(console.error)
  }

  // WebSocket handling via Bun.serve
  interface BunServerWebSocket {
    readonly readyState: number
    send(data: string): number
    close(): void
  }

  interface WebSocketHandlers {
    message?: (data: string) => void
    close?: () => void
    error?: () => void
  }

  function toSubscribableWebSocket(
    ws: BunServerWebSocket,
  ): SubscribableWebSocket {
    return {
      get readyState() {
        return ws.readyState
      },
      send(data: string) {
        ws.send(data)
      },
    }
  }

  function toEdgeWebSocket(ws: BunServerWebSocket) {
    return {
      get readyState() {
        return ws.readyState
      },
      send(data: string) {
        ws.send(data)
      },
      close() {
        ws.close()
      },
    }
  }

  server = Bun.serve({
    port: PORT,
    fetch(req, bunServer) {
      const url = new URL(req.url)
      if (
        url.pathname === '/prices/ws' &&
        req.headers.get('upgrade') === 'websocket'
      ) {
        const success = bunServer.upgrade(req, {
          data: { type: 'prices', handlers: {} as WebSocketHandlers },
        })
        if (success) return undefined
        return new Response('WebSocket upgrade failed', { status: 500 })
      }
      if (
        url.pathname.startsWith('/edge/ws') &&
        req.headers.get('upgrade') === 'websocket'
      ) {
        const success = bunServer.upgrade(req, {
          data: { type: 'edge', handlers: {} as WebSocketHandlers },
        })
        if (success) return undefined
        return new Response('WebSocket upgrade failed', { status: 500 })
      }
      return app.fetch(req)
    },
    websocket: {
      open(ws) {
        const data = ws.data as { type: string; handlers: WebSocketHandlers }
        if (data.type === 'prices') {
          const service = getPriceService()
          const subscribable = toSubscribableWebSocket(ws)
          data.handlers.message = (msgStr: string) => {
            const msg = JSON.parse(msgStr)
            if (msg.type === 'subscribe') {
              service.subscribe(subscribable, msg)
              ws.send(JSON.stringify({ type: 'subscribed', success: true }))
            } else if (msg.type === 'unsubscribe') {
              service.unsubscribe(subscribable, msg)
              ws.send(JSON.stringify({ type: 'unsubscribed', success: true }))
            }
          }
          data.handlers.close = () => service.removeSubscriber(subscribable)
        } else if (data.type === 'edge') {
          const callbacks = handleEdgeWebSocket(toEdgeWebSocket(ws))
          data.handlers.message = callbacks.onMessage
          data.handlers.close = callbacks.onClose
          data.handlers.error = callbacks.onError
        }
      },
      message(ws, message) {
        const data = ws.data as { handlers: WebSocketHandlers }
        const msgStr =
          typeof message === 'string'
            ? message
            : new TextDecoder().decode(message)
        data.handlers.message?.(msgStr)
      },
      close(ws) {
        const data = ws.data as { handlers: WebSocketHandlers }
        data.handlers.close?.()
      },
    },
  })

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

export { backendManager, repoManager, registryManager, workflowEngine }
