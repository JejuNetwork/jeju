/**
 * ERC-8004 Agent Registry Routes
 */

import { Elysia, t } from 'elysia'
import { createAutocratA2AServer } from '../a2a-server'
import { type ERC8004Config, getERC8004Client } from '../erc8004'
import { A2AJsonRpcResponseSchema, expectValid } from '../schemas'
import { blockchain, config } from '../shared-state'

const erc8004Config: ERC8004Config = {
  rpcUrl: config.rpcUrl,
  identityRegistry: config.contracts.identityRegistry as string,
  reputationRegistry: config.contracts.reputationRegistry as string,
  validationRegistry:
    process.env.VALIDATION_REGISTRY_ADDRESS ??
    '0x0000000000000000000000000000000000000000',
  operatorKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
}
const erc8004 = getERC8004Client(erc8004Config)

export const agentsRoutes = new Elysia({ prefix: '/api/v1/agents' })
  .get(
    '/count',
    async () => {
      const count = await erc8004.getTotalAgents()
      return { count }
    },
    {
      detail: { tags: ['agents'], summary: 'Get total agent count' },
    },
  )
  .get(
    '/:id',
    async ({ params }) => {
      const agentId = BigInt(params.id)
      const identity = await erc8004.getAgentIdentity(agentId)
      if (!identity) throw new Error('Agent not found')
      const reputation = await erc8004.getAgentReputation(agentId)
      const validation = await erc8004.getValidationSummary(agentId)
      return { ...identity, reputation, validation }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['agents'], summary: 'Get agent by ID' },
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
  // CEO endpoints
  .get(
    '/ceo',
    async () => {
      // Get CEO status via internal call
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
                parts: [{ kind: 'data', data: { skillId: 'get-ceo-status' } }],
              },
            },
          }),
        }),
      )
      const result = expectValid(
        A2AJsonRpcResponseSchema,
        await response.json(),
        'CEO status A2A response',
      )
      return result
    },
    {
      detail: { tags: ['agents'], summary: 'Get CEO status' },
    },
  )
  .get(
    '/ceo/models',
    async () => {
      const models = await blockchain.getModelCandidates()
      return { models }
    },
    {
      detail: { tags: ['agents'], summary: 'Get CEO model candidates' },
    },
  )
  .get(
    '/ceo/decisions',
    async ({ query }) => {
      const limit = parseInt(query.limit ?? '10', 10)
      const decisions = await blockchain.getRecentDecisions(limit)
      return { decisions }
    },
    {
      query: t.Object({ limit: t.Optional(t.String()) }),
      detail: { tags: ['agents'], summary: 'Get recent CEO decisions' },
    },
  )
