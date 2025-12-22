/**
 * Blockchain client for Autocrat
 */

import {
  type Address,
  createPublicClient,
  formatEther,
  http,
  type PublicClient,
  isAddress as viemIsAddress,
} from 'viem'
import { base, baseSepolia, localhost } from 'viem/chains'

function inferChainFromRpcUrl(rpcUrl: string) {
  if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532')) {
    return baseSepolia
  }
  if (rpcUrl.includes('base') && !rpcUrl.includes('localhost')) {
    return base
  }
  return localhost
}

import {
  expectTrue as expect,
  expectValid as validateOrThrow,
} from '@jejunetwork/types'
import { ProposalIdSchema } from './schemas'
import {
  type AutocratVoteFromContract,
  CEO_AGENT_ABI,
  type CEOStatsFromContract,
  COUNCIL_ABI,
  type DecisionFromContract,
  getAutocratRole,
  getProposalStatus,
  getProposalType,
  getVoteType,
  type ModelFromContract,
  type ProposalFromContract,
  ZERO_ADDRESS,
} from './shared'
import type { AutocratConfig } from './types'

export class AutocratBlockchain {
  readonly client: PublicClient
  readonly councilAddress: Address
  readonly ceoAgentAddress: Address
  readonly councilDeployed: boolean
  readonly ceoDeployed: boolean
  private readonly config: AutocratConfig

  // Wrapper object for CEO Agent contract calls
  readonly ceoAgent: {
    getAllModels: () => Promise<string[]>
  }

  constructor(config: AutocratConfig) {
    this.config = config
    const chain = inferChainFromRpcUrl(config.rpcUrl)
    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient
    this.councilAddress = (config.contracts?.council ?? ZERO_ADDRESS) as Address
    this.ceoAgentAddress = (config.contracts?.ceoAgent ??
      ZERO_ADDRESS) as Address
    this.councilDeployed =
      viemIsAddress(this.councilAddress) && this.councilAddress !== ZERO_ADDRESS
    this.ceoDeployed =
      viemIsAddress(this.ceoAgentAddress) &&
      this.ceoAgentAddress !== ZERO_ADDRESS

    // Initialize ceoAgent wrapper
    this.ceoAgent = {
      getAllModels: async () => {
        if (!this.ceoDeployed) return []
        return (await this.client.readContract({
          address: this.ceoAgentAddress,
          abi: CEO_AGENT_ABI,
          functionName: 'getAllModels',
        })) as string[]
      },
    }
  }

