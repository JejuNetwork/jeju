/** Agents Routes */

import { getServiceUrl } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import {
  AgentIdParamSchema,
  AgentsQuerySchema,
  CreateAgentBodySchema,
  expectValid,
  UpdateAgentBodySchema,
} from '../schemas'
import { crucibleService } from '../services/crucible'
import { requireAuth } from '../validation/access-control'

export interface Agent {
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
    { detail: { tags: ['agents'], summary: 'List agents' } },
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

      // Call Crucible API to actually register the agent
      const crucibleUrl = process.env.CRUCIBLE_URL || getServiceUrl('compute', 'nodeApi') || 'http://localhost:4020'
      const response = await fetch(
        `${crucibleUrl}/api/v1/agents`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': authResult.address,
          },
          body: JSON.stringify({
            name: validated.name,
            type: validated.type,
            capabilities: validated.capabilities ?? [],
          }),
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        set.status = response.status
        return { error: { code: 'AGENT_CREATION_FAILED', message: errorText } }
      }

      const data: unknown = await response.json()
      const agent = data as Agent

      set.status = 201
      return { ...agent, agentId: agent.agentId.toString() }
    },
    { detail: { tags: ['agents'], summary: 'Deploy agent' } },
  )
  .get(
    '/:agentId',
    async ({ params }) => {
      const validated = expectValid(AgentIdParamSchema, params, 'params')
      const agent = await crucibleService.getAgent(BigInt(validated.agentId))
      if (!agent) return { error: 'Agent not found' }
      return { ...agent, agentId: agent.agentId.toString() }
    },
    { detail: { tags: ['agents'], summary: 'Get agent' } },
  )
  .patch(
    '/:agentId',
    async ({ params, body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const validatedParams = expectValid(AgentIdParamSchema, params, 'params')
      const updates = expectValid(UpdateAgentBodySchema, body, 'request body')
      const agent = await crucibleService.getAgent(
        BigInt(validatedParams.agentId),
      )
      if (!agent) {
        set.status = 404
        return { error: 'Agent not found' }
      }
      return {
        ...agent,
        ...updates,
        agentId: agent.agentId.toString(),
        updatedAt: Date.now(),
      }
    },
    { detail: { tags: ['agents'], summary: 'Update agent' } },
  )
  .delete(
    '/:agentId',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const validated = expectValid(AgentIdParamSchema, params, 'params')
      return { success: true, agentId: validated.agentId }
    },
    { detail: { tags: ['agents'], summary: 'Deregister agent' } },
  )
