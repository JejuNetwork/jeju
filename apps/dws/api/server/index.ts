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

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  type ContractCategoryName,
  getApiKey,
  getContract,
  getCurrentNetwork,
  getDWSComputeUrl,
  getDWSUrl,
  getIpfsGatewayUrl,
  getKMSUrl,
  getL1RpcUrl,
  getLocalhostHost,
  getOAuth3Url,
  getRpcUrl,
  getServiceUrl,
  getSQLitBlockProducerUrl,
  isLocalnet,
  isProductionEnv,
  tryGetContract,
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
  createSecureSQLitRouter,
  ensureSQLitService,
  getSQLitStatus,
  type RegisteredDatabase,
  type ResourceStatus,
  startKeepaliveService,
  stopKeepaliveService,
} from '../database'
import { createDatabaseRoutes } from '../database/routes'
import {
  createDecentralizedServices,
  type DistributedRateLimiter,
  type P2PCoordinator,
} from '../decentralized'
import {
  createAppDeployerRouter,
  createGitHubIntegrationRouter,
} from '../deploy'
import { createDNSRouter } from '../dns/routes'
import {
  createDurableObjectsRouter,
  startDurableObjectManager,
} from '../durable-objects'
import { GitRepoManager } from '../git/repo-manager'
import {
  createHelmProviderRouter,
  createInfrastructure,
  createIngressRouter,
  createK3sRouter,
  createServiceMeshRouter,
  createTerraformProviderRouter,
  getIngressController,
  getServiceMesh,
  startDWSNode,
} from '../infrastructure'
import { createKubernetesBridgeRouter } from '../infrastructure/kubernetes-bridge'
import { banCheckMiddleware } from '../middleware/ban-check'
import { createHuggingFaceRouter } from '../ml/huggingface-compat'
import { createObservabilityRoutes } from '../observability/routes'
import { PkgRegistryManager } from '../pkg/registry-manager'
import { createSecurityRoutes } from '../security/routes'
import { createServicesRouter, discoverExistingServices } from '../services'
import { initializeDWSState } from '../state'
import { createBackendManager } from '../storage/backends'
import type { ServiceHealth } from '../types'
import { WorkerdExecutor } from '../workers/workerd/executor'
import { createA2ARouter } from './routes/a2a'
import { createAPIMarketplaceRouter } from './routes/api-marketplace'
import {
  createAppRouter,
  DEFAULT_API_PATHS,
  getDeployedApp,
  initializeAppRouter,
  proxyToBackend,
} from './routes/app-router'
import { createCDNRouter } from './routes/cdn'
import { createCIRouter } from './routes/ci'
import { createComputeRouter } from './routes/compute'
import { createContainerRouter } from './routes/containers'
import { createCronRouter } from './routes/cron'
import { createDARouter, shutdownDA } from './routes/da'
import { createDWSServicesRouter } from './routes/dws-services'
import { createEdgeRouter, handleEdgeWebSocket } from './routes/edge'
import { createExecRouter } from './routes/exec'
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
import { createOCIRegistryRouter } from './routes/oci-registry'
import { createPkgRouter } from './routes/pkg'
import { createPkgRegistryProxyRouter } from './routes/pkg-registry-proxy'
import {
  createPricesRouter,
  getPriceService,
  type SubscribableWebSocket,
  SubscriptionMessageSchema,
} from './routes/prices'
import { createPyPkgRouter } from './routes/pypkg'
import { releasesRoutes } from './routes/releases'
import { createRPCRouter } from './routes/rpc'
import { createS3Router } from './routes/s3'
import { createScrapingRouter } from './routes/scraping'
import { createSQLitProxyRouter } from './routes/sqlit'
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

// Distributed rate limiter using shared cache
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'

const RATE_LIMIT_WINDOW_SECONDS = 60
const RATE_LIMIT_MAX =
  (serverConfig.nodeEnv ??
    (isProductionEnv() ? 'production' : 'development')) === 'test'
    ? 100000
    : 1000
const SKIP_RATE_LIMIT_PATHS = ['/health', '/.well-known/']

/**
 * Get MIME type from file path extension
 */
function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const mimeTypes: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    js: 'application/javascript',
    mjs: 'application/javascript',
    css: 'text/css',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    pdf: 'application/pdf',
    txt: 'text/plain',
    xml: 'application/xml',
  }
  return mimeTypes[ext] ?? 'application/octet-stream'
}

let rateLimitCache: CacheClient | null = null

function getRateLimitCache(): CacheClient {
  if (!rateLimitCache) {
    rateLimitCache = getCacheClient('dws-ratelimit')
  }
  return rateLimitCache
}

async function checkRateLimitAsync(
  clientIp: string,
): Promise<{ allowed: boolean; count: number; resetAt: number }> {
  const cache = getRateLimitCache()
  const cacheKey = `ratelimit:${clientIp}`
  const now = Date.now()
  const resetAt = now + RATE_LIMIT_WINDOW_SECONDS * 1000

  const current = await cache.get(cacheKey)
  if (!current) {
    await cache.set(cacheKey, '1', RATE_LIMIT_WINDOW_SECONDS)
    return { allowed: true, count: 1, resetAt }
  }

  const count = parseInt(current, 10) + 1
  await cache.set(cacheKey, String(count), RATE_LIMIT_WINDOW_SECONDS)

  return {
    allowed: count <= RATE_LIMIT_MAX,
    count,
    resetAt,
  }
}

