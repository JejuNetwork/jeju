/**
 * Factory API Worker
 *
 * DWS-deployable worker using Elysia.
 * Compatible with workerd runtime and DWS infrastructure.
 *
 * Note: This worker excludes routes that depend on native modules
 * which can't run in DWS. XMTP now uses @xmtp/browser-sdk (WASM-based).
 * For full functionality, use the server.ts entry point.
 */

import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getCurrentNetwork,
  getEnvVar,
  getL2RpcUrl,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { configureFactory, getFactoryConfig } from './config'
import { closeDB, initDB } from './db/client'
import { a2aRoutes } from './routes/a2a'
import { agentsRoutes } from './routes/agents'
import { bountiesRoutes } from './routes/bounties'
import { ciRoutes } from './routes/ci'
import { containersRoutes } from './routes/containers'
import { datasetsRoutes } from './routes/datasets'
import { discussionsRoutes } from './routes/discussions'
// Farcaster routes excluded - use native hub bindings
// import { farcasterRoutes } from './routes/farcaster'
// Feed routes excluded - depends on farcaster
// import { feedRoutes } from './routes/feed'
import { gitRoutes } from './routes/git'
import { healthRoutes } from './routes/health'
import { issuesRoutes } from './routes/issues'
import { jobsRoutes } from './routes/jobs'
import { leaderboardRoutes } from './routes/leaderboard'
import { mcpRoutes } from './routes/mcp'
// Messages routes excluded - uses @jejunetwork/messaging with XMTP
// import { messagesRoutes } from './routes/messages'
import { modelsRoutes } from './routes/models'
import { packageSettingsRoutes } from './routes/package-settings'
import { packagesRoutes } from './routes/packages'
// Projects routes excluded - imports farcaster
// import { projectsRoutes } from './routes/projects'
import { pullsRoutes } from './routes/pulls'
import { releasesRoutes } from './routes/releases'
import { repoSettingsRoutes } from './routes/repo-settings'
import { shutdownNonceStore } from './validation/nonce-store'
import {
  checkRateLimit,
  getClientIdentifier,
  getRateLimitHeaders,
  getRateLimitTier,
  shutdownRateLimiter,
} from './validation/rate-limiter'

// Worker Environment Types

export interface FactoryEnv {
  TEE_MODE: 'real' | 'simulated'
  TEE_PLATFORM: string
  TEE_REGION: string
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string
  DWS_URL: string
  GATEWAY_URL: string
  INDEXER_URL: string
  SQLIT_NODES: string
  SQLIT_DATABASE_ID: string
  SQLIT_PRIVATE_KEY?: string
}

// Create Elysia App

export function createFactoryApp(env?: Partial<FactoryEnv>) {
  const isDev = env?.NETWORK === 'localnet'

  const app = new Elysia()
    .get('/health', () => ({
      status: 'ok',
      service: 'factory-api',
      teeMode: env?.TEE_MODE ?? 'simulated',
      teePlatform: env?.TEE_PLATFORM ?? 'local',
      teeRegion: env?.TEE_REGION ?? 'local',
      network: env?.NETWORK ?? 'localnet',
    }))
    .onRequest(async ({ request, set }): Promise<Response | undefined> => {
      const url = new URL(request.url)
      if (
        url.pathname === '/health' ||
        url.pathname === '/api/health' ||
        url.pathname.startsWith('/swagger')
      ) {
        return undefined
      }
      const headers: Record<string, string | undefined> = {}
      request.headers.forEach((v, k) => {
        headers[k] = v
      })
      const clientId = getClientIdentifier(headers)
      const tier = getRateLimitTier(request.method, url.pathname)
      const result = await checkRateLimit(clientId, tier)
      const rateLimitHeaders = getRateLimitHeaders(result)
      for (const [k, v] of Object.entries(rateLimitHeaders)) {
        set.headers[k] = v
      }
      if (!result.allowed) {
        set.status = 429
        return new Response(
          JSON.stringify({
            error: 'RATE_LIMITED',
            message: `Rate limit exceeded. Retry after ${result.retryAfter}s`,
            retryAfter: result.retryAfter,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              ...rateLimitHeaders,
            },
          },
        )
      }
      return undefined
    })
    .use(
      cors({
        origin: isDev
          ? true
          : [
              'https://factory.jejunetwork.org',
              'https://factory.testnet.jejunetwork.org',
              getCoreAppUrl('FACTORY'),
            ],
        credentials: true,
      }),
    )
    .use(
      openapi({
        provider: 'swagger-ui',
        path: '/swagger',
        documentation: {
          info: {
            title: 'Factory API',
            version: '1.0.0',
            description:
              'Developer coordination hub - bounties, jobs, git, packages, containers, models',
          },
          tags: [
            { name: 'health', description: 'Health check endpoints' },
            { name: 'bounties', description: 'Bounty management' },
            { name: 'git', description: 'Git repository operations' },
            { name: 'packages', description: 'Package registry' },
            { name: 'containers', description: 'Container registry' },
            { name: 'models', description: 'AI model hub' },
            { name: 'datasets', description: 'Dataset management' },
            { name: 'jobs', description: 'Job postings' },
            { name: 'projects', description: 'Project management' },
            { name: 'ci', description: 'CI/CD workflows' },
            { name: 'agents', description: 'AI agents' },
            { name: 'feed', description: 'Developer feed' },
            { name: 'issues', description: 'Issue tracking' },
            { name: 'pulls', description: 'Pull requests' },
            { name: 'releases', description: 'App releases and downloads' },
            { name: 'a2a', description: 'Agent-to-Agent protocol' },
            { name: 'mcp', description: 'Model Context Protocol' },
          ],
        },
      }),
    )
    .use(healthRoutes)
    .use(bountiesRoutes)
    .use(gitRoutes)
    .use(repoSettingsRoutes)
    .use(packagesRoutes)
    .use(packageSettingsRoutes)
    .use(containersRoutes)
    .use(modelsRoutes)
    .use(datasetsRoutes)
    .use(jobsRoutes)
    // .use(projectsRoutes) // Excluded - uses farcaster native bindings
    .use(ciRoutes)
    .use(agentsRoutes)
    // .use(farcasterRoutes) // Excluded - uses native hub bindings
    // .use(feedRoutes) // Excluded - depends on farcaster
    // .use(messagesRoutes) // Excluded - uses XMTP native bindings
    .use(discussionsRoutes)
    .use(issuesRoutes)
    .use(pullsRoutes)
    .use(releasesRoutes)
    .use(a2aRoutes)
    .use(leaderboardRoutes)
    .use(mcpRoutes)

  return app
}

