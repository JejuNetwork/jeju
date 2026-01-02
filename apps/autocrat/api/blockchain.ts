import {
  asTuple,
  expectTrue as expect,
  toBigInt,
  expectValid as validateOrThrow,
  ZERO_ADDRESS,
} from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  formatEther,
  http,
  type PublicClient,
  isAddress as viemIsAddress,
} from 'viem'
import type { AutocratConfig } from '../lib'
import {
  type AutocratVoteFromContract,
  COUNCIL_ABI,
  type DecisionFromContract,
  DIRECTOR_AGENT_ABI,
  type DirectorStatsFromContract,
  getAutocratRole,
  getProposalStatus,
  getProposalType,
  getVoteType,
  type ModelFromContract,
  type ProposalFromContract,
  ProposalIdSchema,
  toAddress,
} from '../lib'
import { inferChainFromRpcUrl } from './chains'

// Contract return tuple types for proper typing
type ProposalTuple = readonly [
  `0x${string}`, // proposalId
  `0x${string}`, // proposer
  bigint, // proposerAgentId
  number, // proposalType
  number, // status
  number, // qualityScore
  bigint, // createdAt
  bigint, // autocratVoteEnd
  bigint, // gracePeriodEnd
  `0x${string}`, // contentHash
  `0x${string}`, // targetContract
  `0x${string}`, // callData
  bigint, // value
  bigint, // totalStaked
  bigint, // totalReputation
  bigint, // backerCount
  boolean, // hasResearch
  `0x${string}`, // researchHash
  boolean, // directorApproved
  `0x${string}`, // directorDecisionHash
]

type AutocratVoteTuple = readonly [
  `0x${string}`, // proposalId
  `0x${string}`, // councilAgent
  number, // role
  number, // vote
  `0x${string}`, // reasoningHash
  bigint, // votedAt
  bigint, // weight
]

type ModelTuple = readonly [
  string, // modelId
  string, // modelName
  string, // provider
  string, // nominatedBy
  bigint, // totalStaked
  bigint, // totalReputation
  bigint, // nominatedAt
  boolean, // isActive
  bigint, // decisionsCount
  bigint, // approvedDecisions
  bigint, // benchmarkScore
]

type DirectorStatsTuple = readonly [
  string, // currentModelId
  bigint, // totalDecisions
  bigint, // approvedDecisions
  bigint, // overriddenDecisions
  bigint, // approvalRate
  bigint, // overrideRate
]

type DecisionTuple = readonly [
  string, // proposalId
  string, // modelId
  boolean, // approved
  string, // decisionHash
  string, // encryptedHash
  string, // contextHash
  bigint, // decidedAt
  bigint, // confidenceScore
  bigint, // alignmentScore
  boolean, // disputed
  boolean, // overridden
]

function parseProposalTuple(t: ProposalTuple): ProposalFromContract {
  return {
    proposalId: t[0],
    proposer: t[1],
    proposerAgentId: t[2],
    proposalType: t[3],
    status: t[4],
    qualityScore: t[5],
    createdAt: t[6],
    autocratVoteEnd: t[7],
    gracePeriodEnd: t[8],
    contentHash: t[9],
    targetContract: t[10],
    callData: t[11],
    value: t[12],
    totalStaked: t[13],
    totalReputation: t[14],
    backerCount: t[15],
    hasResearch: t[16],
    researchHash: t[17],
    directorApproved: t[18],
    directorDecisionHash: t[19],
  }
}

function parseAutocratVoteTuple(
  t: AutocratVoteTuple,
): AutocratVoteFromContract {
  return {
    proposalId: t[0],
    councilAgent: t[1],
    role: t[2],
    vote: t[3],
    reasoningHash: t[4],
    votedAt: t[5],
    weight: t[6],
  }
}

function parseModelTuple(t: ModelTuple): ModelFromContract {
  return {
    modelId: t[0],
    modelName: t[1],
    provider: t[2],
    nominatedBy: t[3],
    totalStaked: t[4],
    totalReputation: t[5],
    nominatedAt: t[6],
    isActive: t[7],
    decisionsCount: t[8],
    approvedDecisions: t[9],
    benchmarkScore: t[10],
  }
}

function parseDirectorStatsTuple(
  t: DirectorStatsTuple,
): DirectorStatsFromContract {
  return {
    currentModelId: t[0],
    totalDecisions: t[1],
    approvedDecisions: t[2],
    overriddenDecisions: t[3],
    approvalRate: t[4],
    overrideRate: t[5],
  }
}

