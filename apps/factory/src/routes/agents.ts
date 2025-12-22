/**
 * AI Agents Routes
 */

import { Elysia } from 'elysia'
import type { Address } from 'viem'
import {
  AgentIdParamSchema,
  AgentsQuerySchema,
  CreateAgentBodySchema,
  expectValid,
} from '../schemas'
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
      const validated = expectValid(AgentsQuerySchema, query, 'query params')
      const agents = await crucibleService.getAgents({
        capability: validated.q,
        active:
          validated.status === 'active'
            ? true
            : validated.status === 'inactive'
              ? false
              : undefined,
      })
      return agents.map((agent) => ({
        ...agent,
        agentId: agent.agentId.toString(),
      }))
    },
    {
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

      const validated = expectValid(CreateAgentBodySchema, body, 'request body')

      const agent: Agent = {
        agentId: BigInt(Date.now()),
        owner: authResult.address,
        name: validated.name,
        botType: validated.type,
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
      const validated = expectValid(AgentIdParamSchema, params, 'params')
      const agent = await crucibleService.getAgent(BigInt(validated.agentId))
      if (!agent) {
        return { error: 'Agent not found' }
      }
      return {
        ...agent,
        agentId: agent.agentId.toString(),
      }
    },
    {
      detail: {
        tags: ['agents'],
        summary: 'Get agent',
        description: 'Get details of a specific agent',
      },
    },
  )
