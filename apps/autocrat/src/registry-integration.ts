import { createPublicClient, http, parseEther, zeroHash, type Address, type PublicClient } from 'viem';
import { readContract } from 'viem/actions';
import { parseAbi } from 'viem';

export interface AgentProfile {
  agentId: bigint;
  owner: string;
  stakeTier: number;
  stakedAmount: bigint;
  registeredAt: number;
  lastActivityAt: number;
  isBanned: boolean;
  feedbackCount: number;
  averageReputation: number;
  violationCount: number;
  compositeScore: number;
  tags: string[];
  a2aEndpoint: string;
  mcpEndpoint: string;
}

export interface ProviderReputation {
  provider: string;
  providerAgentId: bigint;
  stakeAmount: bigint;
  stakeTime: number;
  averageReputation: number;
  violationsReported: number;
  operatorCount: number;
  lastUpdated: number;
  weightedScore: number;
}

export interface VotingPower {
  baseVotes: bigint;
  reputationMultiplier: number;
  stakeMultiplier: number;
  effectiveVotes: bigint;
}

export interface SearchResult {
  agentIds: bigint[];
  total: number;
  offset: number;
  limit: number;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
}

const INTEGRATION_ABI = parseAbi([
  'function getAgentProfile(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, uint8 stakeTier, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, uint64 feedbackCount, uint8 averageReputation, uint256 violationCount, uint256 compositeScore, string[] tags, string a2aEndpoint, string mcpEndpoint))',
  'function getAgentProfiles(uint256[] agentIds) external view returns (tuple(uint256 agentId, address owner, uint8 stakeTier, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, uint64 feedbackCount, uint8 averageReputation, uint256 violationCount, uint256 compositeScore, string[] tags, string a2aEndpoint, string mcpEndpoint)[])',
  'function getVotingPower(address voter, uint256 agentId, uint256 baseVotes) external view returns (tuple(uint256 baseVotes, uint256 reputationMultiplier, uint256 stakeMultiplier, uint256 effectiveVotes))',
  'function getProviderReputation(address provider) external view returns (tuple(address provider, uint256 providerAgentId, uint256 stakeAmount, uint256 stakeTime, uint8 averageReputation, uint256 violationsReported, uint256 operatorCount, uint256 lastUpdated, uint256 weightedScore))',
  'function getAllProviderReputations() external view returns (tuple(address provider, uint256 providerAgentId, uint256 stakeAmount, uint256 stakeTime, uint8 averageReputation, uint256 violationsReported, uint256 operatorCount, uint256 lastUpdated, uint256 weightedScore)[])',
  'function getWeightedAgentReputation(uint256 agentId) external view returns (uint256 weightedReputation, uint256 totalWeight)',
  'function searchByTag(string tag, uint256 offset, uint256 limit) external view returns (tuple(uint256[] agentIds, uint256 total, uint256 offset, uint256 limit))',
  'function getAgentsByScore(uint256 minScore, uint256 offset, uint256 limit) external view returns (uint256[] agentIds, uint256[] scores)',
  'function getTopAgents(uint256 count) external view returns (tuple(uint256 agentId, address owner, uint8 stakeTier, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, uint64 feedbackCount, uint8 averageReputation, uint256 violationCount, uint256 compositeScore, string[] tags, string a2aEndpoint, string mcpEndpoint)[])',
  'function canSubmitProposal(uint256 agentId) external view returns (bool eligible, string reason)',
  'function canVote(uint256 agentId) external view returns (bool eligible, string reason)',
  'function canConductResearch(uint256 agentId) external view returns (bool eligible, string reason)',
  'function minScoreForProposal() external view returns (uint256)',
  'function minScoreForVoting() external view returns (uint256)',
  'function minScoreForResearch() external view returns (uint256)',
]);

const IDENTITY_ABI = parseAbi([
  'function getAgent(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed))',
  'function agentExists(uint256 agentId) external view returns (bool)',
  'function ownerOf(uint256 agentId) external view returns (address)',
  'function getA2AEndpoint(uint256 agentId) external view returns (string)',
  'function getMCPEndpoint(uint256 agentId) external view returns (string)',
  'function getAgentTags(uint256 agentId) external view returns (string[])',
  'function getAgentsByTag(string tag) external view returns (uint256[])',
  'function getActiveAgents(uint256 offset, uint256 limit) external view returns (uint256[])',
  'function totalAgents() external view returns (uint256)',
  'function getMarketplaceInfo(uint256 agentId) external view returns (string a2aEndpoint, string mcpEndpoint, string serviceType, string category, bool x402Supported, uint8 tier, bool banned)',
]);

