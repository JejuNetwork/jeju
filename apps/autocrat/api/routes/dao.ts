import { getChainId } from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { createDAOService, type DAOService } from '../dao-service'
import { getProposalAssistant } from '../proposal-assistant'
import { autocratConfig, blockchain, config } from '../shared-state'

const ZERO_ADDR = ZERO_ADDRESS

let daoService: DAOService | null = null

function getService(): DAOService {
  if (!daoService && config.contracts.daoRegistry !== ZERO_ADDR) {
    daoService = createDAOService({
      rpcUrl: config.rpcUrl,
      chainId: getChainId(),
      daoRegistryAddress: config.contracts.daoRegistry,
      daoFundingAddress: config.contracts.daoFunding,
      privateKey: autocratConfig.operatorKey ?? autocratConfig.privateKey,
    })
  }
  if (!daoService) {
    throw new Error('DAO Registry not deployed')
  }
  return daoService
}

export const daoRoutes = new Elysia({ prefix: '/api/v1/dao' })
  // List DAOs
  .get(
    '/list',
    async () => {
      const service = getService()
      const daoIds = await service.getAllDAOs()
      const daos = await Promise.all(daoIds.map((id) => service.getDAO(id)))
      return { daos }
    },
    { detail: { tags: ['dao'], summary: 'List all DAOs' } },
  )

  .get(
    '/active',
    async () => {
      const service = getService()
      const daoIds = await service.getActiveDAOs()
      const daos = await Promise.all(daoIds.map((id) => service.getDAOFull(id)))
      return { daos }
    },
    { detail: { tags: ['dao'], summary: 'List active DAOs' } },
  )

  // Create DAO
  .post(
    '/',
    async ({ body }) => {
      const service = getService()
      const txHash = await service.createDAO({
        name: body.name,
        displayName: body.displayName,
        description: body.description,
        treasury: body.treasury as Address,
        manifestCid: body.manifestCid ?? '',
        directorPersona: {
          name: body.director.name,
          pfpCid: body.director.pfpCid ?? '',
          description: body.director.description,
          personality: body.director.personality,
          traits: body.director.traits ?? [],
          voiceStyle: 'professional',
          communicationTone: 'professional' as const,
          specialties: [],
          isHuman: body.director.isHuman ?? false,
          decisionFallbackDays: body.director.decisionFallbackDays ?? 7,
        },
        governanceParams: {
          minQualityScore: body.governance.minQualityScore,
          boardVotingPeriod: body.governance.boardVotingPeriod,
          gracePeriod: body.governance.gracePeriod,
          minProposalStake: BigInt(body.governance.minProposalStake),
          quorumBps: body.governance.quorumBps,
        },
      })
      // Return the created DAO details
      const dao = await service.getDAOFull(body.name)
      return { ...dao, txHash }
    },
    {
      body: t.Object({
        name: t.String(),
        displayName: t.String(),
        description: t.String(),
        treasury: t.String(),
        manifestCid: t.Optional(t.String()),
        director: t.Object({
          name: t.String(),
          pfpCid: t.Optional(t.String()),
          description: t.String(),
          personality: t.String(),
          traits: t.Optional(t.Array(t.String())),
          isHuman: t.Optional(t.Boolean()),
          decisionFallbackDays: t.Optional(t.Number()),
        }),
        governance: t.Object({
          minQualityScore: t.Number(),
          boardVotingPeriod: t.Number(),
          gracePeriod: t.Number(),
          minProposalStake: t.String(),
          quorumBps: t.Number(),
        }),
        board: t.Optional(
          t.Array(
            t.Object({
              address: t.String(),
              agentId: t.String(),
              role: t.String(),
              weight: t.Number(),
              isHuman: t.Optional(t.Boolean()),
            }),
          ),
        ),
      }),
      detail: { tags: ['dao'], summary: 'Create new DAO' },
    },
  )

  // Get single DAO
  .get(
    '/:daoId',
    async ({ params }) => {
      const service = getService()
      const exists = await service.daoExists(params.daoId)
      if (!exists) throw new Error('DAO not found')
      return service.getDAOFull(params.daoId)
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get DAO details' },
    },
  )

  // Update DAO (Director persona/model)
  .patch(
    '/:daoId',
    async ({ params, body }) => {
      const service = getService()
      const exists = await service.daoExists(params.daoId)
      if (!exists) throw new Error('DAO not found')

      if (body.directorPersona) {
        await service.setDirectorPersona(params.daoId, {
          name: body.directorPersona.name,
          pfpCid: body.directorPersona.pfpCid ?? '',
          description: body.directorPersona.description,
          personality: body.directorPersona.personality,
          traits: body.directorPersona.traits ?? [],
          voiceStyle: 'professional',
          communicationTone: 'professional' as const,
          specialties: [],
          isHuman: body.directorPersona.isHuman ?? false,
          decisionFallbackDays: body.directorPersona.decisionFallbackDays ?? 7,
        })
      }
      if (body.directorModel) {
        await service.setDirectorModel(params.daoId, body.directorModel)
      }
      return service.getDAOFull(params.daoId)
    },
    {
      params: t.Object({ daoId: t.String() }),
      body: t.Object({
        directorPersona: t.Optional(
          t.Object({
            name: t.String(),
            pfpCid: t.Optional(t.String()),
            description: t.String(),
            personality: t.String(),
            traits: t.Optional(t.Array(t.String())),
            isHuman: t.Optional(t.Boolean()),
            decisionFallbackDays: t.Optional(t.Number()),
          }),
        ),
        directorModel: t.Optional(t.String()),
      }),
      detail: { tags: ['dao'], summary: 'Update DAO' },
    },
  )

  // Update governance params
  .patch(
    '/:daoId/governance',
    async ({ params, body }) => {
      const service = getService()
      const exists = await service.daoExists(params.daoId)
      if (!exists) throw new Error('DAO not found')

      await service.setGovernanceParams(params.daoId, {
        minQualityScore: body.minQualityScore,
        boardVotingPeriod: body.boardVotingPeriod,
        gracePeriod: body.gracePeriod,
        minProposalStake: BigInt(body.minProposalStake),
        quorumBps: body.quorumBps,
      })
      return service.getDAOFull(params.daoId)
    },
    {
      params: t.Object({ daoId: t.String() }),
      body: t.Object({
        minQualityScore: t.Number(),
        boardVotingPeriod: t.Number(),
        gracePeriod: t.Number(),
        minProposalStake: t.String(),
        quorumBps: t.Number(),
      }),
      detail: { tags: ['dao'], summary: 'Update governance parameters' },
    },
  )

  // Get Director persona
  .get(
    '/:daoId/persona',
    async ({ params }) => {
      const service = getService()
      return service.getDirectorPersona(params.daoId)
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get Director persona' },
    },
  )

  // Get board members
  .get(
    '/:daoId/board',
    async ({ params }) => {
      const service = getService()
      const members = await service.getBoardMembers(params.daoId)
      return { members }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get council members' },
    },
  )

  // Add council member (agent)
  .post(
    '/:daoId/agents',
    async ({ params, body }) => {
      const service = getService()
      const exists = await service.daoExists(params.daoId)
      if (!exists) throw new Error('DAO not found')

      const txHash = await service.addCouncilMember(
        params.daoId,
        body.address as Address,
        BigInt(body.agentId),
        body.role,
        body.weight,
      )
      const members = await service.getBoardMembers(params.daoId)
      const newMember = members.find(
        (m) => m.member.toLowerCase() === body.address.toLowerCase(),
      )
      return { ...newMember, txHash }
    },
    {
      params: t.Object({ daoId: t.String() }),
      body: t.Object({
        address: t.String(),
        agentId: t.String(),
        role: t.String(),
        weight: t.Number(),
      }),
      detail: { tags: ['dao'], summary: 'Add council member' },
    },
  )

  // Get single agent
  .get(
    '/:daoId/agents/:agentId',
    async ({ params }) => {
      const service = getService()
      const members = await service.getBoardMembers(params.daoId)
      const member = members.find(
        (m) => m.agentId.toString() === params.agentId,
      )
      if (!member) throw new Error('Agent not found')
      return member
    },
    {
      params: t.Object({ daoId: t.String(), agentId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get council member' },
    },
  )

  // Update agent (for CEO, use setDirectorPersona; for council, limited update)
  .patch(
    '/:daoId/agents/:agentId',
    async ({ params, body }) => {
      const service = getService()
      const exists = await service.daoExists(params.daoId)
      if (!exists) throw new Error('DAO not found')

      // If updating Director (agentId = 0 or role = Director), update persona
      if (params.agentId === '0' || body.role === 'Director') {
        if (body.persona) {
          await service.setDirectorPersona(params.daoId, {
            name: body.persona.name,
            pfpCid: body.persona.pfpCid ?? '',
            description: body.persona.description,
            personality: body.persona.personality,
            traits: body.persona.traits ?? [],
            voiceStyle: 'professional',
            communicationTone: 'professional' as const,
            specialties: [],
            isHuman: body.persona.isHuman ?? false,
            decisionFallbackDays: body.persona.decisionFallbackDays ?? 7,
          })
        }
        if (body.model) {
          await service.setDirectorModel(params.daoId, body.model)
        }
        const persona = await service.getDirectorPersona(params.daoId)
        return { agentId: '0', role: 'CEO', persona }
      }

      // For council members, would need contract support for weight updates
      // For now, return current state
      const members = await service.getBoardMembers(params.daoId)
      const member = members.find(
        (m) => m.agentId.toString() === params.agentId,
      )
      if (!member) throw new Error('Agent not found')
      return member
    },
    {
      params: t.Object({ daoId: t.String(), agentId: t.String() }),
      body: t.Object({
        role: t.Optional(t.String()),
        persona: t.Optional(
          t.Object({
            name: t.String(),
            pfpCid: t.Optional(t.String()),
            description: t.String(),
            personality: t.String(),
            traits: t.Optional(t.Array(t.String())),
            isHuman: t.Optional(t.Boolean()),
            decisionFallbackDays: t.Optional(t.Number()),
          }),
        ),
        model: t.Optional(t.String()),
      }),
      detail: { tags: ['dao'], summary: 'Update agent' },
    },
  )

  // Remove council member
  .delete(
    '/:daoId/agents/:agentId',
    async ({ params }) => {
      const service = getService()
      const exists = await service.daoExists(params.daoId)
      if (!exists) throw new Error('DAO not found')

      // Get member address from agentId
      const members = await service.getBoardMembers(params.daoId)
      const member = members.find(
        (m) => m.agentId.toString() === params.agentId,
      )
      if (!member) throw new Error('Agent not found')

      // Cannot remove CEO
      if (member.role === 'CEO' || params.agentId === '0') {
        throw new Error('Cannot remove CEO agent')
      }

      const txHash = await service.removeCouncilMember(
        params.daoId,
        member.member,
      )
      return { success: true, txHash }
    },
    {
      params: t.Object({ daoId: t.String(), agentId: t.String() }),
      detail: { tags: ['dao'], summary: 'Remove council member' },
    },
  )

  // Get proposals for DAO
  .get(
    '/:daoId/proposals',
    async ({ params, query }) => {
      const proposals = await blockchain.getProposalsByDAO(params.daoId)
      // Filter by status/type if provided
      type ProposalItem = (typeof proposals)[number]
      let filtered: ProposalItem[] = proposals
      if (query.status && query.status !== 'all') {
        filtered = filtered.filter(
          (p: ProposalItem) => p.status === query.status,
        )
      }
      if (query.type && query.type !== 'all') {
        filtered = filtered.filter((p: ProposalItem) => p.type === query.type)
      }
      return filtered
    },
    {
      params: t.Object({ daoId: t.String() }),
      query: t.Object({
        status: t.Optional(t.String()),
        type: t.Optional(t.String()),
        search: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      detail: { tags: ['dao'], summary: 'List proposals for DAO' },
    },
  )

  // Get single proposal
  .get(
    '/:daoId/proposals/:proposalId',
    async ({ params }) => {
      const result = await blockchain.getProposal(params.proposalId)
      if (!result) {
        throw new Error('Proposal not found')
      }
      return result
    },
    {
      params: t.Object({ daoId: t.String(), proposalId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get proposal' },
    },
  )

  // Create proposal for DAO
  .post(
    '/:daoId/proposals',
    async ({ params, body }) => {
      const service = getService()
      const exists = await service.daoExists(params.daoId)
      if (!exists) throw new Error('DAO not found')

      const assistant = getProposalAssistant()
      const draft = {
        daoId: params.daoId,
        title: body.title,
        summary: body.summary,
        description: body.description,
        proposalType: body.proposalType,
        targetContract: body.targetContract as Address | undefined,
        callData: body.calldata as `0x${string}` | undefined,
        value: body.value,
        tags: body.tags,
      }

      // Assess quality first
      const assessment = await assistant.assessQuality(draft)
      if (assessment.overallScore < 60) {
        throw new Error(
          `Proposal quality too low (${assessment.overallScore}). Improve before submitting.`,
        )
      }

      // Submit to chain
      const contentHash = assistant.getContentHash(draft)
      const txHash = await blockchain.submitProposal({
        daoId: params.daoId,
        proposalType: body.proposalType,
        qualityScore: assessment.overallScore,
        contentHash,
        targetContract: body.targetContract as Address | undefined,
        callData: body.calldata as `0x${string}` | undefined,
        value: body.value ? BigInt(body.value) : undefined,
      })

      return {
        proposalId: contentHash,
        txHash,
        qualityScore: assessment.overallScore,
        status: 'submitted',
      }
    },
    {
      params: t.Object({ daoId: t.String() }),
      body: t.Object({
        title: t.String(),
        summary: t.String(),
        description: t.String(),
        proposalType: t.Number(),
        targetContract: t.Optional(t.String()),
        calldata: t.Optional(t.String()),
        value: t.Optional(t.String()),
        tags: t.Optional(t.Array(t.String())),
      }),
      detail: { tags: ['dao'], summary: 'Create proposal' },
    },
  )

  // Get treasury data
  .get(
    '/:daoId/treasury',
    async ({ params }) => {
      const service = getService()
      const exists = await service.daoExists(params.daoId)
      if (!exists) throw new Error('DAO not found')

      const dao = await service.getDAO(params.daoId)
      // Get balances from blockchain
      const balances = await blockchain.getTreasuryBalances(dao.treasury)
      const transactions = await blockchain.getTreasuryTransactions(
        dao.treasury,
        20,
      )

      const totalUsdValue = balances.reduce(
        (sum, b) => sum + Number(b.usdValue),
        0,
      )

      return {
        balances,
        transactions,
        totalUsdValue: totalUsdValue.toFixed(2),
      }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get treasury data' },
    },
  )

  // Get linked packages
  .get(
    '/:daoId/packages',
    async ({ params }) => {
      const service = getService()
      const packages = await service.getLinkedPackages(params.daoId)
      return { packages }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get linked packages' },
    },
  )

  // Get linked repos
  .get(
    '/:daoId/repos',
    async ({ params }) => {
      const service = getService()
      const repos = await service.getLinkedRepos(params.daoId)
      return { repos }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: { tags: ['dao'], summary: 'Get linked repositories' },
    },
  )