function rateLimiter() {
  return new Elysia({ name: 'rate-limiter' }).onBeforeHandle(
    async ({
      request,
      set,
    }): Promise<
      { error: string; message: string; retryAfter: number } | undefined
    > => {
      const url = new URL(request.url)
      const path = url.pathname
      if (SKIP_RATE_LIMIT_PATHS.some((p) => path.startsWith(p))) {
        return undefined
      }

      // Get client IP from proxy headers
      const forwardedFor = request.headers.get('x-forwarded-for')
      const clientIp =
        forwardedFor?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        request.headers.get('cf-connecting-ip') ||
        'local'

      const { allowed, count, resetAt } = await checkRateLimitAsync(clientIp)

      set.headers['X-RateLimit-Limit'] = String(RATE_LIMIT_MAX)
      set.headers['X-RateLimit-Remaining'] = String(
        Math.max(0, RATE_LIMIT_MAX - count),
      )
      set.headers['X-RateLimit-Reset'] = String(Math.ceil(resetAt / 1000))

      if (!allowed) {
        set.status = 429
        return {
          error: 'Too Many Requests',
          message: 'Rate limit exceeded',
          retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
        }
      }

      return undefined
    },
  )
}

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
  .use(
    cors({
      // Permissionless CORS for decentralized frontends
      // Frontends may be served from:
      // - jejunetwork.org (official)
      // - IPFS gateways (ipfs.io, dweb.link, cloudflare-ipfs.com, etc.)
      // - Arweave gateways
      // - Self-hosted instances
      // - localhost for development
      //
      // We allow all origins to support true decentralization.
      // Security is handled via:
      // - Rate limiting
      // - API key authentication for write operations
      // - Signature verification for sensitive actions
      origin: true, // Allow all origins for permissionless frontend access
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Request-ID',
        'X-Babylon-Api-Key',
        'X-Jeju-Address',
        'x-jeju-address',
        'X-IPFS-Gateway',
        'X-JNS-Name',
      ],
      exposeHeaders: ['X-Request-ID', 'X-Rate-Limit-Remaining', 'X-DWS-Node'],
      maxAge: 86400,
    }),
  )
  .use(rateLimiter())
  .use(banCheckMiddleware())
  // App router - routes requests by hostname to deployed apps
  // Must come early to intercept app-specific requests before other routes
  .use(createAppRouter())

const backendManager = createBackendManager()

// Environment validation - require addresses in production
const nodeEnv =
  serverConfig.nodeEnv ?? (isProductionEnv() ? 'production' : 'development')
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

/**
 * SECURITY: Private Key Configuration
 *
 * In production, private keys MUST be managed through KMS.
 * Direct private keys (DWS_PRIVATE_KEY) are BLOCKED in production.
 *
 * Production: Set DWS_KMS_KEY_ID for KMS-backed signing
 * Development: Can use DWS_PRIVATE_KEY for local testing only
 */
const kmsKeyId = process.env.DWS_KMS_KEY_ID
const directKey =
  (serverConfig.privateKey as Hex | undefined) ??
  (typeof process !== 'undefined'
    ? (process.env.DWS_PRIVATE_KEY as Hex | undefined)
    : undefined)

let dwsPrivateKey: Hex | undefined

if (isProduction) {
  // In production, BLOCK direct private keys
  if (directKey) {
    console.error(
      '[DWS] SECURITY ERROR: DWS_PRIVATE_KEY detected in production. ' +
        'Direct private keys are BLOCKED. Use DWS_KMS_KEY_ID for KMS-backed signing.',
    )
    // Don't use the direct key
    dwsPrivateKey = undefined
  }
  if (!kmsKeyId) {
    console.warn(
      '[DWS] WARNING: DWS_KMS_KEY_ID not set. On-chain operations may fail.',
    )
  }
} else {
  // Development: allow direct key with warning
  if (directKey) {
    console.warn(
      '[DWS] WARNING: Using DWS_PRIVATE_KEY for development. Use KMS in production.',
    )
    dwsPrivateKey = directKey
  }
}

// Git configuration - uses centralized config
const gitConfig = {
  rpcUrl: getRpcUrl(NETWORK),
  repoRegistryAddress: getContractOrZero('registry', 'repo'),
  privateKey: dwsPrivateKey,
  kmsKeyId: process.env.DWS_KMS_KEY_ID,
}

const repoManager = new GitRepoManager(gitConfig, backendManager)

// Package registry configuration (JejuPkg)
const pkgConfig = {
  rpcUrl: getRpcUrl(NETWORK),
  packageRegistryAddress: getContractOrZero('registry', 'package'),
  privateKey: dwsPrivateKey,
  kmsKeyId: process.env.DWS_KMS_KEY_ID,
}

const registryManager = new PkgRegistryManager(pkgConfig, backendManager)