const REPUTATION_ABI = parseAbi([
  'function getSummary(uint256 agentId, address[] clients, bytes32 tag1, bytes32 tag2) external view returns (uint64 count, uint8 averageScore)',
  'function getClients(uint256 agentId) external view returns (address[])',
]);

const DELEGATION_ABI = parseAbi([
  'function getDelegate(address addr) external view returns (tuple(address delegate, uint256 agentId, string name, string profileHash, string[] expertise, uint256 totalDelegated, uint256 delegatorCount, uint256 registeredAt, bool isActive, uint256 proposalsVoted, uint256 proposalsCreated))',
  'function getDelegation(address delegator) external view returns (tuple(address delegator, address delegate, uint256 amount, uint256 delegatedAt, uint256 lockedUntil))',
  'function getTopDelegates(uint256 limit) external view returns (tuple(address delegate, uint256 agentId, string name, string profileHash, string[] expertise, uint256 totalDelegated, uint256 delegatorCount, uint256 registeredAt, bool isActive, uint256 proposalsVoted, uint256 proposalsCreated)[])',
  'function getSecurityCouncil() external view returns (address[])',
  'function getSecurityCouncilDetails() external view returns (tuple(address member, uint256 agentId, uint256 combinedScore, uint256 electedAt)[])',
  'function getVotingPower(address account) external view returns (uint256)',
  'function isSecurityCouncilMember(address) external view returns (bool)',
]);

export interface RegistryIntegrationConfig {
  rpcUrl: string;
  integrationContract?: string;
  identityRegistry: string;
  reputationRegistry: string;
  delegationRegistry?: string;
}

export class RegistryIntegrationClient {
  private readonly client: PublicClient;
  private readonly integrationAddress: Address | null = null;
  private readonly identityAddress: Address;
  private readonly reputationAddress: Address;
  private readonly delegationAddress: Address | null = null;

