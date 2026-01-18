import {
  type Abi,
  type Address,
  createPublicClient,
  http,
  type PublicClient,
  parseEther,
  zeroHash,
} from 'viem'
import { readContract } from 'viem/actions'
import { toAddress } from '../lib'

export interface AgentProfile {
  agentId: bigint
  owner: string
  stakeTier: number
  stakedAmount: bigint
  registeredAt: number
  lastActivityAt: number
  isBanned: boolean
  feedbackCount: number
  averageReputation: number
  violationCount: number
  compositeScore: number
  tags: string[]
  a2aEndpoint: string
  mcpEndpoint: string
}

export interface ProviderReputation {
  provider: string
  providerAgentId: bigint
  stakeAmount: bigint
  stakeTime: number
  averageReputation: number
  violationsReported: number
  operatorCount: number
  lastUpdated: number
  weightedScore: number
}

export interface VotingPower {
  baseVotes: bigint
  reputationMultiplier: number
  stakeMultiplier: number
  effectiveVotes: bigint
}

export interface SearchResult {
  agentIds: bigint[]
  total: number
  offset: number
  limit: number
}

export interface EligibilityResult {
  eligible: boolean
  reason: string
}

const AgentProfileComponents = [
  { name: 'agentId', type: 'uint256' },
  { name: 'owner', type: 'address' },
  { name: 'stakeTier', type: 'uint8' },
  { name: 'stakedAmount', type: 'uint256' },
  { name: 'registeredAt', type: 'uint256' },
  { name: 'lastActivityAt', type: 'uint256' },
  { name: 'isBanned', type: 'bool' },
  { name: 'feedbackCount', type: 'uint64' },
  { name: 'averageReputation', type: 'uint8' },
  { name: 'violationCount', type: 'uint256' },
  { name: 'compositeScore', type: 'uint256' },
  { name: 'tags', type: 'string[]' },
  { name: 'a2aEndpoint', type: 'string' },
  { name: 'mcpEndpoint', type: 'string' },
] as const

const ProviderReputationComponents = [
  { name: 'provider', type: 'address' },
  { name: 'providerAgentId', type: 'uint256' },
  { name: 'stakeAmount', type: 'uint256' },
  { name: 'stakeTime', type: 'uint256' },
  { name: 'averageReputation', type: 'uint8' },
  { name: 'violationsReported', type: 'uint256' },
  { name: 'operatorCount', type: 'uint256' },
  { name: 'lastUpdated', type: 'uint256' },
  { name: 'weightedScore', type: 'uint256' },
] as const

const VotingPowerComponents = [
  { name: 'baseVotes', type: 'uint256' },
  { name: 'reputationMultiplier', type: 'uint256' },
  { name: 'stakeMultiplier', type: 'uint256' },
  { name: 'effectiveVotes', type: 'uint256' },
] as const

const SearchResultComponents = [
  { name: 'agentIds', type: 'uint256[]' },
  { name: 'total', type: 'uint256' },
  { name: 'offset', type: 'uint256' },
  { name: 'limit', type: 'uint256' },
] as const