// Worker Export (for DWS/workerd)

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

let cachedApp: ReturnType<typeof createFactoryApp> | null = null
let cachedEnvHash: string | null = null

function getAppForEnv(env: FactoryEnv): ReturnType<typeof createFactoryApp> {
  const envHash = `${env.NETWORK}-${env.TEE_MODE}`

  if (cachedApp && cachedEnvHash === envHash) {
    return cachedApp
  }

  cachedApp = createFactoryApp(env).compile()
  cachedEnvHash = envHash
  return cachedApp
}

/**
 * Default export for workerd/Cloudflare Workers
 */
export default {
  async fetch(
    request: Request,
    env: FactoryEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const app = getAppForEnv(env)
    return app.handle(request)
  },
}

// Standalone Server (for local dev)

const isMainModule = typeof Bun !== 'undefined' && import.meta.path === Bun.main

if (isMainModule) {
  const config = getFactoryConfig()

  configureFactory({
    port: config.port,
    isDev: getEnvVar('NODE_ENV') !== 'production',
    dwsUrl: getEnvVar('DWS_URL'),
    rpcUrl: getEnvVar('RPC_URL'),
    factoryDataDir: getEnvVar('FACTORY_DATA_DIR'),
    signerEncryptionKey: getEnvVar('SIGNER_ENCRYPTION_KEY'),
    factoryChannelId: getEnvVar('FACTORY_CHANNEL_ID'),
    dcRelayUrl: getEnvVar('DC_RELAY_URL'),
  })

  initDB().catch((err) => {
    console.error('[factory] Failed to initialize database:', err)
    process.exit(1)
  })

  async function gracefulShutdown(signal: string) {
    console.log(`[factory] ${signal} received, shutting down...`)
    shutdownRateLimiter()
    shutdownNonceStore()
    await closeDB()
    process.exit(0)
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))

  const PORT = CORE_PORTS.FACTORY.get()

  const app = createFactoryApp({
    NETWORK: getCurrentNetwork(),
    TEE_MODE: 'simulated',
    TEE_PLATFORM: 'local',
    TEE_REGION: 'local',
    RPC_URL: getL2RpcUrl(),
    DWS_URL: getCoreAppUrl('DWS_API'),
    GATEWAY_URL: getCoreAppUrl('NODE_EXPLORER_API'),
    INDEXER_URL: getCoreAppUrl('INDEXER_GRAPHQL'),
    SQLIT_NODES: config.sqlitEndpoint,
    SQLIT_DATABASE_ID: config.sqlitDatabaseId,
    SQLIT_PRIVATE_KEY: config.sqlitPrivateKey,
  })

  const host = getLocalhostHost()
  app.listen(PORT, () => {
    console.log(`Factory API Worker running at http://${host}:${PORT}`)
  })
}
