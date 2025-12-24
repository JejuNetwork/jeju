/**
 * DWS Server
 * Decentralized Web Services - Storage, Compute, CDN, and Git
 *
 * Architecture:
 * - Frontend served from IPFS/CDN
 * - Node discovery via on-chain registry
 * - P2P coordination between nodes
 * - Distributed rate limiting
 */

import { cors } from '@elysiajs/cors'
import { getCQLBlockProducerUrl } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { createAgentRouter, initExecutor, initRegistry } from '../agents'
import { initializeMarketplace } from '../api-marketplace'
import { WorkflowEngine } from '../ci/workflow-engine'
import { initializeContainerSystem } from '../containers'
import {
  createDatabaseRouter,
  createKeepaliveRouter,
  createSecureCQLRouter,
  type RegisteredDatabase,
  type ResourceStatus,
  startKeepaliveService,
  stopKeepaliveService,
} from '../database'
import {
  createDecentralizedServices,
  type DistributedRateLimiter,
  type P2PCoordinator,
} from '../decentralized'
import { createEmailRouter } from '../email/routes'
import { GitRepoManager } from '../git/repo-manager'
import {
  createHelmProviderRouter,
  createIngressRouter,
  createK3sRouter,
  createServiceMeshRouter,
  createTerraformProviderRouter,
  getIngressController,
  getServiceMesh,
} from '../infrastructure'
import { banCheckMiddleware } from '../middleware/ban-check'
import { PkgRegistryManager } from '../pkg/registry-manager'
import { createBackendManager } from '../storage/backends'
import type { ServiceHealth } from '../types'
import { WorkerdExecutor } from '../workers/workerd/executor'
import { createA2ARouter } from './routes/a2a'
import { createAPIMarketplaceRouter } from './routes/api-marketplace'
import { createCDNRouter } from './routes/cdn'
import { createCIRouter } from './routes/ci'
import { createComputeRouter } from './routes/compute'
import { createContainerRouter } from './routes/containers'
import { createDARouter, shutdownDA } from './routes/da'
import { createEdgeRouter, handleEdgeWebSocket } from './routes/edge'
import { createFundingRouter } from './routes/funding'
import { createGitRouter } from './routes/git'
import { createKMSRouter } from './routes/kms'
import { createMCPRouter } from './routes/mcp'
import { createModerationRouter } from './routes/moderation'
import { createOAuth3Router } from './routes/oauth3'
import { createPkgRouter } from './routes/pkg'
import { createPkgRegistryProxyRouter } from './routes/pkg-registry-proxy'
import {
  createPricesRouter,
  getPriceService,
  type SubscribableWebSocket,
} from './routes/prices'
import { createRPCRouter } from './routes/rpc'
import { createS3Router } from './routes/s3'
import { createScrapingRouter } from './routes/scraping'
import { createStorageRouter } from './routes/storage'
import { createVPNRouter } from './routes/vpn'
import { createDefaultWorkerdRouter } from './routes/workerd'
import { createWorkersRouter } from './routes/workers'

// Server port - defined early for use in config
const PORT = parseInt(process.env.DWS_PORT || process.env.PORT || '4030', 10)

// Rate limiter store
// NOTE: This is an in-memory rate limiter suitable for single-instance deployments.
// For multi-instance deployments, use Redis or a shared store.
interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX = process.env.NODE_ENV === 'test' ? 100000 : 1000
const SKIP_RATE_LIMIT_PATHS = ['/health', '/.well-known/']

function rateLimiter() {
  return new Elysia({ name: 'rate-limiter' }).onBeforeHandle(
    ({
      request,
      set,
    }): { error: string; message: string; retryAfter: number } | undefined => {
      const url = new URL(request.url)
      const path = url.pathname
      if (SKIP_RATE_LIMIT_PATHS.some((p) => path.startsWith(p))) {
        return undefined
      }

      // Get client IP from proxy headers
      // Note: In production, ensure reverse proxy sets x-forwarded-for or x-real-ip
      // x-forwarded-for can be comma-separated; take the first (original client)
      const forwardedFor = request.headers.get('x-forwarded-for')
      const clientIp =
        forwardedFor?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        request.headers.get('cf-connecting-ip') || // Cloudflare
        'local' // Fallback for local dev without proxy
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
    },
  )
}

// Cleanup stale rate limit entries periodically
const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key)
    }
  }
}, RATE_LIMIT_WINDOW_MS)

