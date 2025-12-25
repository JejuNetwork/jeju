/**
 * Registry Integration Routes - Deep AI DAO integration
 */

import { Elysia, t } from 'elysia'
import { toAddress } from '../../lib'
import {
  getRegistryIntegrationClient,
  type RegistryIntegrationConfig,
} from '../registry-integration'
import { config } from '../shared-state'

const registryConfig: RegistryIntegrationConfig = {
  rpcUrl: config.rpcUrl,
  integrationContract: process.env.REGISTRY_INTEGRATION_ADDRESS,
  identityRegistry: config.contracts.identityRegistry as string,
  reputationRegistry: config.contracts.reputationRegistry as string,
  delegationRegistry: process.env.DELEGATION_REGISTRY_ADDRESS,
}
const registryIntegration = getRegistryIntegrationClient(registryConfig)

export const registryRoutes = new Elysia({ prefix: '/api/v1/registry' })
  .get(
    '/profile/:agentId',
    async ({ params }) => {
      const agentId = BigInt(params.agentId)
      const profile = await registryIntegration.getAgentProfile(agentId)
      if (!profile) throw new Error('Agent not found')
      return {
        ...profile,
        agentId: profile.agentId.toString(),
        stakedAmount: profile.stakedAmount.toString(),
      }
    },
    {
      params: t.Object({ agentId: t.String() }),
      detail: { tags: ['registry'], summary: 'Get agent profile' },
    },
  )
  .post(
    '/profiles',
    async ({ body }) => {
      const profiles = await registryIntegration.getAgentProfiles(
        body.agentIds.map((id) => BigInt(id)),
      )
      return {
        profiles: profiles.map((p) => ({
          ...p,
          agentId: p.agentId.toString(),
          stakedAmount: p.stakedAmount.toString(),
        })),
      }
    },
    {
      body: t.Object({ agentIds: t.Array(t.String()) }),
      detail: { tags: ['registry'], summary: 'Get multiple agent profiles' },
    },
  )
  .get(
    '/voting-power/:address',
    async ({ params, query }) => {
      const agentId = query.agentId ? BigInt(query.agentId) : 0n
      const baseVotes = query.baseVotes
        ? BigInt(query.baseVotes)
        : BigInt('1000000000000000000')
      const power = await registryIntegration.getVotingPower(
        toAddress(params.address),
        agentId,
        baseVotes,
      )
      return {
        ...power,
        baseVotes: power.baseVotes.toString(),
        effectiveVotes: power.effectiveVotes.toString(),
      }
    },
    {
      params: t.Object({ address: t.String() }),
      query: t.Object({
        agentId: t.Optional(t.String()),
        baseVotes: t.Optional(t.String()),
      }),
      detail: { tags: ['registry'], summary: 'Get voting power for address' },
    },
  )
  .get(
    '/search/tag/:tag',
    async ({ params, query }) => {
      const offset = parseInt(query.offset ?? '0', 10)
      const limit = parseInt(query.limit ?? '50', 10)
      const result = await registryIntegration.searchByTag(
        params.tag,
        offset,
        limit,
      )
      return {
        ...result,
        agentIds: result.agentIds.map((id) => id.toString()),
      }
    },
    {
      params: t.Object({ tag: t.String() }),
      query: t.Object({
        offset: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { tags: ['registry'], summary: 'Search agents by tag' },
    },
  )
  .get(
    '/search/score',
    async ({ query }) => {
      const minScore = parseInt(query.minScore ?? '50', 10)
      const offset = parseInt(query.offset ?? '0', 10)
      const limit = parseInt(query.limit ?? '50', 10)
      const result = await registryIntegration.getAgentsByScore(
        minScore,
        offset,
        limit,
      )
      return {
        agentIds: result.agentIds.map((id) => id.toString()),
        scores: result.scores,
      }
    },
    {
      query: t.Object({
        minScore: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { tags: ['registry'], summary: 'Get agents by minimum score' },
    },
  )
  .get(
    '/top-agents',
    async ({ query }) => {
      const count = parseInt(query.count ?? '10', 10)
      const profiles = await registryIntegration.getTopAgents(count)
      return {
        agents: profiles.map((p) => ({
          ...p,
          agentId: p.agentId.toString(),
          stakedAmount: p.stakedAmount.toString(),
        })),
      }
    },
    {
      query: t.Object({ count: t.Optional(t.String()) }),
      detail: { tags: ['registry'], summary: 'Get top agents' },
    },
  )
  .get(
    '/active-agents',
    async ({ query }) => {
      const offset = parseInt(query.offset ?? '0', 10)
      const limit = parseInt(query.limit ?? '100', 10)
      const agentIds = await registryIntegration.getActiveAgents(offset, limit)
      return {
        agentIds: agentIds.map((id) => id.toString()),
        total: await registryIntegration.getTotalAgents(),
        offset,
        limit,
      }
    },
    {
      query: t.Object({
        offset: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { tags: ['registry'], summary: 'Get active agents' },
    },
  )
  .get(
    '/providers',
    async () => {
      const providers = await registryIntegration.getAllProviderReputations()
      return {
        providers: providers.map((p) => ({
          ...p,
          providerAgentId: p.providerAgentId.toString(),
          stakeAmount: p.stakeAmount.toString(),
        })),
      }
    },
    {
      detail: { tags: ['registry'], summary: 'Get all provider reputations' },
    },
  )
  .get(
    '/weighted-reputation/:agentId',
    async ({ params }) => {
      const agentId = BigInt(params.agentId)
      const result =
        await registryIntegration.getWeightedAgentReputation(agentId)
      return result
    },
    {
      params: t.Object({ agentId: t.String() }),
      detail: { tags: ['registry'], summary: 'Get weighted reputation' },
    },
  )
  .get(
    '/eligibility/:agentId',
    async ({ params }) => {
      const agentId = BigInt(params.agentId)
      const [proposal, vote, research] = await Promise.all([
        registryIntegration.canSubmitProposal(agentId),
        registryIntegration.canVote(agentId),
        registryIntegration.canConductResearch(agentId),
      ])
      return {
        agentId: agentId.toString(),
        canSubmitProposal: proposal,
        canVote: vote,
        canConductResearch: research,
      }
    },
    {
      params: t.Object({ agentId: t.String() }),
      detail: { tags: ['registry'], summary: 'Check agent eligibility' },
    },
  )
  .get(
    '/delegate/:address',
    async ({ params }) => {
      const delegate = await registryIntegration.getDelegate(
        toAddress(params.address),
      )
      if (!delegate) return { error: 'Not a registered delegate' }
      return {
        ...delegate,
        agentId: delegate.agentId.toString(),
        totalDelegated: delegate.totalDelegated.toString(),
      }
    },
    {
      params: t.Object({ address: t.String() }),
      detail: { tags: ['registry'], summary: 'Get delegate info' },
    },
  )
  .get(
    '/top-delegates',
    async ({ query }) => {
      const limit = parseInt(query.limit ?? '10', 10)
      const delegates = await registryIntegration.getTopDelegates(limit)
      return {
        delegates: delegates.map((d) => ({
          ...d,
          agentId: d.agentId.toString(),
          totalDelegated: d.totalDelegated.toString(),
        })),
      }
    },
    {
      query: t.Object({ limit: t.Optional(t.String()) }),
      detail: { tags: ['registry'], summary: 'Get top delegates' },
    },
  )
  .get(
    '/security-council',
    async () => {
      const council = await registryIntegration.getSecurityCouncil()
      return {
        members: council.map((m) => ({
          ...m,
          agentId: m.agentId.toString(),
        })),
      }
    },
    {
      detail: { tags: ['registry'], summary: 'Get security council members' },
    },
  )
  .get(
    '/is-council-member/:address',
    async ({ params }) => {
      const isMember = await registryIntegration.isSecurityCouncilMember(
        toAddress(params.address),
      )
      return { isMember }
    },
    {
      params: t.Object({ address: t.String() }),
      detail: {
        tags: ['registry'],
        summary: 'Check if address is council member',
      },
    },
  )