function parseDecisionTuple(t: DecisionTuple): DecisionFromContract {
  return {
    proposalId: t[0],
    modelId: t[1],
    approved: t[2],
    decisionHash: t[3],
    encryptedHash: t[4],
    contextHash: t[5],
    decidedAt: t[6],
    confidenceScore: t[7],
    alignmentScore: t[8],
    disputed: t[9],
    overridden: t[10],
  }
}

// Type-safe contract result parsers
function expectProposalTuple(result: unknown): ProposalFromContract {
  return parseProposalTuple(asTuple<ProposalTuple>(result, 20))
}

function expectVoteTuples(result: unknown): AutocratVoteFromContract[] {
  if (!Array.isArray(result)) throw new Error('Expected array of vote tuples')
  return result.map((v) =>
    parseAutocratVoteTuple(asTuple<AutocratVoteTuple>(v, 7)),
  )
}

function expectModelTuple(result: unknown): ModelFromContract {
  return parseModelTuple(asTuple<ModelTuple>(result, 11))
}

function expectDirectorStatsTuple(result: unknown): DirectorStatsFromContract {
  return parseDirectorStatsTuple(asTuple<DirectorStatsTuple>(result, 6))
}

function expectDecisionTuple(result: unknown): DecisionFromContract {
  return parseDecisionTuple(asTuple<DecisionTuple>(result, 11))
}

function expectStringArray(result: unknown): string[] {
  if (!Array.isArray(result)) throw new Error('Expected string array')
  return [...result]
}

export class AutocratBlockchain {
  readonly client: PublicClient
  readonly councilAddress: Address
  readonly directorAgentAddress: Address
  readonly councilDeployed: boolean
  readonly directorDeployed: boolean
  private readonly config: AutocratConfig

  // Wrapper object for Director Agent contract calls
  readonly directorAgent: {
    getAllModels: () => Promise<string[]>
  }