const app = new Elysia()
  // Global error handler - converts validation errors to proper HTTP status codes
  .onError(({ error, set }) => {
    const message = 'message' in error ? String(error.message) : 'Unknown error'
    const lowerMessage = message.toLowerCase()

    // Check for auth-related errors (401) - check header validation failures
    const isAuthError =
      lowerMessage.includes('x-jeju-address') ||
      lowerMessage.includes('authentication') ||
      lowerMessage.includes('x-jeju-signature') ||
      lowerMessage.includes('x-jeju-nonce')

    // Check for not found errors (404)
    const isNotFound = lowerMessage.includes('not found')

    // Check for permission errors (403)
    const isForbidden =
      lowerMessage.includes('access denied') ||
      lowerMessage.includes('permission') ||
      lowerMessage.includes('not authorized')

    // Check for validation/bad request errors (400)
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
  .use(cors({ origin: '*' }))
  .use(rateLimiter())
  .use(banCheckMiddleware())

const backendManager = createBackendManager()

// Environment validation - require addresses in production
const isProduction = process.env.NODE_ENV === 'production'
const LOCALNET_DEFAULTS = {
  rpcUrl: 'http://localhost:9545',
  repoRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  packageRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  triggerRegistry: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  identityRegistry: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9', // ERC-8004 IdentityRegistry (shared with agents)
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

// Package registry configuration (JejuPkg)
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
// Uses ERC-8004 IdentityRegistry for node discovery (same registry as agents)
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

// Continue building app with routes
app
  .get('/health', async () => {
    const backends = backendManager.listBackends()
    const backendHealth = await backendManager.healthCheck()
    const nodeCount = await decentralized.discovery.getNodeCount()
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
      'k8s',
      'helm',
      'terraform',
      'mesh',
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
      k3s: '/k3s/*',
      helm: '/helm/*',
      terraform: '/terraform/*',
      ingress: '/ingress/*',
      mesh: '/mesh/*',
    },
  }))

// Route mounting - these routers need to be Elysia instances
app.use(createStorageRouter())
app.use(createComputeRouter())
app.use(createCDNRouter())
app.use(createGitRouter({ repoManager, backend: backendManager }))
app.use(createPkgRouter({ registryManager, backend: backendManager }))
app.use(
  createCIRouter({ workflowEngine, repoManager, backend: backendManager }),
)
app.use(createOAuth3Router())
app.use(createAPIMarketplaceRouter())
app.use(createContainerRouter())
app.use(createA2ARouter())
app.use(createMCPRouter())

// New DWS services
app.use(createS3Router(backendManager))
app.use(createWorkersRouter(backendManager))
app.use(createDefaultWorkerdRouter(backendManager)) // V8 isolate runtime
app.use(createKMSRouter())
app.use(createVPNRouter())
app.use(createScrapingRouter())
app.use(createRPCRouter())
app.use(createEdgeRouter())
app.use(createPricesRouter())
app.use(createModerationRouter())
app.use(createEmailRouter())

// Funding and package registry proxy
app.use(createFundingRouter())
app.use(createPkgRegistryProxyRouter())

// Secure database provisioning and access
app.use(createDatabaseRouter())
app.use(createSecureCQLRouter())
app.use(createKeepaliveRouter())

// Data Availability Layer
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

// Continue mounting routes on app
app.use(createDARouter(daConfig))
// Agent system - uses workerd for execution
app.use(createAgentRouter())
// Infrastructure routes - K8s, Helm, Terraform, Service Mesh
app.use(createK3sRouter())
app.use(createHelmProviderRouter())
app.use(createTerraformProviderRouter())
app.use(createIngressRouter(getIngressController()))
app.use(createServiceMeshRouter(getServiceMesh()))

// Serve frontend - from IPFS when configured, fallback to local
app.get('/app', async ({ set }) => {
  const decentralizedResponse =
    await decentralized.frontend.serveAsset('index.html')
  if (decentralizedResponse) return decentralizedResponse

  const file = Bun.file('./frontend/index.html')
  if (await file.exists()) {
    const html = await file.text()
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
        'X-DWS-Source': 'local',
      },
    })
  }

  set.status = 404
  return {
    error:
      'Frontend not available. Set DWS_FRONTEND_CID or run in development mode.',
  }
})

app.get('/app/ci', async ({ set }) => {
  const decentralizedResponse =
    await decentralized.frontend.serveAsset('ci.html')
  if (decentralizedResponse) return decentralizedResponse

  const file = Bun.file('./frontend/ci.html')
  if (await file.exists()) {
    const html = await file.text()
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
        'X-DWS-Source': 'local',
      },
    })
  }

  set.status = 404
  return { error: 'CI frontend not available' }
})