const INTEGRATION_ABI: Abi = [
  {
    type: 'function',
    name: 'getAgentProfile',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple', components: AgentProfileComponents }],
  },
  {
    type: 'function',
    name: 'getAgentProfiles',
    stateMutability: 'view',
    inputs: [{ name: 'agentIds', type: 'uint256[]' }],
    outputs: [
      { name: '', type: 'tuple[]', components: AgentProfileComponents },
    ],
  },
  {
    type: 'function',
    name: 'getVotingPower',
    stateMutability: 'view',
    inputs: [
      { name: 'voter', type: 'address' },
      { name: 'agentId', type: 'uint256' },
      { name: 'baseVotes', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'tuple', components: VotingPowerComponents }],
  },
  {
    type: 'function',
    name: 'getProviderReputation',
    stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      { name: '', type: 'tuple', components: ProviderReputationComponents },
    ],
  },
  {
    type: 'function',
    name: 'getAllProviderReputations',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: '', type: 'tuple[]', components: ProviderReputationComponents },
    ],
  },
  {
    type: 'function',
    name: 'getWeightedAgentReputation',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'weightedReputation', type: 'uint256' },
      { name: 'totalWeight', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'searchByTag',
    stateMutability: 'view',
    inputs: [
      { name: 'tag', type: 'string' },
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'tuple', components: SearchResultComponents }],
  },
  {
    type: 'function',
    name: 'getAgentsByScore',
    stateMutability: 'view',
    inputs: [
      { name: 'minScore', type: 'uint256' },
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [
      { name: 'agentIds', type: 'uint256[]' },
      { name: 'scores', type: 'uint256[]' },
    ],
  },
  {
    type: 'function',
    name: 'getTopAgents',
    stateMutability: 'view',
    inputs: [{ name: 'count', type: 'uint256' }],
    outputs: [
      { name: '', type: 'tuple[]', components: AgentProfileComponents },
    ],
  },
  {
    type: 'function',
    name: 'canSubmitProposal',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'eligible', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
  },
  {
    type: 'function',
    name: 'canVote',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'eligible', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
  },
  {
    type: 'function',
    name: 'canConductResearch',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'eligible', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
  },
  {
    type: 'function',
    name: 'minScoreForProposal',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'minScoreForVoting',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'minScoreForResearch',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
]

const AgentComponents = [
  { name: 'agentId', type: 'uint256' },
  { name: 'owner', type: 'address' },
  { name: 'tier', type: 'uint8' },
  { name: 'stakedToken', type: 'address' },
  { name: 'stakedAmount', type: 'uint256' },
  { name: 'registeredAt', type: 'uint256' },
  { name: 'lastActivityAt', type: 'uint256' },
  { name: 'isBanned', type: 'bool' },
  { name: 'isSlashed', type: 'bool' },
] as const

const IDENTITY_ABI: Abi = [
  {
    type: 'function',
    name: 'getAgent',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple', components: AgentComponents }],
  },
  {
    type: 'function',
    name: 'agentExists',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'getA2AEndpoint',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'getMCPEndpoint',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'getAgentTags',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string[]' }],
  },
  {
    type: 'function',
    name: 'getAgentsByTag',
    stateMutability: 'view',
    inputs: [{ name: 'tag', type: 'string' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'getActiveAgents',
    stateMutability: 'view',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'totalAgents',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getMarketplaceInfo',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'a2aEndpoint', type: 'string' },
      { name: 'mcpEndpoint', type: 'string' },
      { name: 'serviceType', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'x402Supported', type: 'bool' },
      { name: 'tier', type: 'uint8' },
      { name: 'banned', type: 'bool' },
    ],
  },
]

const REPUTATION_ABI: Abi = [
  {
    type: 'function',
    name: 'getSummary',
    stateMutability: 'view',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clients', type: 'address[]' },
      { name: 'tag1', type: 'bytes32' },
      { name: 'tag2', type: 'bytes32' },
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'averageScore', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'getClients',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
]

const DelegateComponents = [
  { name: 'delegate', type: 'address' },
  { name: 'agentId', type: 'uint256' },
  { name: 'name', type: 'string' },
  { name: 'profileHash', type: 'string' },
  { name: 'expertise', type: 'string[]' },
  { name: 'totalDelegated', type: 'uint256' },
  { name: 'delegatorCount', type: 'uint256' },
  { name: 'registeredAt', type: 'uint256' },
  { name: 'isActive', type: 'bool' },
  { name: 'proposalsVoted', type: 'uint256' },
  { name: 'proposalsCreated', type: 'uint256' },
] as const

const DelegationComponents = [
  { name: 'delegator', type: 'address' },
  { name: 'delegate', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'delegatedAt', type: 'uint256' },
  { name: 'lockedUntil', type: 'uint256' },
] as const

const SecurityBoardComponents = [
  { name: 'member', type: 'address' },
  { name: 'agentId', type: 'uint256' },
  { name: 'combinedScore', type: 'uint256' },
  { name: 'electedAt', type: 'uint256' },
] as const

const DELEGATION_ABI: Abi = [
  {
    type: 'function',
    name: 'getDelegate',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'tuple', components: DelegateComponents }],
  },
  {
    type: 'function',
    name: 'getDelegation',
    stateMutability: 'view',
    inputs: [{ name: 'delegator', type: 'address' }],
    outputs: [{ name: '', type: 'tuple', components: DelegationComponents }],
  },
  {
    type: 'function',
    name: 'getTopDelegates',
    stateMutability: 'view',
    inputs: [{ name: 'limit', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple[]', components: DelegateComponents }],
  },
  {
    type: 'function',
    name: 'getSecurityBoard',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    type: 'function',
    name: 'getSecurityBoardDetails',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: '', type: 'tuple[]', components: SecurityBoardComponents },
    ],
  },
  {
    type: 'function',
    name: 'getVotingPower',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'isSecurityBoardMember',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
]

export interface RegistryIntegrationConfig {
  rpcUrl: string
  integrationContract?: string
  identityRegistry: string
  reputationRegistry: string
  delegationRegistry?: string
}

/** Contract return type for agent data from Identity Registry */
interface ContractAgentData {
  owner: Address
  tier: number
  stakedAmount: bigint
  registeredAt: bigint
  lastActivityAt: bigint
  isBanned: boolean
}

/** Contract return type for reputation summary */
type ContractReputationData = [bigint, number]

/** Contract return type for voting power */
interface ContractVotingPower {
  baseVotes: bigint
  reputationMultiplier: bigint
  stakeMultiplier: bigint
  effectiveVotes: bigint
}

/** Contract return type for provider reputation */
interface ContractProviderReputation {
  provider: Address
  providerAgentId: bigint
  stakeAmount: bigint
  stakeTime: bigint
  averageReputation: number
  violationsReported: bigint
  operatorCount: bigint
  lastUpdated: bigint
  weightedScore: bigint
}

/** Contract return type for search result */
interface ContractSearchResult {
  agentIds: bigint[]
  total: bigint
  offset: bigint
  limit: bigint
}

/** Contract return type for delegate */
interface ContractDelegate {
  delegate: Address
  agentId: bigint
  name: string
  profileHash: string
  expertise: string[]
  totalDelegated: bigint
  delegatorCount: bigint
  registeredAt: bigint
  isActive: boolean
  proposalsVoted: bigint
  proposalsCreated: bigint
}

/** Contract return type for top delegate (subset of fields) */
interface ContractTopDelegate {
  delegate: Address
  agentId: bigint
  name: string
  totalDelegated: bigint
  delegatorCount: bigint
  isActive: boolean
}

/** Contract return type for security board member */
interface ContractSecurityBoardMember {
  member: Address
  agentId: bigint
  combinedScore: bigint
  electedAt: bigint
}

export class RegistryIntegrationClient {
  private readonly client: PublicClient
  private readonly integrationAddress: Address | null = null
  private readonly identityAddress: Address
  private readonly reputationAddress: Address
  private readonly delegationAddress: Address | null = null

  constructor(config: RegistryIntegrationConfig) {
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    })

    this.identityAddress = toAddress(config.identityRegistry)
    this.reputationAddress = toAddress(config.reputationRegistry)

    if (config.integrationContract) {
      this.integrationAddress = toAddress(config.integrationContract)
    }

    if (config.delegationRegistry) {
      this.delegationAddress = toAddress(config.delegationRegistry)
    }
  }

  async getAgentProfile(agentId: bigint): Promise<AgentProfile | null> {
    if (this.integrationAddress) {
      const profile = await readContract(this.client, {
        address: this.integrationAddress,
        abi: INTEGRATION_ABI,
        functionName: 'getAgentProfile',
        args: [agentId],
      })
      return this._parseProfile(
        profile as Parameters<typeof this._parseProfile>[0],
      )
    }

    // Check if agent exists - the contract may revert for non-existent agents
    let exists = false
    try {
      exists = (await readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'agentExists',
        args: [agentId],
      })) as boolean
    } catch {
      // Contract reverted - agent doesn't exist
      return null
    }
    if (!exists) return null

    const [agent, tags, a2aEndpoint, mcpEndpoint, reputation] =
      (await Promise.all([
        readContract(this.client, {
          address: this.identityAddress,
          abi: IDENTITY_ABI,
          functionName: 'getAgent',
          args: [agentId],
        }),
        readContract(this.client, {
          address: this.identityAddress,
          abi: IDENTITY_ABI,
          functionName: 'getAgentTags',
          args: [agentId],
        }).catch((error: Error) => {
          console.warn(`Failed to get tags for agent ${agentId}:`, error)
          return [] satisfies string[]
        }),
        readContract(this.client, {
          address: this.identityAddress,
          abi: IDENTITY_ABI,
          functionName: 'getA2AEndpoint',
          args: [agentId],
        }).catch((error: Error) => {
          console.warn(
            `Failed to get A2A endpoint for agent ${agentId}:`,
            error,
          )
          return ''
        }),
        readContract(this.client, {
          address: this.identityAddress,
          abi: IDENTITY_ABI,
          functionName: 'getMCPEndpoint',
          args: [agentId],
        }).catch((error: Error) => {
          console.warn(
            `Failed to get MCP endpoint for agent ${agentId}:`,
            error,
          )
          return ''
        }),
        readContract(this.client, {
          address: this.reputationAddress,
          abi: REPUTATION_ABI,
          functionName: 'getSummary',
          args: [agentId, [], zeroHash, zeroHash],
        }),
      ])) as [
        ContractAgentData,
        string[],
        string,
        string,
        ContractReputationData,
      ]

    const compositeScore = this._calculateCompositeScore(
      agent.stakedAmount,
      reputation[1],
      agent.lastActivityAt,
      0,
      agent.isBanned,
    )

    return {
      agentId,
      owner: agent.owner,
      stakeTier: Number(agent.tier),
      stakedAmount: agent.stakedAmount,
      registeredAt: Number(agent.registeredAt),
      lastActivityAt: Number(agent.lastActivityAt),
      isBanned: agent.isBanned,
      feedbackCount: Number(reputation[0]),
      averageReputation: Number(reputation[1]),
      violationCount: 0,
      compositeScore,
      tags,
      a2aEndpoint,
      mcpEndpoint,
    }
  }

  async getAgentProfiles(agentIds: bigint[]): Promise<AgentProfile[]> {
    const profiles = await Promise.all(
      agentIds.map((id) => this.getAgentProfile(id)),
    )
    return profiles.filter((p): p is AgentProfile => p !== null)
  }

  async getVotingPower(
    voter: Address,
    agentId: bigint,
    baseVotes: bigint,
  ): Promise<VotingPower> {
    if (this.integrationAddress) {
      const power = (await readContract(this.client, {
        address: this.integrationAddress,
        abi: INTEGRATION_ABI,
        functionName: 'getVotingPower',
        args: [voter, agentId, baseVotes],
      })) as ContractVotingPower
      return {
        baseVotes: power.baseVotes,
        reputationMultiplier: Number(power.reputationMultiplier),
        stakeMultiplier: Number(power.stakeMultiplier),
        effectiveVotes: power.effectiveVotes,
      }
    }

    let repMultiplier = 100
    let stakeMultiplier = 100

    if (agentId > 0n) {
      const profile = await this.getAgentProfile(agentId)
      if (
        profile &&
        profile.owner.toLowerCase() === voter.toLowerCase() &&
        !profile.isBanned
      ) {
        if (profile.averageReputation >= 50) {
          repMultiplier = 100 + (profile.averageReputation - 50) * 2
        }
        if (profile.stakeTier === 3) stakeMultiplier = 150
        else if (profile.stakeTier === 2) stakeMultiplier = 125
        else if (profile.stakeTier === 1) stakeMultiplier = 110
      }
    }

    return {
      baseVotes,
      reputationMultiplier: repMultiplier,
      stakeMultiplier,
      effectiveVotes:
        (baseVotes * BigInt(repMultiplier) * BigInt(stakeMultiplier)) / 10000n,
    }
  }

  async getAllProviderReputations(): Promise<ProviderReputation[]> {
    if (!this.integrationAddress) return []

    const reps = (await readContract(this.client, {
      address: this.integrationAddress,
      abi: INTEGRATION_ABI,
      functionName: 'getAllProviderReputations',
    })) as ContractProviderReputation[]
    return reps.map((r) => ({
      provider: r.provider,
      providerAgentId: r.providerAgentId,
      stakeAmount: r.stakeAmount,
      stakeTime: Number(r.stakeTime),
      averageReputation: Number(r.averageReputation),
      violationsReported: Number(r.violationsReported),
      operatorCount: Number(r.operatorCount),
      lastUpdated: Number(r.lastUpdated),
      weightedScore: Number(r.weightedScore),
    }))
  }

  async getWeightedAgentReputation(
    agentId: bigint,
  ): Promise<{ reputation: number; weight: number }> {
    try {
      if (!this.integrationAddress) {
        const result = (await readContract(this.client, {
          address: this.reputationAddress,
          abi: REPUTATION_ABI,
          functionName: 'getSummary',
          args: [agentId, [], zeroHash, zeroHash],
        })) as [bigint, number]
        return { reputation: Number(result[1]), weight: 100 }
      }

      const result = (await readContract(this.client, {
        address: this.integrationAddress,
        abi: INTEGRATION_ABI,
        functionName: 'getWeightedAgentReputation',
        args: [agentId],
      })) as [bigint, bigint]
      return { reputation: Number(result[0]), weight: Number(result[1]) }
    } catch {
      // Agent doesn't exist or contract reverted
      return { reputation: 0, weight: 0 }
    }
  }

  async searchByTag(
    tag: string,
    offset = 0,
    limit = 50,
  ): Promise<SearchResult> {
    try {
      if (this.integrationAddress) {
        const result = (await readContract(this.client, {
          address: this.integrationAddress,
          abi: INTEGRATION_ABI,
          functionName: 'searchByTag',
          args: [tag, BigInt(offset), BigInt(limit)],
        })) as ContractSearchResult
        return {
          agentIds: result.agentIds,
          total: Number(result.total),
          offset: Number(result.offset),
          limit: Number(result.limit),
        }
      }

      const agentIds = (await readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'getAgentsByTag',
        args: [tag],
      })) as bigint[]
      const total = agentIds.length
      const sliced = agentIds.slice(offset, offset + limit)

      return {
        agentIds: sliced,
        total,
        offset,
        limit,
      }
    } catch {
      // No agents with this tag or contract reverted
      return { agentIds: [], total: 0, offset, limit }
    }
  }

  async getAgentsByScore(
    minScore: number,
    offset = 0,
    limit = 50,
  ): Promise<{ agentIds: bigint[]; scores: number[] }> {
    try {
      if (this.integrationAddress) {
        const result = (await readContract(this.client, {
          address: this.integrationAddress,
          abi: INTEGRATION_ABI,
          functionName: 'getAgentsByScore',
          args: [BigInt(minScore), BigInt(offset), BigInt(limit)],
        })) as [bigint[], bigint[]]
        return {
          agentIds: result[0],
          scores: result[1].map((s) => Number(s)),
        }
      }

      const allAgents = (await readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'getActiveAgents',
        args: [BigInt(0), BigInt(500)],
      })) as bigint[]
      const profiles = await this.getAgentProfiles(allAgents)

      const filtered = profiles
        .filter((p) => p.compositeScore >= minScore && !p.isBanned)
        .slice(offset, offset + limit)

      return {
        agentIds: filtered.map((p) => p.agentId),
        scores: filtered.map((p) => p.compositeScore),
      }
    } catch {
      return { agentIds: [], scores: [] }
    }
  }

  async getTopAgents(count = 10): Promise<AgentProfile[]> {
    try {
      if (this.integrationAddress) {
        const profiles = await readContract(this.client, {
          address: this.integrationAddress,
          abi: INTEGRATION_ABI,
          functionName: 'getTopAgents',
          args: [BigInt(count)],
        })
        return (
          profiles as Array<Parameters<typeof this._parseProfile>[0]>
        ).map((p) => this._parseProfile(p))
      }

      const allAgents = (await readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'getActiveAgents',
        args: [BigInt(0), BigInt(200)],
      })) as bigint[]
      const profiles = await this.getAgentProfiles(allAgents)

      return profiles
        .filter((p) => !p.isBanned)
        .sort((a, b) => b.compositeScore - a.compositeScore)
        .slice(0, count)
    } catch {
      return []
    }
  }

  async getActiveAgents(offset = 0, limit = 100): Promise<bigint[]> {
    try {
      return (await readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'getActiveAgents',
        args: [BigInt(offset), BigInt(limit)],
      })) as bigint[]
    } catch {
      return []
    }
  }

  async getTotalAgents(): Promise<number> {
    try {
      const total = (await readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'totalAgents',
      })) as bigint
      return Number(total)
    } catch {
      return 0
    }
  }

  async canSubmitProposal(agentId: bigint): Promise<EligibilityResult> {
    try {
      if (this.integrationAddress) {
        const result = (await readContract(this.client, {
          address: this.integrationAddress,
          abi: INTEGRATION_ABI,
          functionName: 'canSubmitProposal',
          args: [agentId],
        })) as [boolean, string]
        return { eligible: result[0], reason: result[1] }
      }

      const profile = await this.getAgentProfile(agentId)
      if (!profile) return { eligible: false, reason: 'Agent does not exist' }
      if (profile.isBanned)
        return { eligible: false, reason: 'Agent is banned' }
      if (profile.compositeScore < 50)
        return { eligible: false, reason: 'Composite score too low' }
      return { eligible: true, reason: '' }
    } catch {
      return { eligible: false, reason: 'Agent does not exist' }
    }
  }

  async canVote(agentId: bigint): Promise<EligibilityResult> {
    try {
      if (this.integrationAddress) {
        const result = (await readContract(this.client, {
          address: this.integrationAddress,
          abi: INTEGRATION_ABI,
          functionName: 'canVote',
          args: [agentId],
        })) as [boolean, string]
        return { eligible: result[0], reason: result[1] }
      }

      const profile = await this.getAgentProfile(agentId)
      if (!profile) return { eligible: false, reason: 'Agent does not exist' }
      if (profile.isBanned)
        return { eligible: false, reason: 'Agent is banned' }
      if (profile.compositeScore < 30)
        return { eligible: false, reason: 'Composite score too low' }
      return { eligible: true, reason: '' }
    } catch {
      return { eligible: false, reason: 'Agent does not exist' }
    }
  }

  async canConductResearch(agentId: bigint): Promise<EligibilityResult> {
    try {
      if (this.integrationAddress) {
        const result = (await readContract(this.client, {
          address: this.integrationAddress,
          abi: INTEGRATION_ABI,
          functionName: 'canConductResearch',
          args: [agentId],
        })) as [boolean, string]
        return { eligible: result[0], reason: result[1] }
      }

      const profile = await this.getAgentProfile(agentId)
      if (!profile) return { eligible: false, reason: 'Agent does not exist' }
      if (profile.isBanned)
        return { eligible: false, reason: 'Agent is banned' }
      if (profile.stakeTier < 2)
        return { eligible: false, reason: 'Insufficient stake tier' }
      if (profile.compositeScore < 70)
        return { eligible: false, reason: 'Composite score too low' }
      return { eligible: true, reason: '' }
    } catch {
      return { eligible: false, reason: 'Agent does not exist' }
    }
  }

  async getDelegate(address: Address) {
    if (!this.delegationAddress) return null
    const d = (await readContract(this.client, {
      address: this.delegationAddress,
      abi: DELEGATION_ABI,
      functionName: 'getDelegate',
      args: [address],
    })) as ContractDelegate
    if (d.registeredAt === 0n) return null
    return {
      delegate: d.delegate,
      agentId: d.agentId,
      name: d.name,
      profileHash: d.profileHash,
      expertise: d.expertise,
      totalDelegated: d.totalDelegated,
      delegatorCount: Number(d.delegatorCount),
      registeredAt: Number(d.registeredAt),
      isActive: d.isActive,
      proposalsVoted: Number(d.proposalsVoted),
      proposalsCreated: Number(d.proposalsCreated),
    }
  }

  async getTopDelegates(limit = 10) {
    if (!this.delegationAddress) return []
    const delegates = (await readContract(this.client, {
      address: this.delegationAddress,
      abi: DELEGATION_ABI,
      functionName: 'getTopDelegates',
      args: [BigInt(limit)],
    })) as ContractTopDelegate[]
    return delegates.map((d) => ({
      delegate: d.delegate,
      agentId: d.agentId,
      name: d.name,
      totalDelegated: d.totalDelegated,
      delegatorCount: Number(d.delegatorCount),
      isActive: d.isActive,
    }))
  }

  async getSecurityBoard() {
    if (!this.delegationAddress) return []
    const details = (await readContract(this.client, {
      address: this.delegationAddress,
      abi: DELEGATION_ABI,
      functionName: 'getSecurityBoardDetails',
    })) as ContractSecurityBoardMember[]
    return details.map((m) => ({
      member: m.member,
      agentId: m.agentId,
      combinedScore: Number(m.combinedScore),
      electedAt: Number(m.electedAt),
    }))
  }

  async isSecurityBoardMember(address: Address): Promise<boolean> {
    if (!this.delegationAddress) return false
    return readContract(this.client, {
      address: this.delegationAddress,
      abi: DELEGATION_ABI,
      functionName: 'isSecurityBoardMember',
      args: [address],
    }) as Promise<boolean>
  }

  private _parseProfile(raw: {
    agentId: bigint
    owner: string
    stakeTier: number | bigint
    stakedAmount: bigint
    registeredAt: number | bigint
    lastActivityAt: number | bigint
    isBanned: boolean
    feedbackCount: number | bigint
    averageReputation: number | bigint
    violationCount: number | bigint
    compositeScore: number | bigint
    tags: string[]
    a2aEndpoint: string
    mcpEndpoint: string
  }): AgentProfile {
    return {
      agentId: raw.agentId,
      owner: raw.owner,
      stakeTier: Number(raw.stakeTier),
      stakedAmount: raw.stakedAmount,
      registeredAt: Number(raw.registeredAt),
      lastActivityAt: Number(raw.lastActivityAt),
      isBanned: raw.isBanned,
      feedbackCount: Number(raw.feedbackCount),
      averageReputation: Number(raw.averageReputation),
      violationCount: Number(raw.violationCount),
      compositeScore: Number(raw.compositeScore),
      tags: raw.tags,
      a2aEndpoint: raw.a2aEndpoint,
      mcpEndpoint: raw.mcpEndpoint,
    }
  }

  private _calculateCompositeScore(
    staked: bigint,
    reputation: number | bigint,
    lastActivity: bigint,
    violations: number,
    banned: boolean,
  ): number {
    if (banned) return 0

    // Normalize stake (max 100 ETH)
    const stakedNum = Number(staked)
    const oneEth = Number(parseEther('1'))
    const stakeScore = Math.min(100, stakedNum / oneEth)

    // Reputation is already 0-100
    const repScore = Number(reputation)

    // Activity score
    const lastActivityNum = Number(lastActivity)
    const daysSince = (Date.now() / 1000 - lastActivityNum) / 86400
    const activityScore = daysSince < 30 ? 100 : daysSince < 90 ? 50 : 10

    // Violation penalty
    const penaltyScore = Math.max(0, 100 - violations * 10)

    // Weighted average (30% stake, 40% rep, 15% activity, 15% penalty)
    return Math.round(
      stakeScore * 0.3 +
        repScore * 0.4 +
        activityScore * 0.15 +
        penaltyScore * 0.15,
    )
  }
}

// Singleton

let instance: RegistryIntegrationClient | null = null

export function getRegistryIntegrationClient(
  config: RegistryIntegrationConfig,
): RegistryIntegrationClient {
  if (!instance) {
    instance = new RegistryIntegrationClient(config)
  }
  return instance
}

export function resetRegistryIntegrationClient(): void {
  instance = null
}
