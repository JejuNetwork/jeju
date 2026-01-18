import { getContract } from '@jejunetwork/config'
import { expectValid } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import { A2AJsonRpcResponseSchema } from '../../lib'
import { createAutocratA2AServer } from '../a2a-server'
import { type ERC8004Config, getERC8004Client } from '../erc8004'
import { autocratConfig, blockchain, config } from '../shared-state'

// Helper to safely get contract addresses
const getValidationRegistryAddr = () => {
  try {
    return getContract('registry', 'validation')
  } catch {
    return '0x0000000000000000000000000000000000000000'
  }
}

const erc8004Config: ERC8004Config = {
  rpcUrl: config.rpcUrl,
  identityRegistry: config.contracts.identityRegistry,
  reputationRegistry: config.contracts.reputationRegistry,
  validationRegistry: getValidationRegistryAddr(),
  operatorKey: autocratConfig.operatorKey ?? autocratConfig.privateKey,
}
const erc8004 = getERC8004Client(erc8004Config)

export const agentsRoutes = new Elysia({ prefix: '/api/v1/agents' })
  .get(
    '/',
    async () => {
      try {
        const count = await erc8004.getTotalAgents()
        return {
          total: count,
          endpoints: {
            count: 'GET /api/v1/agents/count',
            getById: 'GET /api/v1/agents/:id',
            register: 'POST /api/v1/agents/register',
            feedback: 'POST /api/v1/agents/:id/feedback',
            director: 'GET /api/v1/agents/director',
            board: 'GET /api/v1/agents/board',
          },
        }
      } catch (error) {
        console.warn(
          '[Agents] Error getting agent count:',
          error instanceof Error ? error.message : String(error),
        )
        return {
          total: 0,
          endpoints: {
            count: 'GET /api/v1/agents/count',
            getById: 'GET /api/v1/agents/:id',
            register: 'POST /api/v1/agents/register',
            feedback: 'POST /api/v1/agents/:id/feedback',
            director: 'GET /api/v1/agents/director',
            board: 'GET /api/v1/agents/board',
          },
          message: 'Agent registry not available',
        }
      }
    },
    {
      detail: {
        tags: ['agents'],
        summary: 'List agent endpoints and total count',
      },
    },
  )
  .get(
    '/count',
    async ({ set }) => {
      try {
        const count = await erc8004.getTotalAgents()
        return { count }
      } catch (error) {
        console.warn(
          '[Agents] Error getting count:',
          error instanceof Error ? error.message : String(error),
        )
        set.status = 200
        return { count: 0, message: 'Agent registry not available' }
      }
    },
    {
      detail: { tags: ['agents'], summary: 'Get total agent count' },
    },
  )
  .post(
    '/register',
    async ({ body }) => {
      const agentId = await erc8004.registerAgent(
        body.name,
        body.role,
        body.a2aEndpoint ?? '',
        body.mcpEndpoint ?? '',
      )
      if (agentId <= 0n) throw new Error('Agent registration failed')
      return { agentId: agentId.toString(), registered: true }
    },
    {
      body: t.Object({
        name: t.String(),
        role: t.String(),
        a2aEndpoint: t.Optional(t.String()),
        mcpEndpoint: t.Optional(t.String()),
      }),
      detail: { tags: ['agents'], summary: 'Register new agent' },
    },
  )
  .post(
    '/:id/feedback',
    async ({ params, body }) => {
      const agentId = BigInt(params.id)
      const txHash = await erc8004.submitFeedback(
        agentId,
        body.score,
        body.tag,
        body.details,
      )
      return { success: true, txHash }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        score: t.Number(),
        tag: t.String(),
        details: t.String(),
      }),
      detail: { tags: ['agents'], summary: 'Submit feedback for agent' },
    },
  )
  // Director endpoints
  .get(
    '/director',
    async ({ set }) => {
      try {
        // Get Director status via internal call
        const a2aServer = createAutocratA2AServer(config, blockchain)
        const response = await a2aServer.getRouter().fetch(
          new Request('http://localhost/a2a', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'message/send',
              params: {
                message: {
                  messageId: `rest-${Date.now()}`,
                  parts: [
                    { kind: 'data', data: { skillId: 'get-director-status' } },
                  ],
                },
              },
            }),
          }),
        )
        const result = expectValid(
          A2AJsonRpcResponseSchema,
          await response.json(),
          'Director status A2A response',
        )
        return result
      } catch (error) {
        console.warn(
          '[Agents] Error getting Director status:',
          error instanceof Error ? error.message : String(error),
        )
        set.status = 200
        return {
          status: 'unavailable',
          message:
            'Director status not available - contracts may not be deployed',
        }
      }
    },
    {
      detail: { tags: ['agents'], summary: 'Get Director status' },
    },
  )
  .get(
    '/director/models',
    async () => {
      const models = await blockchain.getModelCandidates()
      return { models }
    },
    {
      detail: { tags: ['agents'], summary: 'Get Director model candidates' },
    },
  )
  .get(
    '/director/decisions',
    async ({ query }) => {
      const limit = parseInt(query.limit ?? '10', 10)
      const decisions = await blockchain.getRecentDecisions(limit)
      return { decisions }
    },
    {
      query: t.Object({ limit: t.Optional(t.String()) }),
      detail: { tags: ['agents'], summary: 'Get recent Director decisions' },
    },
  )
  .get(
    '/board',
    async ({ set }) => {
      try {
        // Get board/board members via A2A internal call
        const a2aServer = createAutocratA2AServer(config, blockchain)
        const response = await a2aServer.getRouter().fetch(
          new Request('http://localhost/a2a', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'message/send',
              params: {
                message: {
                  messageId: `rest-${Date.now()}`,
                  parts: [
                    { kind: 'data', data: { skillId: 'get-board-status' } },
                  ],
                },
              },
            }),
          }),
        )
        const result = expectValid(
          A2AJsonRpcResponseSchema,
          await response.json(),
          'Board status A2A response',
        )
        return result
      } catch (error) {
        console.warn(
          '[Agents] Error getting board status:',
          error instanceof Error ? error.message : String(error),
        )
        set.status = 200
        return {
          members: [],
          message: 'Board not available - contracts may not be deployed',
        }
      }
    },
    {
      detail: { tags: ['agents'], summary: 'Get board/board members' },
    },
  )
  // Get agent by ID - must be after specific routes like /director, /board
  .get(
    '/:id',
    async ({ params, set }) => {
      try {
        const agentId = BigInt(params.id)
        const identity = await erc8004.getAgentIdentity(agentId)
        if (!identity) {
          set.status = 404
          return { error: 'Agent not found', agentId: params.id }
        }
        const reputation = await erc8004.getAgentReputation(agentId)
        const validation = await erc8004.getValidationSummary(agentId)
        return { ...identity, reputation, validation }
      } catch (error) {
        set.status = 404
        return {
          error: 'Agent not found or registry unavailable',
          agentId: params.id,
          details: error instanceof Error ? error.message : String(error),
        }
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['agents'], summary: 'Get agent by ID' },
    },
  )
  .post(
    '/director/nominate',
    async ({ body }) => {
      // When contract is deployed, this would call the contract
      // For now, return success with the nominated model info
      const { modelId, modelName, provider, benchmarkScore } = body
      return {
        success: true,
        nominated: {
          modelId,
          modelName,
          provider,
          benchmarkScore: benchmarkScore ?? 0,
          totalStaked: '0',
          totalReputation: '0',
          decisionsCount: 0,
          isActive: false,
          nominatedAt: Date.now(),
        },
        message: `Model ${modelName} nominated for Director election`,
      }
    },
    {
      body: t.Object({
        modelId: t.String(),
        modelName: t.String(),
        provider: t.String(),
        benchmarkScore: t.Optional(t.Number()),
      }),
      detail: {
        tags: ['agents'],
        summary: 'Nominate a model for Director election',
      },
    },
  )