  constructor(config: AutocratConfig) {
    this.config = config
    const chain = inferChainFromRpcUrl(config.rpcUrl)
    // Type assertion required: viem's createPublicClient returns a complex parameterized type
    // that is not directly assignable to PublicClient due to generic variance
    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient
    this.councilAddress = toAddress(config.contracts?.council ?? ZERO_ADDRESS)
    this.directorAgentAddress = toAddress(
      config.contracts?.directorAgent ?? ZERO_ADDRESS,
    )
    this.councilDeployed =
      viemIsAddress(this.councilAddress) && this.councilAddress !== ZERO_ADDRESS
    this.directorDeployed =
      viemIsAddress(this.directorAgentAddress) &&
      this.directorAgentAddress !== ZERO_ADDRESS

    // Initialize directorAgent wrapper
    this.directorAgent = {
      getAllModels: async () => {
        if (!this.directorDeployed) return []
        const result = await this.client.readContract({
          address: this.directorAgentAddress,
          abi: DIRECTOR_AGENT_ABI,
          functionName: 'getAllModels',
        })
        return expectStringArray(result)
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
    const proposalResult = await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'getProposal',
      args: [validated],
    })
    const proposal = expectProposalTuple(proposalResult)
    const votesResult = await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'getAutocratVotes',
      args: [validated],
    })
    const votes = expectVoteTuples(votesResult)
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
      directorApproved: p.directorApproved,
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

    const proposalIdsResult = activeOnly
      ? await this.client.readContract({
          address: this.councilAddress,
          abi: COUNCIL_ABI,
          functionName: 'getActiveProposals',
        })
      : await this.client.readContract({
          address: this.councilAddress,
          abi: COUNCIL_ABI,
          functionName: 'getAllProposals',
        })
    const proposalIds = expectStringArray(proposalIdsResult)

    const proposals = []
    for (const id of proposalIds.slice(-limit)) {
      const proposalResult = await this.client.readContract({
        address: this.councilAddress,
        abi: COUNCIL_ABI,
        functionName: 'getProposal',
        args: [id],
      })
      const p = expectProposalTuple(proposalResult)
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

  async getDirectorStatus(): Promise<{
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
    decisionsThisPeriod?: number
  }> {
    if (!this.directorDeployed) {
      // Use the DAO's configured model as the current Director
      const configuredModelId = this.config.directorModelId ?? 'claude-opus-4-5'
      const activeModel =
        findModelById(configuredModelId) ?? MODEL_CANDIDATES[0]
      return {
        currentModel: {
          modelId: activeModel.modelId,
          name: activeModel.modelName,
          provider: activeModel.provider,
          totalStaked: '0',
          benchmarkScore: `${activeModel.benchmarkScore}%`,
        },
        stats: {
          totalDecisions: '0',
          approvedDecisions: '0',
          overriddenDecisions: '0',
          approvalRate: '0%',
          overrideRate: '0%',
        },
        decisionsThisPeriod: 0,
      }
    }

    const statsResult = await this.client.readContract({
      address: this.directorAgentAddress,
      abi: DIRECTOR_AGENT_ABI,
      functionName: 'getDirectorStats',
    })
    const stats = expectDirectorStatsTuple(statsResult)
    const modelResult = await this.client.readContract({
      address: this.directorAgentAddress,
      abi: DIRECTOR_AGENT_ABI,
      functionName: 'getCurrentModel',
    })
    const model = expectModelTuple(modelResult)

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
    if (!this.directorDeployed) return { decided: false }

    const decisionResult = await this.client.readContract({
      address: this.directorAgentAddress,
      abi: DIRECTOR_AGENT_ABI,
      functionName: 'getDecision',
      args: [validated],
    })
    const decision = expectDecisionTuple(decisionResult)
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
    if (!this.directorDeployed) {
      // Return default models with DAO's configured model marked as active
      const configuredModelId = this.config.directorModelId ?? 'claude-opus-4-5'
      return getDefaultModelCandidates(configuredModelId)
    }

    const modelIdsResult = await this.client.readContract({
      address: this.directorAgentAddress,
      abi: DIRECTOR_AGENT_ABI,
      functionName: 'getAllModels',
    })
    const modelIds = expectStringArray(modelIdsResult)
    const models = []

    for (const modelId of modelIds) {
      const modelResult = await this.client.readContract({
        address: this.directorAgentAddress,
        abi: DIRECTOR_AGENT_ABI,
        functionName: 'getModel',
        args: [modelId],
      })
      const m = expectModelTuple(modelResult)
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
    if (!this.directorDeployed) return []

    const decisionIdsResult = await this.client.readContract({
      address: this.directorAgentAddress,
      abi: DIRECTOR_AGENT_ABI,
      functionName: 'getRecentDecisions',
      args: [limit],
    })
    const decisionIds = expectStringArray(decisionIdsResult)
    const decisions = []

    for (const id of decisionIds) {
      const decisionResult = await this.client.readContract({
        address: this.directorAgentAddress,
        abi: DIRECTOR_AGENT_ABI,
        functionName: 'getDecision',
        args: [id],
      })
      const d = expectDecisionTuple(decisionResult)
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
    director: { model: string; decisions: string; approvalRate: string }
    parameters: {
      minQualityScore: string
      autocratVotingPeriod: string
      gracePeriod: string
    }
  }> {
    if (!this.councilDeployed || !this.directorDeployed) {
      const director = this.config.agents?.director
      const params = this.config.parameters
      const minQuality = params?.minQualityScore ?? 70
      const votingPeriod = params?.autocratVotingPeriod ?? 86400
      const gracePeriod = params?.gracePeriod ?? 172800
      return {
        totalProposals: '0',
        director: {
          model: director?.model ?? 'local',
          decisions: '0',
          approvalRate: '0%',
        },
        parameters: {
          minQualityScore: minQuality.toString(),
          autocratVotingPeriod: `${votingPeriod} seconds`,
          gracePeriod: `${gracePeriod} seconds`,
        },
      }
    }

    const proposalCountResult = await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'proposalCount',
    })
    const proposalCount = toBigInt(proposalCountResult)
    const directorStatsResult = await this.client.readContract({
      address: this.directorAgentAddress,
      abi: DIRECTOR_AGENT_ABI,
      functionName: 'getDirectorStats',
    })
    const directorStats = expectDirectorStatsTuple(directorStatsResult)
    const minQualityResult = await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'minQualityScore',
    })
    const minQuality = Number(minQualityResult)
    const votingPeriodResult = await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'autocratVotingPeriod',
    })
    const votingPeriod = toBigInt(votingPeriodResult)
    const graceResult = await this.client.readContract({
      address: this.councilAddress,
      abi: COUNCIL_ABI,
      functionName: 'gracePeriod',
    })
    const grace = toBigInt(graceResult)

    return {
      totalProposals: proposalCount.toString(),
      director: {
        model: directorStats.currentModelId,
        decisions: directorStats.totalDecisions.toString(),
        approvalRate: `${(Number(directorStats.approvalRate) / 100).toFixed(2)}%`,
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

  async getProposalsByDAO(_daoId: string) {
    // Get all proposals for this DAO
    // Note: In a multi-DAO setup, this would filter by daoId from the registry
    const result = await this.listProposals(false)
    return result.proposals
  }

  async submitProposal(_params: {
    daoId: string
    proposalType: number
    qualityScore: number
    contentHash: string
    targetContract?: `0x${string}`
    callData?: `0x${string}`
    value?: bigint
  }): Promise<`0x${string}`> {
    // This method requires a wallet client which is not available in this read-only blockchain class
    // Use DAOService.submitProposal() instead for write operations
    throw new Error(
      'submitProposal is not available on AutocratBlockchain. Use DAOService instead.',
    )
  }

  async getTreasuryBalances(treasuryAddress: string): Promise<
    Array<{
      token: string
      symbol: string
      balance: string
      usdValue: string
      change24h: number
    }>
  > {
    const balance = await this.client.getBalance({
      address: treasuryAddress as `0x${string}`,
    })

    // Fetch ETH price from config or use reasonable default
    const ethPrice = this.config.ethPriceUsd ?? 3500

    return [
      {
        token: 'Ethereum',
        symbol: 'ETH',
        balance: formatEther(balance),
        usdValue: (Number(formatEther(balance)) * ethPrice).toFixed(2),
        change24h: 0,
      },
    ]
  }

  async getTreasuryTransactions(
    treasuryAddress: string,
    limit: number,
  ): Promise<
    Array<{
      id: string
      type: 'inflow' | 'outflow'
      description: string
      amount: string
      token: string
      timestamp: number
      txHash: string
      proposalId?: string
    }>
  > {
    // Query indexer API for treasury transactions
    const indexerUrl = this.config.indexerUrl
    if (!indexerUrl) {
      return []
    }

    const response = await fetch(
      `${indexerUrl}/api/accounts/${treasuryAddress}/transactions?limit=${limit}`,
    )
    if (!response.ok) {
      return []
    }

    const data = await response.json()
    const txs = data.transactions ?? []

    return txs.map(
      (tx: {
        hash: string
        from: string
        to: string
        value: string
        timestamp: number
      }) => ({
        id: tx.hash,
        type:
          tx.to.toLowerCase() === treasuryAddress.toLowerCase()
            ? 'inflow'
            : 'outflow',
        description:
          tx.to.toLowerCase() === treasuryAddress.toLowerCase()
            ? 'Deposit'
            : 'Withdrawal',
        amount: formatEther(BigInt(tx.value || '0')),
        token: 'ETH',
        timestamp: tx.timestamp * 1000,
        txHash: tx.hash,
      }),
    )
  }
}

/**
 * All available AI model candidates from DWS inference providers
 */
const MODEL_CANDIDATES = [
  {
    modelId: 'claude-opus-4-5',
    modelName: 'Claude 4.5 Opus',
    provider: 'Anthropic',
    benchmarkScore: 98,
  },
  {
    modelId: 'claude-sonnet-4-5',
    modelName: 'Claude 4.5 Sonnet',
    provider: 'Anthropic',
    benchmarkScore: 96,
  },
  {
    modelId: 'gpt-5.2',
    modelName: 'GPT-5.2',
    provider: 'OpenAI',
    benchmarkScore: 96,
  },
  {
    modelId: 'gemini-1.5-pro',
    modelName: 'Gemini 1.5 Pro',
    provider: 'Google',
    benchmarkScore: 87,
  },
  {
    modelId: 'llama-3.3-70b',
    modelName: 'Llama 3.3 70B',
    provider: 'Groq',
    benchmarkScore: 82,
  },
  {
    modelId: 'mixtral-8x7b',
    modelName: 'Mixtral 8x7B',
    provider: 'Together AI',
    benchmarkScore: 78,
  },
  {
    modelId: 'deepseek-v3',
    modelName: 'DeepSeek V3',
    provider: 'DeepSeek',
    benchmarkScore: 85,
  },
] as const

/**
 * Get default AI model candidates with the configured model marked as active
 * @param activeModelId - The model ID that should be marked as active (from DAO config)
 */
function getDefaultModelCandidates(activeModelId = 'claude-opus-4-5') {
  return MODEL_CANDIDATES.map((model) => ({
    ...model,
    totalStaked: '0',
    totalReputation: '0',
    decisionsCount: 0,
    isActive: model.modelId === activeModelId,
  }))
}

/**
 * Find a model by ID from the default candidates
 */
function findModelById(modelId: string) {
  return MODEL_CANDIDATES.find((m) => m.modelId === modelId)
}

let instance: AutocratBlockchain | null = null

export function getBlockchain(config: AutocratConfig): AutocratBlockchain {
  if (!instance) {
    instance = new AutocratBlockchain(config)
  }
  return instance
}
