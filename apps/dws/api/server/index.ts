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
import {
  CORE_PORTS,
  type ContractCategoryName,
  getContract,
  getEQLiteBlockProducerUrl,
  getCurrentNetwork,
  getRpcUrl,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import {
  getLocalCDNServer,
  initializeLocalCDN,
} from '../../src/cdn/local-server'
import { initializeEmailRelayService } from '../../src/email/relay'
import { createEmailRouter } from '../../src/email/routes'
import { createAgentRouter, initExecutor, initRegistry } from '../agents'
import { initializeMarketplace } from '../api-marketplace'
import {
  createCacheRoutes,
  getSharedEngine,
  initializeCacheProvisioning,
} from '../cache'
import { WorkflowEngine } from '../ci/workflow-engine'
import { initializeContainerSystem } from '../containers'
import {
  createDatabaseRouter,
  createKeepaliveRouter,
  createSecureEQLiteRouter,
  ensureEQLiteService,
  getEQLiteStatus,
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
import { createAppDeployerRouter } from '../deploy'
import { createDNSRouter } from '../dns/routes'
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
import { createHuggingFaceRouter } from '../ml/huggingface-compat'
import { PkgRegistryManager } from '../pkg/registry-manager'
import { createServicesRouter, discoverExistingServices } from '../services'
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
import { createFaucetRouter } from './routes/faucet'
import { createFundingRouter } from './routes/funding'
import { createGitRouter } from './routes/git'
import { createIndexerRouter, shutdownIndexerProxy } from './routes/indexer'
import { createKMSRouter } from './routes/kms'
import {
  createLoadBalancerRouter,
  shutdownLoadBalancer,
} from './routes/load-balancer'
import { createMCPRouter } from './routes/mcp'
import { createModerationRouter } from './routes/moderation'
import { createOAuth3Router } from './routes/oauth3'
import { createPkgRouter } from './routes/pkg'
import { createPkgRegistryProxyRouter } from './routes/pkg-registry-proxy'
import {
  createPricesRouter,
  getPriceService,
  type SubscribableWebSocket,
  SubscriptionMessageSchema,
} from './routes/prices'
import { createRPCRouter } from './routes/rpc'
import { createS3Router } from './routes/s3'
import { createScrapingRouter } from './routes/scraping'
import { createStakingRouter } from './routes/staking'
import { createStorageRouter } from './routes/storage'
import { createVPNRouter } from './routes/vpn'
import { createDefaultWorkerdRouter } from './routes/workerd'
import { createWorkersRouter } from './routes/workers'

// Config injection for workerd compatibility
export interface DWSServerConfig {
  privateKey?: Hex
  frontendCid?: string
  emailDomain?: string
  contentScreeningEnabled?: boolean
  oauth3AgentUrl?: string
  daOperatorPrivateKey?: Hex
  daOperatorEndpoint?: string
  daOperatorRegion?: string
  daOperatorCapacityGB?: number
  daContractAddress?: Address
  baseUrl?: string
  agentsDatabaseId?: string
  inferenceUrl?: string
  kmsUrl?: string
  devnet?: boolean
  appsDir?: string
  p2pEnabled?: boolean
  nodeEnv?: string
}

let serverConfig: DWSServerConfig = {}

export function configureDWSServer(config: Partial<DWSServerConfig>): void {
  serverConfig = { ...serverConfig, ...config }
}

// Server port - from centralized config (env override via CORE_PORTS)
const PORT = CORE_PORTS.DWS_API.get()

// Rate limiter store
// NOTE: This is an in-memory rate limiter suitable for single-instance deployments.
// For multi-instance deployments, use Redis or a shared store.
interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const RATE_LIMIT_MAX =
  (serverConfig.nodeEnv ??
    (typeof process !== 'undefined' ? process.env.NODE_ENV : undefined)) ===
  'test'
    ? 100000
    : 1000
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
const nodeEnv =
  serverConfig.nodeEnv ??
  (typeof process !== 'undefined' ? process.env.NODE_ENV : undefined)
const isProduction = nodeEnv === 'production'
const NETWORK = getCurrentNetwork()
const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as Address

// Get contract address with fallback to zero address
function getContractOrZero(
  category: ContractCategoryName,
  name: string,
): Address {
  try {
    const addr = getContract(category, name, NETWORK)
    return (addr || ZERO_ADDR) as Address
  } catch {
    // Contract not configured - return zero address
    return ZERO_ADDR
  }
}

// Git configuration - uses centralized config
const gitConfig = {
  rpcUrl: getRpcUrl(NETWORK),
  repoRegistryAddress: getContractOrZero('registry', 'repo'),
  privateKey:
    (serverConfig.privateKey as Hex | undefined) ??
    (typeof process !== 'undefined'
      ? (process.env.DWS_PRIVATE_KEY as Hex | undefined)
      : undefined),
}

const repoManager = new GitRepoManager(gitConfig, backendManager)

// Package registry configuration (JejuPkg)
const pkgConfig = {
  rpcUrl: getRpcUrl(NETWORK),
  packageRegistryAddress: getContractOrZero('registry', 'package'),
  privateKey:
    (serverConfig.privateKey as Hex | undefined) ??
    (typeof process !== 'undefined'
      ? (process.env.DWS_PRIVATE_KEY as Hex | undefined)
      : undefined),
}

const registryManager = new PkgRegistryManager(pkgConfig, backendManager)

// CI configuration
const ciConfig = {
  rpcUrl: getRpcUrl(NETWORK),
  triggerRegistryAddress: getContractOrZero('registry', 'trigger'),
  privateKey:
    (serverConfig.privateKey as Hex | undefined) ??
    (typeof process !== 'undefined'
      ? (process.env.DWS_PRIVATE_KEY as Hex | undefined)
      : undefined),
}

const workflowEngine = new WorkflowEngine(ciConfig, backendManager, repoManager)

// Decentralized services configuration
// Uses ERC-8004 IdentityRegistry for node discovery (same registry as agents)
const decentralizedConfig = {
  rpcUrl: getRpcUrl(NETWORK),
  identityRegistryAddress: getContractOrZero('registry', 'identity'),
  frontendCid:
    serverConfig.frontendCid ??
    (typeof process !== 'undefined' ? process.env.DWS_FRONTEND_CID : undefined),
}

const decentralized = createDecentralizedServices(
  decentralizedConfig,
  backendManager,
)
let p2pCoordinator: P2PCoordinator | null = null
let distributedRateLimiter: DistributedRateLimiter | null = null

// Email relay service configuration
const emailRelayConfig = {
  rpcUrl: getRpcUrl(NETWORK),
  chainId:
    NETWORK === 'mainnet' ? 420691 : NETWORK === 'testnet' ? 420690 : 31337,
  emailRegistryAddress: getContractOrZero('registry', 'email'),
  emailStakingAddress: getContractOrZero('staking', 'email'),
  jnsAddress: getContractOrZero('registry', 'jns'),
  dwsEndpoint: `http://localhost:${PORT}`,
  emailDomain:
    serverConfig.emailDomain ??
    (typeof process !== 'undefined' ? process.env.EMAIL_DOMAIN : undefined) ??
    'jeju.mail',
  rateLimits: {
    free: {
      emailsPerDay: 50,
      emailsPerHour: 10,
      maxRecipients: 5,
      maxAttachmentSizeMb: 5,
      maxEmailSizeMb: 10,
    },
    staked: {
      emailsPerDay: 500,
      emailsPerHour: 100,
      maxRecipients: 50,
      maxAttachmentSizeMb: 25,
      maxEmailSizeMb: 50,
    },
    premium: {
      emailsPerDay: 5000,
      emailsPerHour: 1000,
      maxRecipients: 500,
      maxAttachmentSizeMb: 100,
      maxEmailSizeMb: 100,
    },
  },
  contentScreeningEnabled:
    serverConfig.contentScreeningEnabled ??
    (typeof process !== 'undefined'
      ? process.env.CONTENT_SCREENING_ENABLED !== 'false'
      : true),
}
initializeEmailRelayService(emailRelayConfig)

// Continue building app with routes
app
  .get('/health', async () => {
    const backends = backendManager.listBackends()
    const backendHealth = await backendManager.healthCheck()
    // These may fail if contracts aren't deployed (dev mode)
    let nodeCount = 0
    let frontendCid: string | null = null
    if (
      decentralizedConfig.identityRegistryAddress !==
      '0x0000000000000000000000000000000000000000'
    ) {
      nodeCount = await decentralized.discovery.getNodeCount().catch(() => 0)
      frontendCid = await decentralized.frontend
        .getFrontendCid()
        .catch(() => null)
    }
    const peerCount = p2pCoordinator?.getPeers().length ?? 0

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
        cdn: {
          status: 'healthy',
          description: 'Decentralized CDN with edge caching',
        },
        git: { status: 'healthy' },
        pkg: { status: 'healthy' },
        ci: { status: 'healthy' },
        oauth3: {
          status:
            (serverConfig.oauth3AgentUrl ??
            (typeof process !== 'undefined'
              ? process.env.OAUTH3_AGENT_URL
              : undefined))
              ? 'available'
              : 'not-configured',
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
        cache: {
          status: 'healthy',
          description: 'Decentralized serverless cache',
        },
        email: {
          status: 'healthy',
          description: 'Decentralized email with SMTP/IMAP',
        },
        lb: { status: 'healthy', description: 'Scale-to-zero load balancer' },
        indexer: {
          status: 'healthy',
          description: 'Decentralized indexer proxy',
        },
        faucet: {
          status: NETWORK !== 'mainnet' ? 'healthy' : 'disabled',
          description: 'Testnet-only JEJU token faucet',
        },
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
      'cache',
      'email',
      'lb',
      'faucet',
      'deploy',
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
      cache: '/cache/*',
      email: '/email/*',
      lb: '/lb/*',
      indexer: '/indexer/*',
      faucet: '/faucet/*',
      deploy: '/deploy/*',
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
app.use(createFaucetRouter()) // Testnet-only faucet
app.use(createStakingRouter()) // Node staking and earnings
app.use(createPricesRouter())
app.use(createModerationRouter())
app.use(createEmailRouter())

// Funding and package registry proxy
app.use(createFundingRouter())
app.use(createPkgRegistryProxyRouter())

// DNS services (DoH, JNS, ENS bridge)
app.use(createDNSRouter())

// ML model storage (HuggingFace Hub compatible)
app.use(createHuggingFaceRouter())

// Load balancer
app.use(createLoadBalancerRouter())

// Secure database provisioning and access
app.use(createDatabaseRouter())
app.use(createSecureEQLiteRouter())
app.use(createKeepaliveRouter())

// Infrastructure services (postgres, redis, etc.)
app.use(createServicesRouter())

// App deployment - Heroku/EKS-like experience
app.use(createAppDeployerRouter())

// Indexer proxy for decentralized indexer access
app.use(createIndexerRouter())

// Data Availability Layer
const daConfig = {
  operatorPrivateKey:
    (serverConfig.daOperatorPrivateKey as Hex | undefined) ??
    (typeof process !== 'undefined'
      ? (process.env.DA_OPERATOR_PRIVATE_KEY as Hex | undefined)
      : undefined),
  operatorEndpoint:
    serverConfig.daOperatorEndpoint ??
    serverConfig.baseUrl ??
    (typeof process !== 'undefined' ? process.env.DWS_BASE_URL : undefined) ??
    `http://localhost:${PORT}`,
  operatorRegion:
    serverConfig.daOperatorRegion ??
    (typeof process !== 'undefined'
      ? process.env.DA_OPERATOR_REGION
      : undefined) ??
    'default',
  operatorCapacityGB:
    serverConfig.daOperatorCapacityGB ??
    (typeof process !== 'undefined'
      ? parseInt(process.env.DA_OPERATOR_CAPACITY_GB || '100', 10)
      : 100),
  // DA contract address - not yet in centralized config
  daContractAddress:
    (serverConfig.daContractAddress as Address | undefined) ??
    (typeof process !== 'undefined'
      ? ((process.env.DA_CONTRACT_ADDRESS || ZERO_ADDR) as Address)
      : ZERO_ADDR),
  rpcUrl: getRpcUrl(NETWORK),
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
  const baseUrl =
    serverConfig.baseUrl ??
    (typeof process !== 'undefined' ? process.env.DWS_BASE_URL : undefined) ??
    `http://localhost:${PORT}`
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
      {
        name: 'cache',
        endpoint: `${baseUrl}/cache`,
        description: 'Decentralized serverless cache with TEE support',
      },
    ],
    a2aEndpoint: `${baseUrl}/a2a`,
    mcpEndpoint: `${baseUrl}/mcp`,
  }
})

// DWS Cache Service routes (decentralized cache with TEE support)
app.use(createCacheRoutes())

// Root-level /stats endpoint for vendor app compatibility
// Returns cache stats in standard format
app.get('/stats', () => {
  const engine = getSharedEngine()
  const cacheStats = engine.getStats()
  return {
    stats: {
      totalKeys: cacheStats.totalKeys,
      usedMemoryMb: cacheStats.usedMemoryBytes / (1024 * 1024),
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: cacheStats.hitRate,
    },
  }
})

// Initialize services
initializeMarketplace()
initializeContainerSystem()

// Initialize DWS cache provisioning
initializeCacheProvisioning().catch((err) => {
  console.warn('[DWS] Cache provisioning init failed:', err.message)
})

// Initialize agent system
const EQLITE_URL = getEQLiteBlockProducerUrl()
const AGENTS_DB_ID =
  serverConfig.agentsDatabaseId ??
  (typeof process !== 'undefined'
    ? process.env.AGENTS_DATABASE_ID
    : undefined) ??
  'dws-agents'
initRegistry({ eqliteUrl: EQLITE_URL, databaseId: AGENTS_DB_ID }).catch((err) => {
  console.warn(
    '[DWS] Agent registry init failed (EQLite may not be running):',
    err.message,
  )
})

// Initialize agent executor with workerd
const workerdExecutor = new WorkerdExecutor(backendManager)
workerdExecutor
  .initialize()
  .then(() => {
    initExecutor(workerdExecutor, {
      // Local service URLs - deployment-specific configuration
      inferenceUrl:
        serverConfig.inferenceUrl ??
        (typeof process !== 'undefined'
          ? process.env.DWS_INFERENCE_URL
          : undefined) ??
        'http://127.0.0.1:4030/compute',
      kmsUrl:
        serverConfig.kmsUrl ??
        (typeof process !== 'undefined'
          ? process.env.DWS_KMS_URL
          : undefined) ??
        'http://127.0.0.1:4030/kms',
      eqliteUrl: EQLITE_URL,
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
  shutdownLoadBalancer()
  console.log('[DWS] Load balancer stopped')
  shutdownIndexerProxy()
  console.log('[DWS] Indexer proxy stopped')
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
  // Configure route modules with injected config
  const {
    configureCDNRouterConfig,
  } = await import('./routes/cdn')
  const {
    configureOAuth3RouterConfig,
  } = await import('./routes/oauth3')
  const {
    configureProxyRouterConfig,
  } = await import('./routes/proxy')
  const {
    configureDNSRouterConfig,
  } = await import('../dns/routes')
  const {
    configureX402PaymentsConfig,
  } = await import('../rpc/services/x402-payments')

  // Inject configs from serverConfig and process.env (for backward compatibility)
  configureCDNRouterConfig({
    jnsRegistryAddress:
      typeof process !== 'undefined' ? process.env.JNS_REGISTRY_ADDRESS : undefined,
    jnsResolverAddress:
      typeof process !== 'undefined' ? process.env.JNS_RESOLVER_ADDRESS : undefined,
    rpcUrl:
      typeof process !== 'undefined' ? process.env.RPC_URL : undefined,
    ipfsGatewayUrl:
      typeof process !== 'undefined' ? process.env.IPFS_GATEWAY_URL : undefined,
    arweaveGatewayUrl:
      typeof process !== 'undefined' ? process.env.ARWEAVE_GATEWAY_URL : undefined,
    jnsDomain:
      typeof process !== 'undefined' ? process.env.JNS_DOMAIN : undefined,
    cacheMb:
      typeof process !== 'undefined'
        ? parseInt(process.env.DWS_CDN_CACHE_MB || '512', 10)
        : undefined,
    maxEntries:
      typeof process !== 'undefined'
        ? parseInt(process.env.DWS_CDN_CACHE_ENTRIES || '100000', 10)
        : undefined,
    defaultTTL:
      typeof process !== 'undefined'
        ? parseInt(process.env.DWS_CDN_DEFAULT_TTL || '3600', 10)
        : undefined,
    isDevnet:
      typeof process !== 'undefined'
        ? process.env.DEVNET === 'true'
        : undefined,
    jejuAppsDir:
      typeof process !== 'undefined' ? process.env.JEJU_APPS_DIR : undefined,
    nodeEnv:
      typeof process !== 'undefined' ? process.env.NODE_ENV : undefined,
  })

  configureOAuth3RouterConfig({
    agentUrl:
      typeof process !== 'undefined' ? process.env.OAUTH3_AGENT_URL : undefined,
  })

  configureProxyRouterConfig({
    indexerUrl:
      typeof process !== 'undefined' ? process.env.INDEXER_URL : undefined,
    indexerGraphqlUrl:
      typeof process !== 'undefined' ? process.env.INDEXER_GRAPHQL_URL : undefined,
    monitoringUrl:
      typeof process !== 'undefined' ? process.env.MONITORING_URL : undefined,
    prometheusUrl:
      typeof process !== 'undefined' ? process.env.PROMETHEUS_URL : undefined,
    gatewayUrl:
      typeof process !== 'undefined' ? process.env.GATEWAY_URL : undefined,
  })

  configureDNSRouterConfig({
    ethRpcUrl:
      typeof process !== 'undefined' ? process.env.ETH_RPC_URL : undefined,
    cfApiToken:
      typeof process !== 'undefined' ? process.env.CF_API_TOKEN : undefined,
    cfZoneId:
      typeof process !== 'undefined' ? process.env.CF_ZONE_ID : undefined,
    cfDomain:
      typeof process !== 'undefined' ? process.env.CF_DOMAIN : undefined,
    awsAccessKeyId:
      typeof process !== 'undefined' ? process.env.AWS_ACCESS_KEY_ID : undefined,
    awsSecretAccessKey:
      typeof process !== 'undefined' ? process.env.AWS_SECRET_ACCESS_KEY : undefined,
    awsHostedZoneId:
      typeof process !== 'undefined' ? process.env.AWS_HOSTED_ZONE_ID : undefined,
    awsDomain:
      typeof process !== 'undefined' ? process.env.AWS_DOMAIN : undefined,
    dnsMirrorDomain:
      typeof process !== 'undefined' ? process.env.DNS_MIRROR_DOMAIN : undefined,
    dnsSyncInterval:
      typeof process !== 'undefined'
        ? parseInt(process.env.DNS_SYNC_INTERVAL || '300', 10)
        : undefined,
    gatewayEndpoint:
      typeof process !== 'undefined' ? process.env.GATEWAY_ENDPOINT : undefined,
    ipfsGateway:
      typeof process !== 'undefined' ? process.env.IPFS_GATEWAY : undefined,
  })

  configureX402PaymentsConfig({
    paymentRecipient:
      typeof process !== 'undefined'
        ? (process.env.RPC_PAYMENT_RECIPIENT as Address | undefined)
        : undefined,
    x402Enabled:
      typeof process !== 'undefined'
        ? process.env.X402_ENABLED !== 'false'
        : undefined,
  })
  const baseUrl =
    serverConfig.baseUrl ??
    (typeof process !== 'undefined' ? process.env.DWS_BASE_URL : undefined) ??
    `http://localhost:${PORT}`

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

  // Initialize local CDN for devnet (serves all Jeju app frontends)
  if (
    !isProduction ||
    serverConfig.devnet ||
    (typeof process !== 'undefined' && process.env.DEVNET === 'true')
  ) {
    const appsDir =
      serverConfig.appsDir ??
      (typeof process !== 'undefined'
        ? process.env.JEJU_APPS_DIR
        : undefined) ??
      '/apps'
    initializeLocalCDN({ appsDir, cacheEnabled: true })
      .then(() => {
        const localCDN = getLocalCDNServer()
        const apps = localCDN.getRegisteredApps()
        console.log(`[DWS] Local CDN: ${apps.length} apps registered`)
        for (const app of apps) {
          console.log(
            `[DWS]   - ${app.name}: /cdn/apps/${app.name}/ (port ${app.port})`,
          )
        }
      })
      .catch((e) => {
        console.warn(
          `[DWS] Local CDN initialization failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        )
      })
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

  /** WebSocket data for price streaming */
  interface PriceWebSocketData {
    type: 'prices'
    handlers: WebSocketHandlers
  }

  /** WebSocket data for edge coordination */
  interface EdgeWebSocketData {
    type: 'edge'
    handlers: WebSocketHandlers
  }

  /** WebSocket data attached to each connection */
  type WebSocketData = PriceWebSocketData | EdgeWebSocketData

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
        const data = ws.data as WebSocketData
        if (data.type === 'prices') {
          // Set up price subscription service
          const service = getPriceService()
          const subscribable = toSubscribableWebSocket(ws)
          data.handlers.message = (msgStr: string) => {
            const parseResult = SubscriptionMessageSchema.safeParse(
              JSON.parse(msgStr),
            )
            if (!parseResult.success) {
              console.warn(
                '[PriceService] Invalid WS message:',
                parseResult.error,
              )
              return
            }
            const msg = parseResult.data
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
        const data = ws.data as WebSocketData
        const msgStr =
          typeof message === 'string'
            ? message
            : new TextDecoder().decode(message)
        data.handlers.message?.(msgStr)
      },
      close(ws) {
        const data = ws.data as WebSocketData
        data.handlers.close?.()
      },
    },
  })

  // Start P2P coordination if enabled
  if (
    serverConfig.p2pEnabled ||
    (typeof process !== 'undefined' && process.env.DWS_P2P_ENABLED === 'true')
  ) {
    p2pCoordinator = decentralized.createP2P(baseUrl)
    distributedRateLimiter = decentralized.createRateLimiter(p2pCoordinator)
    p2pCoordinator
      .start()
      .then(() => {
        console.log(`[DWS] P2P coordination started`)
      })
      .catch(console.error)
  }

  // Discover existing DWS-managed containers on startup
  discoverExistingServices()
    .then(async () => {
      console.log('[DWS] Infrastructure services discovery complete')

      // Initialize EQLite as a DWS-managed service (not a separate deployment)
      try {
        await ensureEQLiteService()
        const status = getEQLiteStatus()
        console.log(`[DWS] EQLite running at ${status.endpoint}`)
      } catch (err) {
        console.warn(
          `[DWS] EQLite auto-start failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        )
        console.warn('[DWS] EQLite will be started on first database request')
      }
    })
    .catch(console.error)

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