// CI configuration
const ciConfig = {
  rpcUrl: getRpcUrl(NETWORK),
  triggerRegistryAddress: getContractOrZero('registry', 'trigger'),
  privateKey: dwsPrivateKey,
  kmsKeyId: process.env.DWS_KMS_KEY_ID,
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
  dwsEndpoint: `http://${getLocalhostHost()}:${PORT}`,
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
  // Fast health check for Kubernetes probes - no external calls
  .get('/health', () => {
    const health: ServiceHealth = {
      status: 'healthy',
      service: 'dws',
      version: '1.0.0',
      uptime: process.uptime() * 1000,
    }
    return health
  })
  // Detailed health check with external service status
  .get('/health/detailed', async () => {
    const backends = backendManager.listBackends()
    const backendHealth = await backendManager.healthCheck()

    // Helper to check HTTP endpoint health
    async function checkEndpoint(
      url: string,
      timeout = 2000,
    ): Promise<{
      status: 'healthy' | 'unhealthy' | 'not-running'
      latencyMs?: number
    }> {
      const start = Date.now()
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(timeout),
        })
        const latencyMs = Date.now() - start
        if (response.ok) {
          return { status: 'healthy', latencyMs }
        }
        return { status: 'unhealthy', latencyMs }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        console.warn(
          `[DWS Health] Endpoint check failed for ${url}: ${errorMsg}`,
        )
        return { status: 'not-running' }
      }
    }

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

    // Check SQLit status
    const sqlitStatus = getSQLitStatus()
    const sqlitHealthy =
      sqlitStatus.running && sqlitStatus.healthStatus === 'healthy'

    // Check cache engine
    const cacheEngine = getSharedEngine()
    const cacheHealthy = cacheEngine !== null

    // Check KMS
    const kmsUrl = serverConfig.kmsUrl ?? getKMSUrl()
    const kmsHealth = kmsUrl
      ? await checkEndpoint(`${kmsUrl}/health`)
      : { status: 'not-running' as const }

    // Check all storage backends are healthy
    const storageHealthy = Object.values(backendHealth).some((h) => h === true)

    // Determine overall health
    const overallHealthy = storageHealthy && sqlitHealthy

    const health: ServiceHealth = {
      status: overallHealthy ? 'healthy' : 'degraded',
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
        storage: {
          status: storageHealthy ? 'healthy' : 'degraded',
          backends,
          health: backendHealth,
        },
        compute: {
          status: 'available',
          description: 'Compute scheduling available',
        },
        cdn: {
          status: getLocalCDNServer() ? 'healthy' : 'available',
          description: 'Decentralized CDN with edge caching',
        },
        git: { status: 'available', description: 'Git repository hosting' },
        pkg: { status: 'available', description: 'Package registry' },
        ci: { status: 'available', description: 'CI/CD pipelines' },
        oauth3: await (async () => {
          const oauth3Url =
            serverConfig.oauth3AgentUrl ??
            (typeof process !== 'undefined'
              ? process.env.OAUTH3_AGENT_URL
              : undefined) ??
            getOAuth3Url(NETWORK)
          const result = await checkEndpoint(`${oauth3Url}/health`)
          return {
            ...result,
            endpoint: oauth3Url,
            hint:
              result.status === 'not-running'
                ? 'Start OAuth3: cd apps/oauth3 && bun run dev'
                : undefined,
          }
        })(),
        s3: { status: 'available', description: 'S3-compatible storage API' },
        workers: { status: 'available', description: 'Serverless functions' },
        workerd: { status: 'available', runtime: 'V8 isolates' },
        agents: { status: 'available', description: 'ElizaOS agent runtime' },
        kms: { ...kmsHealth, endpoint: kmsUrl ?? 'not-configured' },
        vpn: { status: 'available', description: 'VPN gateway' },
        scraping: { status: 'available', description: 'Web scraping service' },
        rpc: { status: 'available', description: 'JSON-RPC proxy' },
        da: { status: 'available', description: 'Data Availability layer' },
        cache: {
          status: cacheHealthy ? 'healthy' : 'not-initialized',
          description: 'Decentralized serverless cache',
        },
        email: {
          status: 'available',
          description: 'Decentralized email with SMTP/IMAP',
        },
        lb: { status: 'available', description: 'Scale-to-zero load balancer' },
        indexer: {
          status: 'available',
          description: 'Decentralized indexer proxy',
        },
        faucet: {
          status: NETWORK !== 'mainnet' ? 'available' : 'disabled',
          description: 'Testnet-only JEJU token faucet',
        },
        database: {
          status: sqlitHealthy ? 'healthy' : 'degraded',
          sqlit: sqlitStatus,
          description: 'Managed SQLit and PostgreSQL',
        },
        security: {
          status: 'available',
          description: 'WAF, access control, secrets, audit',
        },
        observability: {
          status: 'available',
          description: 'Logs, metrics, traces, alerts',
        },
      },
      backends: { available: backends, health: backendHealth },
    }
  })

  // Serve frontend at root
  .get('/', async ({ set }) => {
    const decentralizedResponse =
      await decentralized.frontend.serveAsset('index.html')
    if (decentralizedResponse) return decentralizedResponse

    const file = Bun.file('./dist/index.html')
    if (await file.exists()) {
      const html = await file.text()
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html',
          'X-DWS-Source': 'local',
        },
      })
    }

    // Fallback if frontend not built
    set.status = 404
    return {
      error:
        'Frontend not available. Build the frontend with `bun run build:web` or set DWS_FRONTEND_CID.',
    }
  })

  // API info endpoint (moved from root)
  .get('/api/info', () => ({
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
      'database',
      'security',
      'observability',
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
      database: '/database/*',
      security: '/security/*',
      observability: '/observability/*',
    },
  }))

