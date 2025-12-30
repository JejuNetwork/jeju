/**
 * Agent API Routes
 * First-class agent management in DWS
 */

import { Elysia, t } from 'elysia'
import { isAddress } from 'viem'
import {
  type CronAction,
  getAddressFromRequest,
  isAgentStatus,
  isCronAction,
  isRegisterAgentRequest,
  isUpdateAgentRequest,
} from '../shared/utils/type-guards'
import { getExecutor } from './executor'
import * as registry from './registry'
import type { AgentMessage } from './types'

export function createAgentRouter() {
  return (
    new Elysia({ name: 'agents', prefix: '/agents' })
      // Health & Info
      .get('/health', () => {
        const registryStats = registry.getRegistryStats()
        const executorStats = getExecutor().getStats()

        return {
          status: 'healthy',
          service: 'dws-agents',
          registry: registryStats,
          executor: executorStats,
        }
      })

      // Agent CRUD

      // Register new agent
      .post(
        '/',
        async ({ body, request, set }) => {
          const owner = getAddressFromRequest(request)
          if (!owner) {
            set.status = 401
            return { error: 'Missing or invalid x-jeju-address header' }
          }

          if (!isRegisterAgentRequest(body)) {
            set.status = 400
            return { error: 'Character name and system prompt required' }
          }

          // Safe to use body after validation
          const agent = await registry.registerAgent(owner, body)

          // Deploy immediately
          try {
            await getExecutor().deployAgent(agent.id)
          } catch (e) {
            console.error('[AgentRoutes] Failed to deploy agent:', e)
            await registry.updateAgentStatus(agent.id, 'error')
          }

          set.status = 201
          return {
            id: agent.id,
            name: agent.character.name,
            status: agent.status,
            createdAt: agent.createdAt,
          }
        },
        {
          body: t.Object({
            character: t.Object({
              name: t.String(),
              system: t.String(),
              bio: t.Optional(t.Array(t.String())),
            }),
            runtime: t.Optional(
              t.Object({
                keepWarm: t.Optional(t.Boolean()),
                maxMemoryMb: t.Optional(t.Number()),
                timeoutMs: t.Optional(t.Number()),
                cronSchedule: t.Optional(t.String()),
                plugins: t.Optional(t.Array(t.String())),
              }),
            ),
            models: t.Optional(
              t.Object({
                chat: t.Optional(t.String()),
                embedding: t.Optional(t.String()),
              }),
            ),
            metadata: t.Optional(t.Record(t.String(), t.String())),
          }),
        },
      )

      // List agents
      .get('/', async ({ request, query }) => {
        const ownerHeader = request.headers.get('x-jeju-address')
        const owner =
          ownerHeader && isAddress(ownerHeader) ? ownerHeader : undefined
        const statusQuery = query.status

        // Validate status if provided
        const status = isAgentStatus(statusQuery) ? statusQuery : undefined

        const agents = await registry.listAgents({
          owner,
          status,
        })

        return {
          agents: agents.map((a) => ({
            id: a.id,
            name: a.character.name,
            owner: a.owner,
            status: a.status,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
          })),
        }
      })

      // Get agent details
      .get('/:id', async ({ params, set }) => {
        const agent = await registry.getAgent(params.id)
        if (!agent) {
          set.status = 404
          return { error: 'Agent not found' }
        }

        const instances = getExecutor().getAgentInstances(agent.id)
        const stats = await registry.getAgentStats(agent.id)

        return {
          ...agent,
          instances: instances.map((i) => ({
            instanceId: i.instanceId,
            status: i.status,
            activeInvocations: i.activeInvocations,
            totalInvocations: i.totalInvocations,
            startedAt: i.startedAt,
            lastActivityAt: i.lastActivityAt,
          })),
          stats,
        }
      })

      // Update agent
      .put(
        '/:id',
        async ({ params, body, request, set }) => {
          const owner = getAddressFromRequest(request)
          if (!owner) {
            set.status = 401
            return { error: 'Missing or invalid x-jeju-address header' }
          }

          if (!isUpdateAgentRequest(body)) {
            set.status = 400
            return { error: 'Invalid request body' }
          }

          try {
            const agent = await registry.updateAgent(params.id, owner, body)
            if (!agent) {
              set.status = 404
              return { error: 'Agent not found' }
            }

            return {
              id: agent.id,
              name: agent.character.name,
              status: agent.status,
              updatedAt: agent.updatedAt,
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Update failed'
            set.status = 403
            return { error: message }
          }
        },
        {
          body: t.Object({
            character: t.Optional(
              t.Object({
                name: t.Optional(t.String()),
                system: t.Optional(t.String()),
                bio: t.Optional(t.Array(t.String())),
              }),
            ),
            runtime: t.Optional(
              t.Object({
                keepWarm: t.Optional(t.Boolean()),
                maxMemoryMb: t.Optional(t.Number()),
                timeoutMs: t.Optional(t.Number()),
                cronSchedule: t.Optional(t.String()),
                plugins: t.Optional(t.Array(t.String())),
              }),
            ),
            metadata: t.Optional(t.Record(t.String(), t.String())),
          }),
        },
      )

      // Terminate agent
      .delete('/:id', async ({ params, request, set }) => {
        const owner = getAddressFromRequest(request)
        if (!owner) {
          set.status = 401
          return { error: 'Missing or invalid x-jeju-address header' }
        }

        try {
          // Undeploy first
          await getExecutor().undeployAgent(params.id)

          const success = await registry.terminateAgent(params.id, owner)
          if (!success) {
            set.status = 404
            return { error: 'Agent not found' }
          }

          return { success: true }
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Termination failed'
          set.status = 403
          return { error: message }
        }
      })

      // Agent Chat

      .post(
        '/:id/chat',
        async ({ params, body, set }) => {
          const agentId = params.id
          // body is already validated by Elysia schema
          const { text, userId, roomId, source } = body

          const message: AgentMessage = {
            id: crypto.randomUUID(),
            userId: userId ?? 'anonymous',
            roomId: roomId ?? 'default',
            content: {
              text,
              source: source ?? 'api',
            },
            createdAt: Date.now(),
          }

          try {
            const response = await getExecutor().invokeAgent(agentId, message)

            return {
              id: response.id,
              text: response.text,
              actions: response.actions,
              metadata: response.metadata,
            }
          } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'Chat failed'
            set.status = 500
            return { error: errorMessage }
          }
        },
        {
          body: t.Object({
            text: t.String(),
            userId: t.Optional(t.String()),
            roomId: t.Optional(t.String()),
            source: t.Optional(t.String()),
          }),
        },
      )

      // Agent Control

      // Pause agent
      .post('/:id/pause', async ({ params, request, set }) => {
        const owner = getAddressFromRequest(request)
        if (!owner) {
          set.status = 401
          return { error: 'Missing or invalid x-jeju-address header' }
        }

        const agent = await registry.getAgent(params.id)
        if (!agent) {
          set.status = 404
          return { error: 'Agent not found' }
        }
        if (agent.owner.toLowerCase() !== owner.toLowerCase()) {
          set.status = 403
          return { error: 'Not authorized' }
        }

        await registry.updateAgentStatus(agent.id, 'paused')
        return { status: 'paused' }
      })

      // Resume agent
      .post('/:id/resume', async ({ params, request, set }) => {
        const owner = getAddressFromRequest(request)
        if (!owner) {
          set.status = 401
          return { error: 'Missing or invalid x-jeju-address header' }
        }

        const agent = await registry.getAgent(params.id)
        if (!agent) {
          set.status = 404
          return { error: 'Agent not found' }
        }
        if (agent.owner.toLowerCase() !== owner.toLowerCase()) {
          set.status = 403
          return { error: 'Not authorized' }
        }

        await registry.updateAgentStatus(agent.id, 'active')
        return { status: 'active' }
      })

      // Deploy/redeploy agent
      .post('/:id/deploy', async ({ params, request, set }) => {
        const owner = getAddressFromRequest(request)
        if (!owner) {
          set.status = 401
          return { error: 'Missing or invalid x-jeju-address header' }
        }

        const agent = await registry.getAgent(params.id)
        if (!agent) {
          set.status = 404
          return { error: 'Agent not found' }
        }
        if (agent.owner.toLowerCase() !== owner.toLowerCase()) {
          set.status = 403
          return { error: 'Not authorized' }
        }

        try {
          await getExecutor().deployAgent(agent.id)
          return { status: 'deployed' }
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Deployment failed'
          set.status = 500
          return { error: message }
        }
      })

      // Cron Triggers

      // List cron triggers
      .get('/:id/cron', async ({ params }) => {
        const triggers = await registry.getCronTriggers(params.id)
        return { triggers }
      })

      // Add cron trigger
      .post(
        '/:id/cron',
        async ({ params, body, request, set }) => {
          const owner = getAddressFromRequest(request)
          if (!owner) {
            set.status = 401
            return { error: 'Missing or invalid x-jeju-address header' }
          }

          const agent = await registry.getAgent(params.id)
          if (!agent) {
            set.status = 404
            return { error: 'Agent not found' }
          }
          if (agent.owner.toLowerCase() !== owner.toLowerCase()) {
            set.status = 403
            return { error: 'Not authorized' }
          }

          // body is already validated by Elysia schema
          const { schedule, action, payload } = body
          const cronAction: CronAction = isCronAction(action) ? action : 'think'

          const trigger = await registry.addCronTrigger(
            agent.id,
            schedule,
            cronAction,
            payload,
          )

          set.status = 201
          return trigger
        },
        {
          body: t.Object({
            schedule: t.String(),
            action: t.Optional(
              t.Union([
                t.Literal('think'),
                t.Literal('post'),
                t.Literal('check'),
                t.Literal('custom'),
              ]),
            ),
            payload: t.Optional(t.Record(t.String(), t.Unknown())),
          }),
        },
      )

      // Memories

      .get('/:id/memories', async ({ params, set }) => {
        const agentId = params.id
        const agent = registry.getAgent(agentId)

        if (!agent) {
          set.status = 404
          return { error: 'Agent not found' }
        }

        // Memory retrieval requires SQLit integration - returns empty until agent has stored memories
        return {
          memories: [],
          count: 0,
        }
      })

      // Stats

      .get('/:id/stats', async ({ params, set }) => {
        const stats = await registry.getAgentStats(params.id)
        if (!stats) {
          set.status = 404
          return { error: 'Agent not found' }
        }

        const instances = getExecutor().getAgentInstances(params.id)
        stats.activeInstances = instances.filter(
          (i) => i.status === 'ready' || i.status === 'busy',
        ).length

        return stats
      })
  )
}