  constructor(config: RegistryIntegrationConfig) {
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    });
    
    this.identityAddress = config.identityRegistry as Address;
    this.reputationAddress = config.reputationRegistry as Address;
    
    if (config.integrationContract) {
      this.integrationAddress = config.integrationContract as Address;
    }
    
    if (config.delegationRegistry) {
      this.delegationAddress = config.delegationRegistry as Address;
    }
  }

  async getAgentProfile(agentId: bigint): Promise<AgentProfile | null> {
    if (this.integrationAddress) {
      const profile = await readContract(this.client, {
        address: this.integrationAddress,
        abi: INTEGRATION_ABI,
        functionName: 'getAgentProfile',
        args: [agentId],
      });
      return this._parseProfile(profile);
    }
    
    const exists = await readContract(this.client, {
      address: this.identityAddress,
      abi: IDENTITY_ABI,
      functionName: 'agentExists',
      args: [agentId],
    });
    if (!exists) return null;
    
    const [agent, tags, a2aEndpoint, mcpEndpoint, reputation] = await Promise.all([
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
      }).catch((error) => {
        console.warn(`Failed to get tags for agent ${agentId}:`, error);
        return [] as string[];
      }),
      readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'getA2AEndpoint',
        args: [agentId],
      }).catch((error) => {
        console.warn(`Failed to get A2A endpoint for agent ${agentId}:`, error);
        return '';
      }),
      readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'getMCPEndpoint',
        args: [agentId],
      }).catch((error) => {
        console.warn(`Failed to get MCP endpoint for agent ${agentId}:`, error);
        return '';
      }),
      readContract(this.client, {
        address: this.reputationAddress,
        abi: REPUTATION_ABI,
        functionName: 'getSummary',
        args: [agentId, [], zeroHash, zeroHash],
      }),
    ]);
    
    const agentData = agent as { owner: Address; tier: number; stakedAmount: bigint; registeredAt: bigint; lastActivityAt: bigint; isBanned: boolean };
    const repData = reputation as [bigint, number];
    
    const compositeScore = this._calculateCompositeScore(
      agentData.stakedAmount,
      repData[1],
      agentData.lastActivityAt,
      0,
      agentData.isBanned
    );
    
    return {
      agentId,
      owner: agentData.owner,
      stakeTier: Number(agentData.tier),
      stakedAmount: agentData.stakedAmount,
      registeredAt: Number(agentData.registeredAt),
      lastActivityAt: Number(agentData.lastActivityAt),
      isBanned: agentData.isBanned,
      feedbackCount: Number(repData[0]),
      averageReputation: Number(repData[1]),
      violationCount: 0,
      compositeScore,
      tags: tags as string[],
      a2aEndpoint: a2aEndpoint as string,
      mcpEndpoint: mcpEndpoint as string,
    };
  }

  async getAgentProfiles(agentIds: bigint[]): Promise<AgentProfile[]> {
    const profiles = await Promise.all(agentIds.map(id => this.getAgentProfile(id)));
    return profiles.filter((p): p is AgentProfile => p !== null);
  }

  async getVotingPower(voter: Address, agentId: bigint, baseVotes: bigint): Promise<VotingPower> {
    if (this.integrationAddress) {
      const power = await readContract(this.client, {
        address: this.integrationAddress,
        abi: INTEGRATION_ABI,
        functionName: 'getVotingPower',
        args: [voter, agentId, baseVotes],
      }) as { baseVotes: bigint; reputationMultiplier: bigint; stakeMultiplier: bigint; effectiveVotes: bigint };
      return {
        baseVotes: power.baseVotes,
        reputationMultiplier: Number(power.reputationMultiplier),
        stakeMultiplier: Number(power.stakeMultiplier),
        effectiveVotes: power.effectiveVotes,
      };
    }
    
    let repMultiplier = 100;
    let stakeMultiplier = 100;
    
    if (agentId > 0n) {
      const profile = await this.getAgentProfile(agentId);
      if (profile && profile.owner.toLowerCase() === voter.toLowerCase() && !profile.isBanned) {
        if (profile.averageReputation >= 50) {
          repMultiplier = 100 + (profile.averageReputation - 50) * 2;
        }
        if (profile.stakeTier === 3) stakeMultiplier = 150;
        else if (profile.stakeTier === 2) stakeMultiplier = 125;
        else if (profile.stakeTier === 1) stakeMultiplier = 110;
      }
    }
    
    return {
      baseVotes,
      reputationMultiplier: repMultiplier,
      stakeMultiplier,
      effectiveVotes: (baseVotes * BigInt(repMultiplier) * BigInt(stakeMultiplier)) / 10000n,
    };
  }

  async getAllProviderReputations(): Promise<ProviderReputation[]> {
    if (!this.integrationAddress) return [];
    
    const reps = await readContract(this.client, {
      address: this.integrationAddress,
      abi: INTEGRATION_ABI,
      functionName: 'getAllProviderReputations',
    }) as Array<{ provider: Address; providerAgentId: bigint; stakeAmount: bigint; stakeTime: bigint; averageReputation: number; violationsReported: bigint; operatorCount: bigint; lastUpdated: bigint; weightedScore: bigint }>;
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
    }));
  }

  async getWeightedAgentReputation(agentId: bigint): Promise<{ reputation: number; weight: number }> {
    if (!this.integrationAddress) {
      const result = await readContract(this.client, {
        address: this.reputationAddress,
        abi: REPUTATION_ABI,
        functionName: 'getSummary',
        args: [agentId, [], zeroHash, zeroHash],
      }) as [bigint, number];
      return { reputation: Number(result[1]), weight: 100 };
    }
    
    const result = await readContract(this.client, {
      address: this.integrationAddress,
      abi: INTEGRATION_ABI,
      functionName: 'getWeightedAgentReputation',
      args: [agentId],
    }) as [bigint, bigint];
    return { reputation: Number(result[0]), weight: Number(result[1]) };
  }

  async searchByTag(tag: string, offset = 0, limit = 50): Promise<SearchResult> {
    if (this.integrationAddress) {
      const result = await readContract(this.client, {
        address: this.integrationAddress,
        abi: INTEGRATION_ABI,
        functionName: 'searchByTag',
        args: [tag, BigInt(offset), BigInt(limit)],
      }) as { agentIds: bigint[]; total: bigint; offset: bigint; limit: bigint };
      return {
        agentIds: result.agentIds,
        total: Number(result.total),
        offset: Number(result.offset),
        limit: Number(result.limit),
      };
    }
    
    const agentIds = await readContract(this.client, {
      address: this.identityAddress,
      abi: IDENTITY_ABI,
      functionName: 'getAgentsByTag',
      args: [tag],
    }) as bigint[];
    const total = agentIds.length;
    const sliced = agentIds.slice(offset, offset + limit);
    
    return {
      agentIds: sliced,
      total,
      offset,
      limit,
    };
  }

  async getAgentsByScore(minScore: number, offset = 0, limit = 50): Promise<{ agentIds: bigint[]; scores: number[] }> {
    if (this.integrationAddress) {
      const result = await readContract(this.client, {
        address: this.integrationAddress,
        abi: INTEGRATION_ABI,
        functionName: 'getAgentsByScore',
        args: [BigInt(minScore), BigInt(offset), BigInt(limit)],
      }) as [bigint[], bigint[]];
      return {
        agentIds: result[0],
        scores: result[1].map((s) => Number(s)),
      };
    }
    
    const allAgents = await readContract(this.client, {
      address: this.identityAddress,
      abi: IDENTITY_ABI,
      functionName: 'getActiveAgents',
      args: [BigInt(0), BigInt(500)],
    }) as bigint[];
    const profiles = await this.getAgentProfiles(allAgents);
    
    const filtered = profiles
      .filter(p => p.compositeScore >= minScore && !p.isBanned)
      .slice(offset, offset + limit);
    
    return {
      agentIds: filtered.map(p => p.agentId),
      scores: filtered.map(p => p.compositeScore),
    };
  }

  async getTopAgents(count = 10): Promise<AgentProfile[]> {
    if (this.integrationAddress) {
      const profiles = await readContract(this.client, {
        address: this.integrationAddress,
        abi: INTEGRATION_ABI,
        functionName: 'getTopAgents',
        args: [BigInt(count)],
      });
      return (profiles as Array<Record<string, unknown>>).map((p) => this._parseProfile(p));
    }
    
    const allAgents = await readContract(this.client, {
      address: this.identityAddress,
      abi: IDENTITY_ABI,
      functionName: 'getActiveAgents',
      args: [BigInt(0), BigInt(200)],
    }) as bigint[];
    const profiles = await this.getAgentProfiles(allAgents);
    
    return profiles
      .filter(p => !p.isBanned)
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, count);
  }

  async getActiveAgents(offset = 0, limit = 100): Promise<bigint[]> {
    return readContract(this.client, {
      address: this.identityAddress,
      abi: IDENTITY_ABI,
      functionName: 'getActiveAgents',
      args: [BigInt(offset), BigInt(limit)],
    }) as Promise<bigint[]>;
  }

  async getTotalAgents(): Promise<number> {
    const total = await readContract(this.client, {
      address: this.identityAddress,
      abi: IDENTITY_ABI,
      functionName: 'totalAgents',
    }) as bigint;
    return Number(total);
  }

  async canSubmitProposal(agentId: bigint): Promise<EligibilityResult> {
    if (this.integrationAddress) {
      const result = await readContract(this.client, {
        address: this.integrationAddress,
        abi: INTEGRATION_ABI,
        functionName: 'canSubmitProposal',
        args: [agentId],
      }) as [boolean, string];
      return { eligible: result[0], reason: result[1] };
    }
    
    const profile = await this.getAgentProfile(agentId);
    if (!profile) return { eligible: false, reason: 'Agent does not exist' };
    if (profile.isBanned) return { eligible: false, reason: 'Agent is banned' };
    if (profile.compositeScore < 50) return { eligible: false, reason: 'Composite score too low' };
    return { eligible: true, reason: '' };
  }

  async canVote(agentId: bigint): Promise<EligibilityResult> {
    if (this.integrationAddress) {
      const result = await readContract(this.client, {
        address: this.integrationAddress,
        abi: INTEGRATION_ABI,
        functionName: 'canVote',
        args: [agentId],
      }) as [boolean, string];
      return { eligible: result[0], reason: result[1] };
    }
    
    const profile = await this.getAgentProfile(agentId);
    if (!profile) return { eligible: false, reason: 'Agent does not exist' };
    if (profile.isBanned) return { eligible: false, reason: 'Agent is banned' };
    if (profile.compositeScore < 30) return { eligible: false, reason: 'Composite score too low' };
    return { eligible: true, reason: '' };
  }

  async canConductResearch(agentId: bigint): Promise<EligibilityResult> {
    if (this.integrationAddress) {
      const result = await readContract(this.client, {
        address: this.integrationAddress,
        abi: INTEGRATION_ABI,
        functionName: 'canConductResearch',
        args: [agentId],
      }) as [boolean, string];
      return { eligible: result[0], reason: result[1] };
    }
    
    const profile = await this.getAgentProfile(agentId);
    if (!profile) return { eligible: false, reason: 'Agent does not exist' };
    if (profile.isBanned) return { eligible: false, reason: 'Agent is banned' };
    if (profile.stakeTier < 2) return { eligible: false, reason: 'Insufficient stake tier' };
    if (profile.compositeScore < 70) return { eligible: false, reason: 'Composite score too low' };
    return { eligible: true, reason: '' };
  }

  async getDelegate(address: Address) {
    if (!this.delegationAddress) return null;
    const d = await readContract(this.client, {
      address: this.delegationAddress,
      abi: DELEGATION_ABI,
      functionName: 'getDelegate',
      args: [address],
    }) as { delegate: Address; agentId: bigint; name: string; profileHash: string; expertise: string[]; totalDelegated: bigint; delegatorCount: bigint; registeredAt: bigint; isActive: boolean; proposalsVoted: bigint; proposalsCreated: bigint };
    if (d.registeredAt === 0n) return null;
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
    };
  }

  async getTopDelegates(limit = 10) {
    if (!this.delegationAddress) return [];
    const delegates = await readContract(this.client, {
      address: this.delegationAddress,
      abi: DELEGATION_ABI,
      functionName: 'getTopDelegates',
      args: [BigInt(limit)],
    }) as Array<{ delegate: Address; agentId: bigint; name: string; totalDelegated: bigint; delegatorCount: bigint; isActive: boolean }>;
    return delegates.map((d) => ({
      delegate: d.delegate,
      agentId: d.agentId,
      name: d.name,
      totalDelegated: d.totalDelegated,
      delegatorCount: Number(d.delegatorCount),
      isActive: d.isActive,
    }));
  }

  async getSecurityCouncil() {
    if (!this.delegationAddress) return [];
    const details = await readContract(this.client, {
      address: this.delegationAddress,
      abi: DELEGATION_ABI,
      functionName: 'getSecurityCouncilDetails',
    }) as Array<{ member: Address; agentId: bigint; combinedScore: bigint; electedAt: bigint }>;
    return details.map((m) => ({
      member: m.member,
      agentId: m.agentId,
      combinedScore: Number(m.combinedScore),
      electedAt: Number(m.electedAt),
    }));
  }

  async isSecurityCouncilMember(address: Address): Promise<boolean> {
    if (!this.delegationAddress) return false;
    return readContract(this.client, {
      address: this.delegationAddress,
      abi: DELEGATION_ABI,
      functionName: 'isSecurityCouncilMember',
      args: [address],
    }) as Promise<boolean>;
  }

  private _parseProfile(raw: Record<string, unknown>): AgentProfile {
    return {
      agentId: raw.agentId as bigint,
      owner: raw.owner as string,
      stakeTier: Number(raw.stakeTier),
      stakedAmount: raw.stakedAmount as bigint,
      registeredAt: Number(raw.registeredAt),
      lastActivityAt: Number(raw.lastActivityAt),
      isBanned: raw.isBanned as boolean,
      feedbackCount: Number(raw.feedbackCount),
      averageReputation: Number(raw.averageReputation),
      violationCount: Number(raw.violationCount),
      compositeScore: Number(raw.compositeScore),
      tags: raw.tags as string[],
      a2aEndpoint: raw.a2aEndpoint as string,
      mcpEndpoint: raw.mcpEndpoint as string,
    };
  }

  private _calculateCompositeScore(
    staked: bigint,
    reputation: number | bigint,
    lastActivity: bigint,
    violations: number,
    banned: boolean
  ): number {
    if (banned) return 0;
    
    // Normalize stake (max 100 ETH)
    const stakedNum = typeof staked === 'bigint' ? Number(staked) : staked;
    const oneEth = Number(parseEther('1'));
    const stakeScore = Math.min(100, stakedNum / oneEth);
    
    // Reputation is already 0-100
    const repScore = Number(reputation);
    
    // Activity score
    const lastActivityNum = typeof lastActivity === 'bigint' ? Number(lastActivity) : lastActivity;
    const daysSince = (Date.now() / 1000 - lastActivityNum) / 86400;
    const activityScore = daysSince < 30 ? 100 : daysSince < 90 ? 50 : 10;
    
    // Violation penalty
    const penaltyScore = Math.max(0, 100 - violations * 10);
    
    // Weighted average (30% stake, 40% rep, 15% activity, 15% penalty)
    return Math.round(
      stakeScore * 0.3 +
      repScore * 0.4 +
      activityScore * 0.15 +
      penaltyScore * 0.15
    );
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: RegistryIntegrationClient | null = null;

export function getRegistryIntegrationClient(config: RegistryIntegrationConfig): RegistryIntegrationClient {
  if (!instance) {
    instance = new RegistryIntegrationClient(config);
  }
  return instance;
}

export function resetRegistryIntegrationClient(): void {
  instance = null;
}
