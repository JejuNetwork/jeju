/**
 * Agent API Routes
 * First-class agent management in DWS
 */

import { Hono } from 'hono'
import type { Address } from 'viem'
import { getExecutor } from './executor'
import * as registry from './registry'
import type {
  AgentMessage,
  ChatRequest,
  RegisterAgentRequest,
  UpdateAgentRequest,
} from './types'

export function createAgentRouter(): Hono {
  const router = new Hono()

  // ============================================================================
  // Health & Info
  // ============================================================================

  router.get('/health', (c) => {
    const registryStats = registry.getRegistryStats()
    const executorStats = getExecutor().getStats()

    return c.json({
      status: 'healthy',
      service: 'dws-agents',
      registry: registryStats,
      executor: executorStats,
    })
  })

  // ============================================================================
  // Agent CRUD
  // ============================================================================

  // Register new agent
  router.post('/', async (c) => {
    const owner = c.req.header('x-jeju-address') as Address
    if (!owner) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401)
    }

    const body = await c.req.json<RegisterAgentRequest>()

    if (!body.character?.name || !body.character?.system) {
      return c.json({ error: 'Character name and system prompt required' }, 400)
    }

    const agent = await registry.registerAgent(owner, body)

    // Deploy immediately
    try {
      await getExecutor().deployAgent(agent.id)
    } catch (e) {
      console.error('[AgentRoutes] Failed to deploy agent:', e)
      await registry.updateAgentStatus(agent.id, 'error')
    }

    return c.json(
      {
        id: agent.id,
        name: agent.character.name,
        status: agent.status,
        createdAt: agent.createdAt,
      },
      201,
    )
  })

  // List agents
  router.get('/', (c) => {
    const owner = c.req.header('x-jeju-address') as Address | undefined
    const status = c.req.query('status') as string | undefined

    const agents = registry.listAgents({
      owner,
      status: status as (typeof agents)[number]['status'] | undefined,
    })

    return c.json({
      agents: agents.map((a) => ({
        id: a.id,
        name: a.character.name,
        owner: a.owner,
        status: a.status,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
    })
  })

  // Get agent details
  router.get('/:id', (c) => {
    const agent = registry.getAgent(c.req.param('id'))
    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const instances = getExecutor().getAgentInstances(agent.id)
    const stats = registry.getAgentStats(agent.id)

    return c.json({
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
    })
  })

  // Update agent
  router.put('/:id', async (c) => {
    const owner = c.req.header('x-jeju-address') as Address
    if (!owner) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401)
    }

    const body = await c.req.json<UpdateAgentRequest>()

    try {
      const agent = await registry.updateAgent(c.req.param('id'), owner, body)
      if (!agent) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      return c.json({
        id: agent.id,
        name: agent.character.name,
        status: agent.status,
        updatedAt: agent.updatedAt,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Update failed'
      return c.json({ error: message }, 403)
    }
  })

  // Terminate agent
  router.delete('/:id', async (c) => {
    const owner = c.req.header('x-jeju-address') as Address
    if (!owner) {
      return c.json({ error: 'Missing x-jeju-address header' }, 401)
    }

    try {
      // Undeploy first
      await getExecutor().undeployAgent(c.req.param('id'))

      const success = await registry.terminateAgent(c.req.param('id'), owner)
      if (!success) {
        return c.json({ error: 'Agent not found' }, 404)
      }

      return c.json({ success: true })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Termination failed'
      return c.json({ error: message }, 403)
    }
  })

  // ============================================================================
  // Agent Chat
  // ============================================================================

  router.post('/:id/chat', async (c) => {
    const agentId = c.req.param('id')
    const body = await c.req.json<ChatRequest>()

    if (!body.text) {
      return c.json({ error: 'Missing text field' }, 400)
    }

    const message: AgentMessage = {
      id: crypto.randomUUID(),
      userId: body.userId ?? 'anonymous',
      roomId: body.roomId ?? 'default',
      content: {
        text: body.text,
        source: body.source ?? 'api',
      },
      createdAt: Date.now(),
    }

    try {
      const response = await getExecutor().invokeAgent(agentId, message)

      return c.json({
        id: response.id,
        text: response.text,
        actions: response.actions,
        metadata: response.metadata,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Chat failed'
      return c.json({ error: message }, 500)
    }
  })

  // ============================================================================
  // Agent Control
  // ============================================================================

  // Pause agent
  router.post('/:id/pause', async (c) => {
    const owner = c.req.header('x-jeju-address') as Address
    const agent = registry.getAgent(c.req.param('id'))

    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }
    if (agent.owner.toLowerCase() !== owner?.toLowerCase()) {
      return c.json({ error: 'Not authorized' }, 403)
    }

    await registry.updateAgentStatus(agent.id, 'paused')
    return c.json({ status: 'paused' })
  })

  // Resume agent
  router.post('/:id/resume', async (c) => {
    const owner = c.req.header('x-jeju-address') as Address
    const agent = registry.getAgent(c.req.param('id'))

    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }
    if (agent.owner.toLowerCase() !== owner?.toLowerCase()) {
      return c.json({ error: 'Not authorized' }, 403)
    }

    await registry.updateAgentStatus(agent.id, 'active')
    return c.json({ status: 'active' })
  })

  // Deploy/redeploy agent
  router.post('/:id/deploy', async (c) => {
    const owner = c.req.header('x-jeju-address') as Address
    const agent = registry.getAgent(c.req.param('id'))

    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }
    if (agent.owner.toLowerCase() !== owner?.toLowerCase()) {
      return c.json({ error: 'Not authorized' }, 403)
    }

    try {
      await getExecutor().deployAgent(agent.id)
      return c.json({ status: 'deployed' })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Deployment failed'
      return c.json({ error: message }, 500)
    }
  })

  // ============================================================================
  // Cron Triggers
  // ============================================================================

  // List cron triggers
  router.get('/:id/cron', (c) => {
    const triggers = registry.getCronTriggers(c.req.param('id'))
    return c.json({ triggers })
  })

  // Add cron trigger
  router.post('/:id/cron', async (c) => {
    const owner = c.req.header('x-jeju-address') as Address
    const agent = registry.getAgent(c.req.param('id'))

    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }
    if (agent.owner.toLowerCase() !== owner?.toLowerCase()) {
      return c.json({ error: 'Not authorized' }, 403)
    }

    const body = await c.req.json<{
      schedule: string
      action?: 'think' | 'post' | 'check' | 'custom'
      payload?: Record<string, unknown>
    }>()

    if (!body.schedule) {
      return c.json({ error: 'Schedule required' }, 400)
    }

    const trigger = await registry.addCronTrigger(
      agent.id,
      body.schedule,
      body.action ?? 'think',
      body.payload,
    )

    return c.json(trigger, 201)
  })

  // ============================================================================
  // Memories
  // ============================================================================

  router.get('/:id/memories', async (c) => {
    const agentId = c.req.param('id')
    const agent = registry.getAgent(agentId)

    if (!agent) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    // TODO: Query CQL for memories
    return c.json({
      memories: [],
      message: 'Memory retrieval not yet implemented',
    })
  })

  // ============================================================================
  // Stats
  // ============================================================================

  router.get('/:id/stats', (c) => {
    const stats = registry.getAgentStats(c.req.param('id'))
    if (!stats) {
      return c.json({ error: 'Agent not found' }, 404)
    }

    const instances = getExecutor().getAgentInstances(c.req.param('id'))
    stats.activeInstances = instances.filter(
      (i) => i.status === 'ready' || i.status === 'busy',
    ).length

    return c.json(stats)
  })

  return router
}
