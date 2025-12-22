/**
 * AI Agents Routes
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { crucibleService } from '../services/crucible'
import { requireAuth } from '../validation/access-control'

interface Agent {
  agentId: bigint
  owner: Address
  name: string
  botType: string
  characterCid: string | null
  stateCid: string
  vaultAddress: Address
  active: boolean
  registeredAt: number
  lastExecutedAt: number
  executionCount: number
  capabilities: string[]
  specializations: string[]
  reputation: number
}

export const agentsRoutes = new Elysia({ prefix: '/api/agents' })
  .get(
    '/',
    async ({ query }) => {
      const agents = await crucibleService.getAgents({
        capability: query.q,
        active:
          query.status === 'active'
            ? true
            : query.status === 'inactive'
              ? false
              : undefined,
      })
      return agents
    },
    {
      query: t.Object({
        type: t.Optional(t.String()),
        status: t.Optional(t.String()),
        q: t.Optional(t.String()),
      }),
      detail: {
        tags: ['agents'],
        summary: 'List agents',
        description: 'Get a list of deployed AI agents',
      },
    },
  )
  .post(
    '/',
    async ({ body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      // Mock agent creation - in production would call crucibleService.deployAgent
      const agent: Agent = {
        agentId: BigInt(Date.now()),
        owner: authResult.address,
        name: body.name,
        botType: body.type,
        characterCid: null,
        stateCid: 'ipfs://...',
        vaultAddress: '0x0000000000000000000000000000000000000000' as Address,
        active: true,
        registeredAt: Date.now(),
        lastExecutedAt: 0,
        executionCount: 0,
        capabilities: [],
        specializations: [],
        reputation: 0,
      }

      set.status = 201
      return {
        ...agent,
        agentId: agent.agentId.toString(),
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        type: t.Union([
          t.Literal('ai_agent'),
          t.Literal('trading_bot'),
          t.Literal('org_tool'),
        ]),
        config: t.Record(t.String(), t.Any()),
        modelId: t.Optional(t.String()),
      }),
      detail: {
        tags: ['agents'],
        summary: 'Deploy agent',
        description: 'Deploy a new AI agent',
      },
    },
  )
  .get(
    '/:agentId',
    async ({ params }) => {
      const agent = await crucibleService.getAgent(BigInt(params.agentId))
      if (!agent) {
        return { error: 'Agent not found' }
      }
      return {
        ...agent,
        agentId: agent.agentId.toString(),
      }
    },
    {
      params: t.Object({
        agentId: t.String(),
      }),
      detail: {
        tags: ['agents'],
        summary: 'Get agent',
        description: 'Get details of a specific agent',
      },
    },
  )
