/**
 * Factory API Worker
 *
 * Developer coordination hub - workerd-compatible API worker.
 * Handles bounties, jobs, git, packages, containers, models, and projects.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import {
  CORE_PORTS,
  getCoreAppUrl,
  getCurrentNetwork,
  getEnvNumber,
  getLocalhostHost,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { a2aRoutes } from './routes/a2a'
import { agentsRoutes } from './routes/agents'
import { bountiesRoutes } from './routes/bounties'
import { ciRoutes } from './routes/ci'
import { containersRoutes } from './routes/containers'
import { datasetsRoutes } from './routes/datasets'
import { discussionsRoutes } from './routes/discussions'
import { farcasterRoutes } from './routes/farcaster'
import { feedRoutes } from './routes/feed'
import { gitRoutes } from './routes/git'
import { healthRoutes } from './routes/health'
import { issuesRoutes } from './routes/issues'
import { jobsRoutes } from './routes/jobs'
import { leaderboardRoutes } from './routes/leaderboard'
import { mcpRoutes } from './routes/mcp'
import { messagesRoutes } from './routes/messages'
import { modelsRoutes } from './routes/models'
import { packageSettingsRoutes } from './routes/package-settings'
import { packagesRoutes } from './routes/packages'
import { projectsRoutes } from './routes/projects'
import { pullsRoutes } from './routes/pulls'
import { repoSettingsRoutes } from './routes/repo-settings'

/**
 * Worker Environment Types
 */
export interface FactoryEnv {
  // Network configuration
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string

  // Service URLs
  DWS_URL: string
  CRUCIBLE_URL: string
  INDEXER_URL: string

  // Database
  SQLIT_NODES: string
  SQLIT_DATABASE_ID: string

  // KV bindings (optional)
  FACTORY_CACHE?: KVNamespace
}

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * Create the Factory Elysia app
 */
export function createFactoryApp(env?: Partial<FactoryEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'

  const app = new Elysia()
    .use(
      cors({
        origin: isDev
          ? true
          : [
              'https://factory.jejunetwork.org',
              'https://jejunetwork.org',
              getCoreAppUrl('FACTORY'),
            ],
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-API-Key',
          'X-Jeju-Address',
          'X-Jeju-Signature',
        ],
        credentials: true,
      }),
    )

    // Root health check for DWS worker runtime
    .get('/health', () => ({
      status: 'ok',
      service: 'factory-api',
      version: '2.0.0',
      network,
      runtime: 'workerd',
    }))

    // API routes
    .group('/api', (api) =>
      api
        .use(healthRoutes)
        .use(bountiesRoutes)
        .use(jobsRoutes)
        .use(agentsRoutes)
        .use(projectsRoutes)
        .use(gitRoutes)
        .use(packagesRoutes)
        .use(packageSettingsRoutes)
        .use(repoSettingsRoutes)
        .use(containersRoutes)
        .use(modelsRoutes)
        .use(datasetsRoutes)
        .use(ciRoutes)
        .use(issuesRoutes)
        .use(pullsRoutes)
        .use(discussionsRoutes)
        .use(feedRoutes)
        .use(messagesRoutes)
        .use(leaderboardRoutes)
        .use(farcasterRoutes),
    )

    // A2A Protocol
    .use(a2aRoutes)

    // MCP Protocol
    .use(mcpRoutes)

  return app
}

/**
 * Default export for workerd
 */
const app = createFactoryApp()

export default {
  fetch: app.fetch,
}

/**
 * Bun server entry point - only runs when executed directly
 * When imported as a module (by DWS bootstrap or test), this won't run
 */
const isMainModule = typeof Bun !== 'undefined' && Bun.main === import.meta.path

if (isMainModule) {
  const port = Number(
    getEnvNumber('PORT') ?? getEnvNumber('FACTORY_PORT') ?? CORE_PORTS.FACTORY.get(),
  )
  const host = getLocalhostHost()

  console.log(`[Factory Worker] Starting on http://${host}:${port}`)
  console.log(`[Factory Worker] Network: ${getCurrentNetwork()}`)

  Bun.serve({
    port,
    hostname: host,
    fetch: app.fetch,
  })
}
