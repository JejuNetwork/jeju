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

import type { Context, Next } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
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
// Error handler is now using Hono's app.onError
import { createStorageRouter } from './routes/storage'
import { createVPNRouter } from './routes/vpn'
import { createDefaultWorkerdRouter } from './routes/workerd'
import { createWorkersRouter } from './routes/workers'
import {
  createHelmProviderRouter,
  createIngressRouter,
  createK3sRouter,
  createServiceMeshRouter,
  createTerraformProviderRouter,
} from '../infrastructure'

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
  return async (c: Context, next: Next) => {
    const path = c.req.path
    if (SKIP_RATE_LIMIT_PATHS.some((p) => path.startsWith(p))) {
      return next()
    }

    // Get client IP from proxy headers
    // Note: In production, ensure reverse proxy sets x-forwarded-for or x-real-ip
    // x-forwarded-for can be comma-separated; take the first (original client)
    const forwardedFor = c.req.header('x-forwarded-for')
    const clientIp =
      forwardedFor?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      c.req.header('cf-connecting-ip') || // Cloudflare
      'local' // Fallback for local dev without proxy
    const now = Date.now()

    let entry = rateLimitStore.get(clientIp)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
      rateLimitStore.set(clientIp, entry)
    }

    entry.count++

    c.header('X-RateLimit-Limit', String(RATE_LIMIT_MAX))
    c.header(
      'X-RateLimit-Remaining',
      String(Math.max(0, RATE_LIMIT_MAX - entry.count)),
    )
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > RATE_LIMIT_MAX) {
      return c.json(
        {
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          retryAfter: Math.ceil((entry.resetAt - now) / 1000),
        },
        429,
      )
    }

    return next()
  }
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

const app = new Hono()

// Global error handler - converts validation errors to proper HTTP status codes
app.onError((error, c) => {
  const message = error.message
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

  const statusCode = isAuthError
    ? 401
    : isNotFound
      ? 404
      : isForbidden
        ? 403
        : isBadRequest
          ? 400
          : 500

  return c.json({ error: message }, statusCode)
})

app.use('/*', cors({ origin: '*' }))
app.use('/*', rateLimiter())
app.use('/*', banCheckMiddleware()) // Ban check - blocks banned users

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

app.get('/health', async (c) => {
  const backends = backendManager.listBackends()
  const backendHealth = await backendManager.healthCheck()
  const nodeCount = await decentralized.discovery.getNodeCount().catch(() => 0)
  const peerCount = p2pCoordinator?.getPeers().length ?? 0
  const frontendCid = await decentralized.frontend.getFrontendCid()

  const health: ServiceHealth = {
    status: 'healthy',
    service: 'dws',
    version: '1.0.0',
    uptime: process.uptime() * 1000,
  }

  return c.json({
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
  })
})

app.get('/', (c) => {
  return c.json({
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
  })
})

app.route('/storage', createStorageRouter())
app.route('/compute', createComputeRouter())
app.route('/cdn', createCDNRouter())
app.route('/git', createGitRouter({ repoManager, backend: backendManager }))
app.route('/pkg', createPkgRouter({ registryManager, backend: backendManager }))
app.route(
  '/ci',
  createCIRouter({ workflowEngine, repoManager, backend: backendManager }),
)
app.route('/oauth3', createOAuth3Router())
app.route('/api', createAPIMarketplaceRouter())
app.route('/containers', createContainerRouter())
app.route('/a2a', createA2ARouter())
app.route('/mcp', createMCPRouter())

// New DWS services
app.route('/s3', createS3Router(backendManager))
app.route('/workers', createWorkersRouter(backendManager))
app.route('/workerd', createDefaultWorkerdRouter(backendManager)) // V8 isolate runtime
app.route('/kms', createKMSRouter())
app.route('/vpn', createVPNRouter())
app.route('/scraping', createScrapingRouter())
app.route('/rpc', createRPCRouter())
app.route('/edge', createEdgeRouter())
app.route('/prices', createPricesRouter())
app.route('/moderation', createModerationRouter())
app.route('/email', createEmailRouter())

// Funding and package registry proxy
app.route('/funding', createFundingRouter())
app.route('/registry', createPkgRegistryProxyRouter())

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
app.route('/da', createDARouter(daConfig))

// Agent system - uses workerd for execution
app.route('/agents', createAgentRouter())

// Infrastructure routes - K8s, Helm, Terraform, Service Mesh
app.route('/k3s', createK3sRouter())
app.route('/helm', createHelmProviderRouter())
app.route('/terraform', createTerraformProviderRouter())
app.route('/ingress', createIngressRouter())
app.route('/mesh', createServiceMeshRouter())

// Initialize services
initializeMarketplace()
initializeContainerSystem()

// Initialize agent system
const CQL_URL =
  process.env.CQL_BLOCK_PRODUCER_ENDPOINT ?? 'http://127.0.0.1:4028'
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

// Serve frontend - from IPFS when configured, fallback to local
app.get('/app', async (c) => {
  // Try decentralized frontend first
  const decentralizedResponse =
    await decentralized.frontend.serveAsset('index.html')
  if (decentralizedResponse) return decentralizedResponse

  // Fallback to local file (dev mode)
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

  return c.json(
    {
      error:
        'Frontend not available. Set DWS_FRONTEND_CID or run in development mode.',
    },
    404,
  )
})

app.get('/app/ci', async (c) => {
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

  return c.json({ error: 'CI frontend not available' }, 404)
})

app.get('/app/da', async (c) => {
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

  return c.json({ error: 'DA dashboard not available' }, 404)
})

app.get('/app/*', async (c) => {
  const path = c.req.path.replace('/app', '')

  // Try decentralized frontend
  const decentralizedResponse = await decentralized.frontend.serveAsset(path)
  if (decentralizedResponse) return decentralizedResponse

  // For SPA routing - serve index.html for all /app/* routes
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

  return c.json({ error: 'Frontend not available' }, 404)
})

// Internal P2P endpoints
app.get('/_internal/ratelimit/:clientKey', (c) => {
  const clientKey = c.req.param('clientKey')
  const count = distributedRateLimiter?.getLocalCount(clientKey) ?? 0
  return c.json({ count })
})

app.get('/_internal/peers', (c) => {
  const peers = p2pCoordinator?.getPeers() ?? []
  return c.json({
    peers: peers.map((p) => ({
      agentId: p.agentId.toString(),
      endpoint: p.endpoint,
      owner: p.owner,
      stake: p.stake.toString(),
      isBanned: p.isBanned,
    })),
  })
})

// Agent card for discovery
app.get('/.well-known/agent-card.json', (c) => {
  const baseUrl = process.env.DWS_BASE_URL || `http://localhost:${PORT}`
  return c.json({
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
  })
})

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
      return app.fetch(req, server)
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

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

export { app, backendManager, repoManager, registryManager, workflowEngine }