app.get('/app/da', async ({ set }) => {
  const decentralizedResponse =
    await decentralized.frontend.serveAsset('da.html')
  if (decentralizedResponse) return decentralizedResponse

  const file = Bun.file('./frontend/da.html')
  if (await file.exists()) {
    const html = await file.text()
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
        'X-DWS-Source': 'local',
      },
    })
  }

  set.status = 404
  return { error: 'DA dashboard not available' }
})

app.get('/app/*', async ({ request, set }) => {
  const url = new URL(request.url)
  const path = url.pathname.replace('/app', '')

  const decentralizedResponse = await decentralized.frontend.serveAsset(path)
  if (decentralizedResponse) return decentralizedResponse

  const file = Bun.file('./frontend/index.html')
  if (await file.exists()) {
    const html = await file.text()
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html',
        'X-DWS-Source': 'local',
      },
    })
  }

  set.status = 404
  return { error: 'Frontend not available' }
})

// Internal P2P endpoints
app.get('/_internal/ratelimit/:clientKey', ({ params }) => {
  const count = distributedRateLimiter?.getLocalCount(params.clientKey) ?? 0
  return { count }
})

app.get('/_internal/peers', () => {
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
app.get('/.well-known/agent-card.json', () => {
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

// Initialize services
initializeMarketplace()
initializeContainerSystem()

// Initialize agent system
const CQL_URL = getCQLBlockProducerUrl()
const AGENTS_DB_ID = process.env.AGENTS_DATABASE_ID ?? 'dws-agents'
initRegistry({ cqlUrl: CQL_URL, databaseId: AGENTS_DB_ID }).catch((err) => {
  console.warn(
    '[DWS] Agent registry init failed (CQL may not be running):',
    err.message,
  )
})

// Initialize agent executor with workerd
const workerdExecutor = new WorkerdExecutor(backendManager)
workerdExecutor
  .initialize()
  .then(() => {
    initExecutor(workerdExecutor, {
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

let server: ReturnType<typeof Bun.serve> | null = null

function shutdown(signal: string) {
  console.log(`[DWS] Received ${signal}, shutting down gracefully...`)
  clearInterval(rateLimitCleanupInterval)
  shutdownDA()
  console.log('[DWS] DA layer stopped')
  stopKeepaliveService()
  console.log('[DWS] Keepalive service stopped')
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

  // Adapter types for Bun's ServerWebSocket
  interface BunServerWebSocket {
    readonly readyState: number
    send(data: string): number
    close(): void
  }

  // Adapter to convert Bun's ServerWebSocket to SubscribableWebSocket
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

  // Adapter to convert Bun's ServerWebSocket to EdgeWebSocket (includes close)
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

  // Handler types for WebSocket message routing
  interface WebSocketHandlers {
    message?: (data: string) => void
    close?: () => void
    error?: () => void
  }

  server = Bun.serve({
    port: PORT,
    fetch(req, server) {
      // Handle WebSocket upgrades for price streaming
      const url = new URL(req.url)
      if (
        url.pathname === '/prices/ws' &&
        req.headers.get('upgrade') === 'websocket'
      ) {
        const success = server.upgrade(req, {
          data: { type: 'prices', handlers: {} as WebSocketHandlers },
        })
        if (success) return undefined
        return new Response('WebSocket upgrade failed', { status: 500 })
      }
      // Handle edge WebSocket
      if (
        url.pathname.startsWith('/edge/ws') &&
        req.headers.get('upgrade') === 'websocket'
      ) {
        const success = server.upgrade(req, {
          data: { type: 'edge', handlers: {} as WebSocketHandlers },
        })
        if (success) return undefined
        return new Response('WebSocket upgrade failed', { status: 500 })
      }
      return app.handle(req)
    },
    websocket: {
      open(ws) {
        const data = ws.data as { type: string; handlers: WebSocketHandlers }
        if (data.type === 'prices') {
          // Set up price subscription service
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
          // Set up edge coordination - callbacks returned from handleEdgeWebSocket
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

  // Start database keepalive service
  startKeepaliveService({
    checkInterval: 30000,
    failureThreshold: 3,
    maxRecoveryAttempts: 5,
    recoveryCooldown: 60000,
    onStatusChange: (db: RegisteredDatabase, oldStatus: ResourceStatus) => {
      console.log(
        `[DWS Keepalive] ${db.appName} status: ${oldStatus} -> ${db.status}`,
      )
    },
  })
    .then(() => {
      console.log('[DWS] Database keepalive service started')
    })
    .catch(console.error)

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

export { app, backendManager, repoManager, registryManager, workflowEngine }
