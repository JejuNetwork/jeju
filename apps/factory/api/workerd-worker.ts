/**
 * Factory API Workerd Worker
 *
 * Minimal workerd-compatible worker that uses SQLit HTTP API.
 * This worker is specifically for DWS workerd deployment.
 *
 * @see https://elysiajs.com/integrations/cloudflare-worker
 */

import { cors } from '@elysiajs/cors'
import { getCoreAppUrl, getCurrentNetwork } from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import {
  checkDatabaseHealth,
  createBountyAsync,
  getAgentAsync,
  getBountyAsync,
  getJobAsync,
  getLeaderboardAsync,
  getProjectAsync,
  listAgentsAsync,
  listBountiesAsync,
  listJobsAsync,
  listProjectsAsync,
} from './db/sqlit-client'

/**
 * Worker Environment Types
 */
export interface FactoryEnv {
  NETWORK: 'localnet' | 'testnet' | 'mainnet'
  RPC_URL: string
  DWS_URL: string
  SQLIT_DATABASE_ID: string
}

/**
 * Create the Factory Workerd App
 */
export function createFactoryWorkerdApp(env?: Partial<FactoryEnv>) {
  const network = env?.NETWORK ?? getCurrentNetwork()
  const isDev = network === 'localnet'

  const app = new Elysia({ name: 'factory-workerd' })
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

    // Root health check
    .get('/health', async () => {
      const dbHealth = await checkDatabaseHealth()
      return {
        status: dbHealth.healthy ? 'ok' : 'degraded',
        service: 'factory-api',
        version: '2.0.0',
        network,
        runtime: 'workerd',
        database: dbHealth,
      }
    })

    // ==========================================================================
    // Bounties API
    // ==========================================================================
    .get('/api/bounties', async ({ query }) => {
      const result = await listBountiesAsync({
        status: query.status,
        skill: query.skill,
        creator: query.creator,
        page: query.page ? parseInt(query.page, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      })
      return result
    })

    .get('/api/bounties/:id', async ({ params }) => {
      const bounty = await getBountyAsync(params.id)
      if (!bounty) {
        return { error: 'Bounty not found' }
      }
      return bounty
    })

    .post(
      '/api/bounties',
      async ({ body, headers }) => {
        const creator = headers['x-jeju-address'] ?? '0x0'
        const bounty = await createBountyAsync({
          title: body.title,
          description: body.description,
          reward: body.reward,
          currency: body.currency ?? 'ETH',
          skills: body.skills ?? [],
          deadline: body.deadline ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
          creator,
        })
        return bounty
      },
      {
        body: t.Object({
          title: t.String(),
          description: t.String(),
          reward: t.String(),
          currency: t.Optional(t.String()),
          skills: t.Optional(t.Array(t.String())),
          deadline: t.Optional(t.Number()),
        }),
      },
    )

    // ==========================================================================
    // Jobs API
    // ==========================================================================
    .get('/api/jobs', async ({ query }) => {
      const result = await listJobsAsync({
        type: query.type,
        remote: query.remote === 'true',
        page: query.page ? parseInt(query.page, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      })
      return result
    })

    .get('/api/jobs/:id', async ({ params }) => {
      const job = await getJobAsync(params.id)
      if (!job) {
        return { error: 'Job not found' }
      }
      return job
    })

    // ==========================================================================
    // Projects API
    // ==========================================================================
    .get('/api/projects', async ({ query }) => {
      const result = await listProjectsAsync({
        status: query.status,
        owner: query.owner,
        page: query.page ? parseInt(query.page, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      })
      return result
    })

    .get('/api/projects/:id', async ({ params }) => {
      const project = await getProjectAsync(params.id)
      if (!project) {
        return { error: 'Project not found' }
      }
      return project
    })

    // ==========================================================================
    // Agents API
    // ==========================================================================
    .get('/api/agents', async ({ query }) => {
      const agents = await listAgentsAsync({
        capability: query.capability,
        active: query.active === 'true',
        owner: query.owner,
      })
      return { agents, total: agents.length }
    })

    .get('/api/agents/:agentId', async ({ params }) => {
      const agent = await getAgentAsync(params.agentId)
      if (!agent) {
        return { error: 'Agent not found' }
      }
      return agent
    })

    // ==========================================================================
    // Leaderboard API
    // ==========================================================================
    .get('/api/leaderboard', async ({ query }) => {
      const limit = query.limit ? parseInt(query.limit, 10) : 50
      const leaderboard = await getLeaderboardAsync(limit)
      return { leaderboard, total: leaderboard.length }
    })

    // ==========================================================================
    // A2A Protocol (minimal)
    // ==========================================================================
    .get('/.well-known/agent-card.json', () => ({
      name: 'factory',
      description: 'Developer coordination hub - bounties, jobs, packages',
      version: '2.0.0',
      url: 'https://factory.jejunetwork.org',
      capabilities: ['bounties', 'jobs', 'projects', 'agents'],
      endpoints: {
        a2a: '/a2a',
        mcp: '/mcp',
      },
    }))

    .post('/a2a', async ({ body }) => {
      // Simple A2A endpoint for agent communication
      const request = body as {
        method: string
        params?: Record<string, unknown>
      }

      switch (request.method) {
        case 'factory.listBounties':
          return await listBountiesAsync(request.params as { status?: string })
        case 'factory.listJobs':
          return await listJobsAsync(request.params as { type?: string })
        case 'factory.listProjects':
          return await listProjectsAsync(request.params as { owner?: string })
        case 'factory.listAgents':
          return await listAgentsAsync(request.params as { active?: boolean })
        default:
          return { error: `Unknown method: ${request.method}` }
      }
    })

  return app
}

// Default export for workerd
const app = createFactoryWorkerdApp()

export default {
  fetch: app.fetch,
}