  async getProposal(proposalId: string): Promise<{
    proposal: ProposalFromContract
    votes: AutocratVoteFromContract[]
  } | null> {
    const validated = validateOrThrow(
      ProposalIdSchema,
      proposalId,
      'Proposal ID',
    )
    if (!this.councilDeployed) return null
    const proposal = (await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'getProposal',
      args: [validated],
    })) as ProposalFromContract
    const votes = (await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'getAutocratVotes',
      args: [validated],
    })) as AutocratVoteFromContract[]
    return { proposal, votes }
  }

  formatProposal(p: ProposalFromContract) {
    return {
      proposalId: p.proposalId,
      proposer: p.proposer,
      type: getProposalType(p.proposalType),
      status: getProposalStatus(p.status),
      qualityScore: p.qualityScore,
      createdAt: new Date(Number(p.createdAt) * 1000).toISOString(),
      autocratVoteEnd: new Date(Number(p.autocratVoteEnd) * 1000).toISOString(),
      gracePeriodEnd:
        p.gracePeriodEnd > 0n
          ? new Date(Number(p.gracePeriodEnd) * 1000).toISOString()
          : null,
      contentHash: p.contentHash,
      targetContract: p.targetContract,
      value: formatEther(p.value),
      totalStaked: formatEther(p.totalStaked),
      totalReputation: p.totalReputation.toString(),
      backerCount: p.backerCount.toString(),
      hasResearch: p.hasResearch,
      researchHash: p.researchHash,
      ceoApproved: p.ceoApproved,
    }
  }

  formatVotes(votes: AutocratVoteFromContract[]) {
    return votes.map((v) => ({
      agent: v.councilAgent,
      role: getAutocratRole(v.role),
      vote: getVoteType(v.vote),
      weight: v.weight.toString(),
      votedAt: new Date(Number(v.votedAt) * 1000).toISOString(),
      reasoningHash: v.reasoningHash,
    }))
  }

  async listProposals(
    activeOnly: boolean,
    limit = 20,
  ): Promise<{
    total: number
    proposals: Array<{
      proposalId: string
      proposer: string
      type: string
      status: string
      qualityScore: number
      createdAt: string
    }>
  }> {
    expect(
      limit > 0 && limit <= 1000,
      `Limit must be between 1 and 1000, got ${limit}`,
    )
    if (!this.councilDeployed) return { total: 0, proposals: [] }

    const proposalIds = activeOnly
      ? ((await this.client.readContract({
          address: this.councilAddress,
          abi: COUNCIL_ABI,
          functionName: 'getActiveProposals',
        })) as string[])
      : ((await this.client.readContract({
          address: this.councilAddress,
          abi: COUNCIL_ABI,
          functionName: 'getAllProposals',
        })) as string[])

    const proposals = []
    for (const id of proposalIds.slice(-limit)) {
      const p = (await this.client.readContract({
        address: this.councilAddress,
        abi: COUNCIL_ABI,
        functionName: 'getProposal',
        args: [id],
      })) as ProposalFromContract
      proposals.push({
        proposalId: id,
        proposer: p.proposer,
        type: getProposalType(p.proposalType),
        status: getProposalStatus(p.status),
        qualityScore: p.qualityScore,
        createdAt: new Date(Number(p.createdAt) * 1000).toISOString(),
      })
    }

    return { total: proposalIds.length, proposals: proposals.reverse() }
  }

  async getCEOStatus(): Promise<{
    currentModel: {
      modelId: string
      name: string
      provider: string
      totalStaked?: string
      benchmarkScore?: string
    }
    stats: {
      totalDecisions: string
      approvedDecisions: string
      overriddenDecisions: string
      approvalRate: string
      overrideRate: string
    }
  }> {
    if (!this.ceoDeployed) {
      const ceoModel = this.config.agents?.ceo?.model ?? 'local'
      const ceoName = this.config.agents?.ceo?.name ?? 'Local CEO'
      return {
        currentModel: { modelId: ceoModel, name: ceoName, provider: 'local' },
        stats: {
          totalDecisions: '0',
          approvedDecisions: '0',
          overriddenDecisions: '0',
          approvalRate: '0%',
          overrideRate: '0%',
        },
      }
    }

    const stats = (await this.client.readContract({
      address: this.ceoAgentAddress,
      abi: CEO_AGENT_ABI,
      functionName: 'getCEOStats',
    })) as CEOStatsFromContract
    const model = (await this.client.readContract({
      address: this.ceoAgentAddress,
      abi: CEO_AGENT_ABI,
      functionName: 'getCurrentModel',
    })) as ModelFromContract

    return {
      currentModel: {
        modelId: model.modelId,
        name: model.modelName,
        provider: model.provider,
        totalStaked: formatEther(model.totalStaked),
        benchmarkScore: `${(Number(model.benchmarkScore) / 100).toFixed(2)}%`,
      },
      stats: {
        totalDecisions: stats.totalDecisions.toString(),
        approvedDecisions: stats.approvedDecisions.toString(),
        overriddenDecisions: stats.overriddenDecisions.toString(),
        approvalRate: `${(Number(stats.approvalRate) / 100).toFixed(2)}%`,
        overrideRate: `${(Number(stats.overrideRate) / 100).toFixed(2)}%`,
      },
    }
  }

  async getDecision(proposalId: string): Promise<{
    decided: boolean
    decision?: {
      proposalId: string
      modelId: string
      approved: boolean
      decisionHash: string
      decidedAt: string
      confidenceScore: string
      alignmentScore: string
      disputed: boolean
      overridden: boolean
    }
  }> {
    const validated = validateOrThrow(
      ProposalIdSchema,
      proposalId,
      'Proposal ID',
    )
    if (!this.ceoDeployed) return { decided: false }

    const decision = (await this.client.readContract({
      address: this.ceoAgentAddress,
      abi: CEO_AGENT_ABI,
      functionName: 'getDecision',
      args: [validated],
    })) as DecisionFromContract
    if (!decision.decidedAt || decision.decidedAt === 0n)
      return { decided: false }

    return {
      decided: true,
      decision: {
        proposalId: validated,
        modelId: decision.modelId,
        approved: decision.approved,
        decisionHash: decision.decisionHash,
        decidedAt: new Date(Number(decision.decidedAt) * 1000).toISOString(),
        confidenceScore: decision.confidenceScore.toString(),
        alignmentScore: decision.alignmentScore.toString(),
        disputed: decision.disputed,
        overridden: decision.overridden,
      },
    }
  }

  async getModelCandidates(): Promise<
    Array<{
      modelId: string
      modelName: string
      provider: string
      totalStaked: string
      totalReputation: string
      benchmarkScore: number
      decisionsCount: number
      isActive: boolean
    }>
  > {
    if (!this.ceoDeployed) return []

    const modelIds = (await this.client.readContract({
      address: this.ceoAgentAddress,
      abi: CEO_AGENT_ABI,
      functionName: 'getAllModels',
    })) as string[]
    const models = []

    for (const modelId of modelIds) {
      const m = (await this.client.readContract({
        address: this.ceoAgentAddress,
        abi: CEO_AGENT_ABI,
        functionName: 'getModel',
        args: [modelId],
      })) as ModelFromContract
      models.push({
        modelId: m.modelId,
        modelName: m.modelName,
        provider: m.provider,
        totalStaked: formatEther(m.totalStaked),
        totalReputation: m.totalReputation.toString(),
        benchmarkScore: Number(m.benchmarkScore) / 100,
        decisionsCount: Number(m.decisionsCount),
        isActive: m.isActive,
      })
    }

    return models.sort(
      (a, b) => parseFloat(b.totalStaked) - parseFloat(a.totalStaked),
    )
  }

  async getRecentDecisions(limit = 10): Promise<
    Array<{
      decisionId: string
      proposalId: string
      approved: boolean
      confidenceScore: number
      alignmentScore: number
      decidedAt: number
      disputed: boolean
      overridden: boolean
    }>
  > {
    expect(
      limit > 0 && limit <= 100,
      `Limit must be between 1 and 100, got ${limit}`,
    )
    if (!this.ceoDeployed) return []

    const decisionIds = (await this.client.readContract({
      address: this.ceoAgentAddress,
      abi: CEO_AGENT_ABI,
      functionName: 'getRecentDecisions',
      args: [limit],
    })) as string[]
    const decisions = []

    for (const id of decisionIds) {
      const d = (await this.client.readContract({
        address: this.ceoAgentAddress,
        abi: CEO_AGENT_ABI,
        functionName: 'getDecision',
        args: [id],
      })) as DecisionFromContract
      if (d.decidedAt && d.decidedAt > 0n) {
        decisions.push({
          decisionId: id,
          proposalId: d.proposalId,
          approved: d.approved,
          confidenceScore: Number(d.confidenceScore),
          alignmentScore: Number(d.alignmentScore),
          decidedAt: Number(d.decidedAt) * 1000,
          disputed: d.disputed,
          overridden: d.overridden,
        })
      }
    }

    return decisions
  }

  async getGovernanceStats(): Promise<{
    totalProposals: string
    ceo: { model: string; decisions: string; approvalRate: string }
    parameters: {
      minQualityScore: string
      autocratVotingPeriod: string
      gracePeriod: string
    }
  }> {
    if (!this.councilDeployed || !this.ceoDeployed) {
      const ceoModel = this.config.agents?.ceo?.model ?? 'local'
      const minQuality = this.config.parameters?.minQualityScore ?? 70
      const votingPeriod = this.config.parameters?.autocratVotingPeriod ?? 86400
      const gracePeriod = this.config.parameters?.gracePeriod ?? 172800
      return {
        totalProposals: '0',
        ceo: { model: ceoModel, decisions: '0', approvalRate: '0%' },
        parameters: {
          minQualityScore: minQuality.toString(),
          autocratVotingPeriod: `${votingPeriod} seconds`,
          gracePeriod: `${gracePeriod} seconds`,
        },
      }
    }

    const proposalCount = (await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'proposalCount',
    })) as bigint
    const ceoStats = (await this.client.readContract({
      address: this.ceoAgentAddress,
      abi: CEO_AGENT_ABI,
      functionName: 'getCEOStats',
    })) as CEOStatsFromContract
    const minQuality = (await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'minQualityScore',
    })) as number
    const votingPeriod = (await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'autocratVotingPeriod',
    })) as bigint
    const grace = (await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'gracePeriod',
    })) as bigint

    return {
      totalProposals: proposalCount.toString(),
      ceo: {
        model: ceoStats.currentModelId,
        decisions: ceoStats.totalDecisions.toString(),
        approvalRate: `${(Number(ceoStats.approvalRate) / 100).toFixed(2)}%`,
      },
      parameters: {
        minQualityScore: minQuality.toString(),
        autocratVotingPeriod: `${votingPeriod.toString()} seconds`,
        gracePeriod: `${grace.toString()} seconds`,
      },
    }
  }

  getAutocratStatus() {
    const votingPeriod = this.config.parameters?.autocratVotingPeriod ?? 86400
    const gracePeriod = this.config.parameters?.gracePeriod ?? 172800
    return {
      agents: ['Treasury', 'Code', 'Community', 'Security'].map((role, i) => ({
        role,
        index: i,
        description: [
          'Financial review',
          'Technical review',
          'Community impact',
          'Security assessment',
        ][i],
      })),
      votingPeriod: `${votingPeriod} seconds`,
      gracePeriod: `${gracePeriod} seconds`,
    }
  }
}

let instance: AutocratBlockchain | null = null

export function getBlockchain(config: AutocratConfig): AutocratBlockchain {
  if (!instance) {
    instance = new AutocratBlockchain(config)
  }
  return instance
}