// Route mounting - these routers need to be Elysia instances
app.use(createStorageRouter())
app.use(createComputeRouter())
app.use(createCDNRouter())
app.use(createGitRouter({ repoManager, backend: backendManager }))
app.use(createPkgRouter({ registryManager, backend: backendManager }))
app.use(createPyPkgRouter({ registryManager, backend: backendManager }))
app.use(
  createCIRouter({ workflowEngine, repoManager, backend: backendManager }),
)
app.use(createOAuth3Router())
app.use(createAPIMarketplaceRouter())
app.use(createContainerRouter())
app.use(createOCIRegistryRouter()) // Docker Registry v2 API for container pulls
app.use(createA2ARouter())
app.use(createMCPRouter())

// Exec service for workerd and other components (localhost only)
app.use(createExecRouter())

// New DWS services
app.use(createS3Router(backendManager))
app.use(createWorkersRouter(backendManager))
app.use(createCronRouter()) // Worker cron management
app.use(createDurableObjectsRouter()) // Durable Objects
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
app.use(releasesRoutes)
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
app.use(createSecureSQLitRouter())
app.use(createSQLitProxyRouter())
app.use(createKeepaliveRouter())

// Infrastructure services (postgres, redis, etc.)
app.use(createServicesRouter())

// DWS-native services (OAuth3, DA, Email, Hubble, Workers)
// These replace K8s Helm deployments with DWS control plane
app.use(createDWSServicesRouter())

// App deployment - Heroku/EKS-like experience
app.use(createAppDeployerRouter())

// GitHub integration - Vercel-like CI/CD
app.use(createGitHubIntegrationRouter())

// Indexer proxy for decentralized indexer access
app.use(createIndexerRouter())

// Managed database services (SQLit + PostgreSQL)
app.use(createDatabaseRoutes(backendManager))

// Security services (WAF, access control, secrets, audit)
app.use(createSecurityRoutes())

// Observability services (logs, metrics, traces, alerts)
app.use(createObservabilityRoutes('dws'))

// Data Availability Layer
// SECURITY: DA_OPERATOR_PRIVATE_KEY blocked in production, use DA_OPERATOR_KMS_KEY_ID
const daDirectKey =
  (serverConfig.daOperatorPrivateKey as Hex | undefined) ??
  (typeof process !== 'undefined'
    ? (process.env.DA_OPERATOR_PRIVATE_KEY as Hex | undefined)
    : undefined)

let daOperatorPrivateKey: Hex | undefined
if (isProduction && daDirectKey) {
  console.error(
    '[DWS] SECURITY ERROR: DA_OPERATOR_PRIVATE_KEY detected in production. ' +
      'Use DA_OPERATOR_KMS_KEY_ID instead.',
  )
  // Don't use direct key in production
} else if (daDirectKey) {
  console.warn(
    '[DWS] WARNING: Using DA_OPERATOR_PRIVATE_KEY for development. Use KMS in production.',
  )
  daOperatorPrivateKey = daDirectKey
}

const daConfig = {
  operatorPrivateKey: daOperatorPrivateKey,
  operatorKmsKeyId: process.env.DA_OPERATOR_KMS_KEY_ID,
  operatorEndpoint:
    serverConfig.daOperatorEndpoint ??
    serverConfig.baseUrl ??
    (typeof process !== 'undefined' ? process.env.DWS_BASE_URL : undefined) ??
    getDWSUrl(NETWORK) ??
    `http://${getLocalhostHost()}:${PORT}`,
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
    ((typeof process !== 'undefined'
      ? process.env.DA_CONTRACT_ADDRESS
      : undefined) as Address | undefined) ??
    (tryGetContract('dws', 'dataAvailability', NETWORK) as
      | Address
      | undefined) ??
    ZERO_ADDR,
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
app.use(createKubernetesBridgeRouter())

// Serve static assets (JS, CSS, images) from /web/*
app.get('/web/*', async ({ request, set }) => {
  const url = new URL(request.url)
  const assetPath = url.pathname.replace('/web/', '')

  const decentralizedResponse = await decentralized.frontend.serveAsset(
    `web/${assetPath}`,
  )
  if (decentralizedResponse) return decentralizedResponse

  const file = Bun.file(`./dist/web/${assetPath}`)
  if (await file.exists()) {
    const contentType = assetPath.endsWith('.js')
      ? 'application/javascript'
      : assetPath.endsWith('.css')
        ? 'text/css'
        : assetPath.endsWith('.json')
          ? 'application/json'
          : assetPath.endsWith('.png')
            ? 'image/png'
            : assetPath.endsWith('.jpg') || assetPath.endsWith('.jpeg')
              ? 'image/jpeg'
              : assetPath.endsWith('.svg')
                ? 'image/svg+xml'
                : assetPath.endsWith('.woff') || assetPath.endsWith('.woff2')
                  ? 'font/woff2'
                  : 'application/octet-stream'

    return new Response(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-DWS-Source': 'local',
      },
    })
  }

  set.status = 404
  return { error: 'Asset not found' }
})

// Serve frontend - from IPFS when configured, fallback to local
app.get('/app', async ({ set }) => {
  const decentralizedResponse =
    await decentralized.frontend.serveAsset('index.html')
  if (decentralizedResponse) return decentralizedResponse

  const file = Bun.file('./dist/index.html')
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
  const host = getLocalhostHost()
  const baseUrl =
    serverConfig.baseUrl ??
    (typeof process !== 'undefined' ? process.env.DWS_BASE_URL : undefined) ??
    getDWSUrl(NETWORK) ??
    `http://${host}:${PORT}`
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
      {
        name: 'database',
        endpoint: `${baseUrl}/database`,
        description: 'Managed SQLit and PostgreSQL databases',
      },
      {
        name: 'security',
        endpoint: `${baseUrl}/security`,
        description: 'WAF, RBAC, secrets management, audit logging',
      },
      {
        name: 'observability',
        endpoint: `${baseUrl}/observability`,
        description: 'Logs, metrics, traces, and alerting',
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

// SPA catch-all route for frontend routes like /security/oauth3
// This must come after all API routes but before 404 fallback
// Only serves index.html for paths that look like frontend routes (not API endpoints)
app.get('/*', async ({ path, set }) => {
  // Skip API-like paths that should return 404 if not handled
  // Include both with and without trailing slash for exact matches
  const apiPrefixes = [
    '/api',
    '/storage',
    '/compute',
    '/workers',
    '/containers',
    '/cdn',
    '/git',
    '/pkg',
    '/ci',
    '/kms',
    '/vpn',
    '/scraping',
    '/rpc',
    '/s3',
    '/workerd',
    '/a2a',
    '/mcp',
    '/oauth3',
    '/edge',
    '/agents',
    '/moderation',
    '/cache',
    '/sqlit',
    '/prices',
    '/indexer',
    '/_internal',
    '/.well-known',
    '/dws-services',
    '/deploy',
    '/apps',
    '/ipfs',
    '/upload',
    '/databases',
    '/services',
  ]

  // Check if path matches any API prefix (with or without trailing content)
  const isApiPath = apiPrefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
  if (isApiPath) {
    set.status = 404
    return { error: 'NOT_FOUND' }
  }

  // Serve index.html for frontend routes (SPA fallback)
  const decentralizedResponse =
    await decentralized.frontend.serveAsset('index.html')
  if (decentralizedResponse) return decentralizedResponse

  const file = Bun.file('./dist/index.html')
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

// Initialize services
initializeMarketplace()
initializeContainerSystem()

// Initialize DWS cache provisioning
initializeCacheProvisioning().catch((err) => {
  console.warn('[DWS] Cache provisioning init failed:', err.message)
})

// Initialize agent system
const SQLIT_URL = getSQLitBlockProducerUrl()
const AGENTS_DB_ID =
  serverConfig.agentsDatabaseId ??
  (typeof process !== 'undefined'
    ? process.env.AGENTS_DATABASE_ID
    : undefined) ??
  'dws-agents'
initRegistry({ sqlitUrl: SQLIT_URL, databaseId: AGENTS_DB_ID }).catch((err) => {
  console.warn(
    '[DWS] Agent registry init failed (SQLit may not be running):',
    err.message,
  )
})

// Agent executor - initialized after server starts (see below)
const workerdExecutor = new WorkerdExecutor(backendManager)

let server: ReturnType<typeof Bun.serve> | null = null

function shutdown(signal: string) {
  console.log(`[DWS] Received ${signal}, shutting down gracefully...`)
  shutdownDA()
  console.log('[DWS] DA layer stopped')
  shutdownLoadBalancer()
  console.log('[DWS] Load balancer stopped')
  shutdownIndexerProxy()
  console.log('[DWS] Indexer proxy stopped')
  stopKeepaliveService()
  console.log('[DWS] Keepalive service stopped')
  // Stop cron executor
  import('../workers/cron-executor')
    .then(({ stopCronExecutor }) => {
      stopCronExecutor()
      console.log('[DWS] Cron executor stopped')
    })
    .catch(() => {
      // Ignore import errors during shutdown
    })
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
  // SECURITY: Validate security configuration at startup
  // Checks KMS availability, HSM availability, secret configuration
  // In production, will exit if critical security requirements are not met
  const { enforceSecurityAtStartup } = await import(
    '../shared/security-validator'
  )
  await enforceSecurityAtStartup('DWS Server')

  // Configure route modules with injected config
  const { configureCDNRouterConfig } = await import('./routes/cdn')
  const { configureOAuth3RouterConfig } = await import('./routes/oauth3')
  const { configureProxyRouterConfig } = await import('./routes/proxy')
  const { configureDNSRouterConfig } = await import('../dns/routes')
  const { configureX402PaymentsConfig } = await import(
    '../rpc/services/x402-payments'
  )

  // Inject configs from serverConfig and process.env (for backward compatibility)
  configureCDNRouterConfig({
    jnsRegistryAddress: getContractOrZero('registry', 'jns'),
    jnsResolverAddress: getContractOrZero('registry', 'jnsResolver'),
    rpcUrl: getRpcUrl(NETWORK),
    ipfsGatewayUrl: getIpfsGatewayUrl(NETWORK),
    arweaveGatewayUrl:
      typeof process !== 'undefined'
        ? process.env.ARWEAVE_GATEWAY_URL
        : undefined,
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
    isDevnet: isLocalnet(NETWORK) || serverConfig.devnet,
    jejuAppsDir:
      typeof process !== 'undefined' ? process.env.JEJU_APPS_DIR : undefined,
    nodeEnv:
      serverConfig.nodeEnv ??
      (isProductionEnv() ? 'production' : 'development'),
  })

  configureOAuth3RouterConfig({
    agentUrl: serverConfig.oauth3AgentUrl ?? getOAuth3Url(NETWORK),
  })

  // Monitoring service doesn't have a getServiceUrl helper, so construct URLs manually
  const monitoringHost = isLocalnet(NETWORK)
    ? getLocalhostHost()
    : 'monitoring.jejunetwork.org'
  const monitoringPort = isLocalnet(NETWORK) ? CORE_PORTS.MONITORING.get() : 443
  const monitoringProtocol = isLocalnet(NETWORK) ? 'http' : 'https'
  const monitoringBaseUrl = isLocalnet(NETWORK)
    ? `${monitoringProtocol}://${monitoringHost}:${monitoringPort}`
    : `${monitoringProtocol}://${monitoringHost}`

  configureProxyRouterConfig({
    indexerUrl: getServiceUrl('indexer', 'api', NETWORK),
    indexerGraphqlUrl: getServiceUrl('indexer', 'graphql', NETWORK),
    monitoringUrl: `${monitoringBaseUrl}/api`,
    prometheusUrl: `${monitoringBaseUrl}/prometheus`,
    gatewayUrl: getServiceUrl('gateway', 'api', NETWORK),
  })

  configureDNSRouterConfig({
    ethRpcUrl: getL1RpcUrl(NETWORK),
    cfApiToken: getApiKey('cloudflare'),
    cfZoneId:
      typeof process !== 'undefined' ? process.env.CF_ZONE_ID : undefined,
    cfDomain:
      typeof process !== 'undefined' ? process.env.CF_DOMAIN : undefined,
    awsAccessKeyId:
      typeof process !== 'undefined'
        ? process.env.AWS_ACCESS_KEY_ID
        : undefined,
    awsSecretAccessKey:
      typeof process !== 'undefined'
        ? process.env.AWS_SECRET_ACCESS_KEY
        : undefined,
    awsHostedZoneId:
      typeof process !== 'undefined'
        ? process.env.AWS_HOSTED_ZONE_ID
        : undefined,
    awsDomain:
      typeof process !== 'undefined' ? process.env.AWS_DOMAIN : undefined,
    dnsMirrorDomain:
      typeof process !== 'undefined'
        ? process.env.DNS_MIRROR_DOMAIN
        : undefined,
    dnsSyncInterval:
      typeof process !== 'undefined'
        ? parseInt(process.env.DNS_SYNC_INTERVAL || '300', 10)
        : undefined,
    gatewayEndpoint: getServiceUrl('gateway', 'api', NETWORK),
    ipfsGateway: getIpfsGatewayUrl(NETWORK),
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

  const host = getLocalhostHost()
  const baseUrl =
    serverConfig.baseUrl ??
    (typeof process !== 'undefined' ? process.env.DWS_BASE_URL : undefined) ??
    `http://${host}:${PORT}`

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
  const appsDir =
    serverConfig.appsDir ??
    (typeof process !== 'undefined' ? process.env.JEJU_APPS_DIR : undefined) ??
    join(import.meta.dir, '../../../../apps') // Default to monorepo apps directory
  if (
    (!isProduction || serverConfig.devnet || isLocalnet(NETWORK)) &&
    existsSync(appsDir)
  ) {
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

  /** WebSocket data for Durable Object connections */
  interface DurableObjectWebSocketData {
    type: 'durable-object'
    namespace: string
    doId: string
    handlers: WebSocketHandlers
  }

  /** WebSocket data attached to each connection */
  type WebSocketData =
    | PriceWebSocketData
    | EdgeWebSocketData
    | DurableObjectWebSocketData

  server = Bun.serve({
    port: PORT,
    maxRequestBodySize: 500 * 1024 * 1024, // 500MB for large artifact uploads
    idleTimeout: 120, // 120 seconds - health checks can take time when external services are slow
    async fetch(req, bunServer) {
      // Cast to simpler type for upgrade calls
      const server = bunServer as {
        upgrade(
          req: Request,
          options?: { data?: WebSocketData; headers?: HeadersInit },
        ): boolean
      }
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

      // Handle Durable Object WebSocket
      // Path format: /do/:namespace/:doId/ws
      const doWsMatch = url.pathname.match(/^\/do\/([^/]+)\/([^/]+)\/ws$/)
      if (doWsMatch && req.headers.get('upgrade') === 'websocket') {
        const [, namespace, doId] = doWsMatch
        const success = server.upgrade(req, {
          data: {
            type: 'durable-object',
            namespace,
            doId,
            handlers: {} as WebSocketHandlers,
          },
        })
        if (success) return undefined
        return new Response('WebSocket upgrade failed', { status: 500 })
      }

      // App routing - check if request is for a deployed app
      const hostname = req.headers.get('host') ?? url.hostname

      // Check if this is a deployed app (not dws itself)
      // Skip internal IPs and localhost for health checks
      const isInternalIp = hostname.match(
        /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.)/,
      )
      if (
        !hostname.startsWith('dws.') &&
        !isInternalIp &&
        hostname !== 'localhost'
      ) {
        const appName = hostname.split('.')[0]
        const deployedApp = getDeployedApp(appName)
        if (deployedApp?.enabled) {
          // Route to backend for API paths - use DEFAULT_API_PATHS if not configured
          const apiPaths = deployedApp.apiPaths ?? DEFAULT_API_PATHS
          const isApiRequest = apiPaths.some((pattern) => {
            // Handle glob patterns like /api/*
            if (pattern.endsWith('/*')) {
              const basePrefix = pattern.slice(0, -2) // Remove /*
              return (
                url.pathname === basePrefix ||
                url.pathname.startsWith(`${basePrefix}/`)
              )
            }
            // Handle trailing wildcard /api*
            if (pattern.endsWith('*')) {
              const basePrefix = pattern.slice(0, -1)
              return url.pathname.startsWith(basePrefix)
            }
            // Exact match
            return url.pathname === pattern
          })
          if (
            isApiRequest &&
            (deployedApp.backendEndpoint || deployedApp.backendWorkerId)
          ) {
            return proxyToBackend(req, deployedApp, url.pathname)
          }
          // Serve frontend from IPFS/storage if configured
          if (deployedApp.frontendCid || deployedApp.staticFiles) {
            const gateway = getIpfsGatewayUrl(NETWORK)
            let assetPath = url.pathname === '/' ? '/index.html' : url.pathname
            // SPA: serve index.html for non-asset paths
            if (deployedApp.spa && !assetPath.match(/\.\w+$/)) {
              assetPath = '/index.html'
            }

            // Check staticFiles map first for individual file CIDs
            if (deployedApp.staticFiles) {
              const filePathWithSlash = assetPath.startsWith('/')
                ? assetPath
                : `/${assetPath}`
              const filePathWithoutSlash = assetPath.replace(/^\//, '')
              // Try both with and without leading slash since deploy scripts vary
              const fileCid =
                deployedApp.staticFiles[filePathWithSlash] ??
                deployedApp.staticFiles[filePathWithoutSlash]
              if (fileCid) {
                // Fetch from DWS storage
                const storageUrl =
                  NETWORK === 'localnet'
                    ? `http://127.0.0.1:4030/storage/download/${fileCid}`
                    : `https://dws.${NETWORK === 'testnet' ? 'testnet.' : ''}jejunetwork.org/storage/download/${fileCid}`
                const resp = await fetch(storageUrl).catch(() => null)
                if (resp?.ok) {
                  const contentType = getMimeType(filePathWithoutSlash)
                  return new Response(resp.body, {
                    headers: {
                      'Content-Type': contentType,
                      'X-DWS-Source': 'ipfs-storage',
                      'X-DWS-CID': fileCid,
                    },
                  })
                }
              }
            }

            // Fallback: try directory-style CID if frontendCid is set
            if (deployedApp.frontendCid) {
              const ipfsUrl = `${gateway}/ipfs/${deployedApp.frontendCid}${assetPath}`
              const resp = await fetch(ipfsUrl).catch(() => null)
              if (resp?.ok) {
                return resp
              }
              // Fallback: if path is index.html and directory lookup fails,
              // the CID itself might be the index.html file
              if (assetPath === '/index.html') {
                const directUrl = `${gateway}/ipfs/${deployedApp.frontendCid}`
                return fetch(directUrl)
              }
            }

            // Return 404 if no CID found
            return new Response('Not Found', { status: 404 })
          }
          // No frontend CID or staticFiles - proxy all requests to backend
          if (deployedApp.backendEndpoint || deployedApp.backendWorkerId) {
            return proxyToBackend(req, deployedApp, url.pathname)
          }
          // App is registered but has no frontend or backend - return 503
          return new Response(
            JSON.stringify({
              error: 'Service unavailable',
              message: `App ${appName} is registered but has no frontend or backend configured`,
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        // App not found in registry - return 404 instead of falling through to DWS
        return new Response(
          JSON.stringify({
            error: 'Not Found',
            message: `App ${appName} is not deployed on this network`,
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        )
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
        } else if (data.type === 'durable-object') {
          // Set up Durable Object WebSocket
          // Route to the DO instance for handling
          const { namespace, doId } = data
          console.log(`[DWS] DO WebSocket connection: ${namespace}/${doId}`)

          // Messages will be forwarded to the DO instance via its acceptWebSocket handler
          data.handlers.message = (msgStr: string) => {
            console.log(
              `[DWS] DO WebSocket message: ${namespace}/${doId}: ${msgStr.substring(0, 100)}`,
            )
            // Forward to DO instance - this is handled by the DO's own message handlers
            // The DO uses state.acceptWebSocket() which manages its own WebSocket tracking
          }
          data.handlers.close = () => {
            console.log(`[DWS] DO WebSocket closed: ${namespace}/${doId}`)
          }
          data.handlers.error = () => {
            console.error(`[DWS] DO WebSocket error: ${namespace}/${doId}`)
          }
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

    // Auto-register node if private key is available
    if (dwsPrivateKey) {
      const infra = createInfrastructure(
        {
          network:
            NETWORK === 'localnet' ||
            NETWORK === 'testnet' ||
            NETWORK === 'mainnet'
              ? NETWORK
              : 'localnet',
          privateKey: dwsPrivateKey,
          selfEndpoint: baseUrl,
        },
        backendManager,
        workerdExecutor,
      )

      // Register node with default specs for testnet
      startDWSNode(infra, {
        endpoint: baseUrl,
        capabilities: ['storage', 'compute', 'cdn'],
        specs: {
          cpuCores: 2,
          memoryMb: 4096,
          storageMb: 10000,
          bandwidthMbps: 100,
        },
        pricing: {
          pricePerHour: BigInt(100000000000000), // 0.0001 ETH/hour
          pricePerGb: BigInt(10000000000000), // 0.00001 ETH/GB
          pricePerRequest: BigInt(1000000000000), // 0.000001 ETH/request
        },
        region: 'us-east-1',
      })
        .then(({ agentId, txHash }) => {
          console.log(
            `[DWS] Node registered! AgentId: ${agentId}, TxHash: ${txHash}`,
          )
        })
        .catch((err) => {
          console.error('[DWS] Node registration failed:', err)
        })
    }
  }

  // Initialize agent executor now that server is ready
  workerdExecutor
    .initialize()
    .then(() => {
      initExecutor(workerdExecutor, {
        inferenceUrl:
          serverConfig.inferenceUrl ??
          (typeof process !== 'undefined'
            ? process.env.DWS_INFERENCE_URL
            : undefined) ??
          getDWSComputeUrl(NETWORK),
        kmsUrl:
          serverConfig.kmsUrl ??
          (typeof process !== 'undefined'
            ? process.env.DWS_KMS_URL
            : undefined) ??
          getKMSUrl(NETWORK),
        sqlitUrl: SQLIT_URL,
      })
      console.log('[DWS] Agent executor initialized')
    })
    .catch((err) => {
      console.warn('[DWS] Agent executor init failed:', err.message)
    })

  // Initialize DWS state (determines memory-only vs SQLit mode)
  initializeDWSState()
    .then(async () => {
      console.log('[DWS] State initialized')

      // Start Durable Objects manager
      startDurableObjectManager()
        .then(() => {
          console.log('[DWS] Durable Objects manager started')
        })
        .catch((err) => {
          console.warn(
            '[DWS] Durable Objects manager init failed:',
            err.message,
          )
        })

      // Start Cron Executor after state is initialized
      const { startCronExecutor } = await import('../workers/cron-executor')
      try {
        const cronExecutor = startCronExecutor({
          workerBaseUrl: `http://localhost:${PORT}`,
          tickIntervalMs: 30000, // Check every 30 seconds
          maxConcurrent: 10,
          lockTtlSeconds: 300, // 5 minute lock TTL
        })
        const stats = await cronExecutor.getStats()
        console.log(
          `[DWS] Cron executor started (${stats.cronStats.enabled} enabled crons)`,
        )
      } catch (err) {
        console.warn(
          '[DWS] Cron executor init failed:',
          err instanceof Error ? err.message : String(err),
        )
      }
    })
    .catch((err) => {
      console.warn('[DWS] State init warning:', err.message)
    })

  // Discover existing DWS-managed containers on startup
  discoverExistingServices()
    .then(async () => {
      console.log('[DWS] Infrastructure services discovery complete')

      // Initialize SQLit as a DWS-managed service (not a separate deployment)
      try {
        await ensureSQLitService()
        const status = getSQLitStatus()
        console.log(`[DWS] SQLit running at ${status.endpoint}`)
      } catch (err) {
        console.warn(
          `[DWS] SQLit auto-start failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        )
        console.warn('[DWS] SQLit will be started on first database request')
      }
    })
    .catch(console.error)

  // Initialize app router (loads deployed apps from registry and ingress rules)
  initializeAppRouter()
    .then(() => {
      console.log('[DWS] App router initialized')
    })
    .catch((err) => {
      console.warn('[DWS] App router init failed:', err.message)
    })

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

  // Handle uncaught errors to prevent crashes
  process.on('uncaughtException', (error) => {
    console.error('[DWS] Uncaught exception:', error.message)
    console.error(error.stack)
    // Don't exit - try to keep running
  })

  process.on('unhandledRejection', (reason, promise) => {
    console.error('[DWS] Unhandled rejection at:', promise)
    console.error('[DWS] Reason:', reason)
    // Don't exit - try to keep running
  })

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

export { app, backendManager, repoManager, registryManager, workflowEngine }
