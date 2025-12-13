/**
 * Registry Integration - Deep AI DAO integration with ERC-8004 registries
 * 
 * Provides:
 * - Access to all registered agents with reputation scores
 * - Provider reputation weighting
 * - Composite score calculations
 * - Search and discovery
 * - Voting power calculations
 */

import { Contract, JsonRpcProvider, parseEther } from 'ethers';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// ABI Fragments
// ============================================================================

const INTEGRATION_ABI = [
  // Agent queries
  'function getAgentProfile(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, uint8 stakeTier, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, uint64 feedbackCount, uint8 averageReputation, uint256 violationCount, uint256 compositeScore, string[] tags, string a2aEndpoint, string mcpEndpoint))',
  'function getAgentProfiles(uint256[] agentIds) external view returns (tuple(uint256 agentId, address owner, uint8 stakeTier, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, uint64 feedbackCount, uint8 averageReputation, uint256 violationCount, uint256 compositeScore, string[] tags, string a2aEndpoint, string mcpEndpoint)[])',
  'function getVotingPower(address voter, uint256 agentId, uint256 baseVotes) external view returns (tuple(uint256 baseVotes, uint256 reputationMultiplier, uint256 stakeMultiplier, uint256 effectiveVotes))',
  
  // Provider reputation
  'function getProviderReputation(address provider) external view returns (tuple(address provider, uint256 providerAgentId, uint256 stakeAmount, uint256 stakeTime, uint8 averageReputation, uint256 violationsReported, uint256 operatorCount, uint256 lastUpdated, uint256 weightedScore))',
  'function getAllProviderReputations() external view returns (tuple(address provider, uint256 providerAgentId, uint256 stakeAmount, uint256 stakeTime, uint8 averageReputation, uint256 violationsReported, uint256 operatorCount, uint256 lastUpdated, uint256 weightedScore)[])',
  'function getWeightedAgentReputation(uint256 agentId) external view returns (uint256 weightedReputation, uint256 totalWeight)',
  
  // Search
  'function searchByTag(string tag, uint256 offset, uint256 limit) external view returns (tuple(uint256[] agentIds, uint256 total, uint256 offset, uint256 limit))',
  'function getAgentsByScore(uint256 minScore, uint256 offset, uint256 limit) external view returns (uint256[] agentIds, uint256[] scores)',
  'function getTopAgents(uint256 count) external view returns (tuple(uint256 agentId, address owner, uint8 stakeTier, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, uint64 feedbackCount, uint8 averageReputation, uint256 violationCount, uint256 compositeScore, string[] tags, string a2aEndpoint, string mcpEndpoint)[])',
  
  // Eligibility
  'function canSubmitProposal(uint256 agentId) external view returns (bool eligible, string reason)',
  'function canVote(uint256 agentId) external view returns (bool eligible, string reason)',
  'function canConductResearch(uint256 agentId) external view returns (bool eligible, string reason)',
  
  // Config
  'function minScoreForProposal() external view returns (uint256)',
  'function minScoreForVoting() external view returns (uint256)',
  'function minScoreForResearch() external view returns (uint256)',
] as const;

const IDENTITY_ABI = [
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
] as const;

const REPUTATION_ABI = [
  'function getSummary(uint256 agentId, address[] clients, bytes32 tag1, bytes32 tag2) external view returns (uint64 count, uint8 averageScore)',
  'function getClients(uint256 agentId) external view returns (address[])',
] as const;

const DELEGATION_ABI = [
  'function getDelegate(address addr) external view returns (tuple(address delegate, uint256 agentId, string name, string profileHash, string[] expertise, uint256 totalDelegated, uint256 delegatorCount, uint256 registeredAt, bool isActive, uint256 proposalsVoted, uint256 proposalsCreated))',
  'function getDelegation(address delegator) external view returns (tuple(address delegator, address delegate, uint256 amount, uint256 delegatedAt, uint256 lockedUntil))',
  'function getTopDelegates(uint256 limit) external view returns (tuple(address delegate, uint256 agentId, string name, string profileHash, string[] expertise, uint256 totalDelegated, uint256 delegatorCount, uint256 registeredAt, bool isActive, uint256 proposalsVoted, uint256 proposalsCreated)[])',
  'function getSecurityCouncil() external view returns (address[])',
  'function getSecurityCouncilDetails() external view returns (tuple(address member, uint256 agentId, uint256 combinedScore, uint256 electedAt)[])',
  'function getVotingPower(address account) external view returns (uint256)',
  'function isSecurityCouncilMember(address) external view returns (bool)',
] as const;

// ============================================================================
// Client
// ============================================================================

export interface RegistryIntegrationConfig {
  rpcUrl: string;
  integrationContract?: string;
  identityRegistry: string;
  reputationRegistry: string;
  delegationRegistry?: string;
}

export class RegistryIntegrationClient {
  private readonly provider: JsonRpcProvider;
  private readonly integration: Contract | null = null;
  private readonly identity: Contract;
  private readonly reputation: Contract;
  private readonly delegation: Contract | null = null;

  constructor(config: RegistryIntegrationConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    
    this.identity = new Contract(config.identityRegistry, IDENTITY_ABI, this.provider);
    this.reputation = new Contract(config.reputationRegistry, REPUTATION_ABI, this.provider);
    
    if (config.integrationContract) {
      this.integration = new Contract(config.integrationContract, INTEGRATION_ABI, this.provider);
    }
    
    if (config.delegationRegistry) {
      this.delegation = new Contract(config.delegationRegistry, DELEGATION_ABI, this.provider);
    }
  }

  // ============================================================================
  // Agent Profile Queries
  // ============================================================================

  /**
   * Get comprehensive profile for an agent
   */
  async getAgentProfile(agentId: bigint): Promise<AgentProfile | null> {
    if (this.integration) {
      const profile = await this.integration.getAgentProfile(agentId);
      return this._parseProfile(profile);
    }
    
    // Fallback: construct profile manually
    const exists = await this.identity.agentExists(agentId);
    if (!exists) return null;
    
    const [agent, tags, a2aEndpoint, mcpEndpoint, reputation] = await Promise.all([
      this.identity.getAgent(agentId),
      this.identity.getAgentTags(agentId).catch(() => []),
      this.identity.getA2AEndpoint(agentId).catch(() => ''),
      this.identity.getMCPEndpoint(agentId).catch(() => ''),
      this.reputation.getSummary(agentId, [], '0x' + '0'.repeat(64), '0x' + '0'.repeat(64)),
    ]);
    
    const compositeScore = this._calculateCompositeScore(
      agent.stakedAmount,
      reputation[1],
      agent.lastActivityAt,
      0,
      agent.isBanned
    );
    
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
      tags: tags as string[],
      a2aEndpoint: a2aEndpoint as string,
      mcpEndpoint: mcpEndpoint as string,
    };
  }

  /**
   * Get profiles for multiple agents
   */
  async getAgentProfiles(agentIds: bigint[]): Promise<AgentProfile[]> {
    const profiles = await Promise.all(agentIds.map(id => this.getAgentProfile(id)));
    return profiles.filter((p): p is AgentProfile => p !== null);
  }

  /**
   * Get voting power for an address
   */
  async getVotingPower(voter: string, agentId: bigint, baseVotes: bigint): Promise<VotingPower> {
    if (this.integration) {
      const power = await this.integration.getVotingPower(voter, agentId, baseVotes);
      return {
        baseVotes: power.baseVotes,
        reputationMultiplier: Number(power.reputationMultiplier),
        stakeMultiplier: Number(power.stakeMultiplier),
        effectiveVotes: power.effectiveVotes,
      };
    }
    
    // Fallback calculation
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

  // ============================================================================
  // Provider Reputation
  // ============================================================================

  /**
   * Get all provider reputations
   */
  async getAllProviderReputations(): Promise<ProviderReputation[]> {
    if (!this.integration) return [];
    
    const reps = await this.integration.getAllProviderReputations();
    return reps.map((r: Record<string, unknown>) => ({
      provider: r.provider as string,
      providerAgentId: r.providerAgentId as bigint,
      stakeAmount: r.stakeAmount as bigint,
      stakeTime: Number(r.stakeTime),
      averageReputation: Number(r.averageReputation),
      violationsReported: Number(r.violationsReported),
      operatorCount: Number(r.operatorCount),
      lastUpdated: Number(r.lastUpdated),
      weightedScore: Number(r.weightedScore),
    }));
  }

  /**
   * Get weighted reputation for an agent across all providers
   */
  async getWeightedAgentReputation(agentId: bigint): Promise<{ reputation: number; weight: number }> {
    if (!this.integration) {
      const [, avg] = await this.reputation.getSummary(agentId, [], '0x' + '0'.repeat(64), '0x' + '0'.repeat(64));
      return { reputation: Number(avg), weight: 100 };
    }
    
    const [rep, weight] = await this.integration.getWeightedAgentReputation(agentId);
    return { reputation: Number(rep), weight: Number(weight) };
  }

  // ============================================================================
  // Search & Discovery
  // ============================================================================

  /**
   * Search agents by tag
   */
  async searchByTag(tag: string, offset = 0, limit = 50): Promise<SearchResult> {
    if (this.integration) {
      const result = await this.integration.searchByTag(tag, offset, limit);
      return {
        agentIds: result.agentIds.map((id: bigint) => id),
        total: Number(result.total),
        offset: Number(result.offset),
        limit: Number(result.limit),
      };
    }
    
    const agentIds = await this.identity.getAgentsByTag(tag);
    const total = agentIds.length;
    const sliced = agentIds.slice(offset, offset + limit);
    
    return {
      agentIds: sliced.map((id: bigint) => id),
      total,
      offset,
      limit,
    };
  }

  /**
   * Get agents by minimum score
   */
  async getAgentsByScore(minScore: number, offset = 0, limit = 50): Promise<{ agentIds: bigint[]; scores: number[] }> {
    if (this.integration) {
      const [agentIds, scores] = await this.integration.getAgentsByScore(minScore, offset, limit);
      return {
        agentIds: agentIds.map((id: bigint) => id),
        scores: scores.map((s: bigint) => Number(s)),
      };
    }
    
    // Fallback: get all active agents and filter
    const allAgents = await this.identity.getActiveAgents(0, 500);
    const profiles = await this.getAgentProfiles(allAgents);
    
    const filtered = profiles
      .filter(p => p.compositeScore >= minScore && !p.isBanned)
      .slice(offset, offset + limit);
    
    return {
      agentIds: filtered.map(p => p.agentId),
      scores: filtered.map(p => p.compositeScore),
    };
  }

  /**
   * Get top agents by composite score
   */
  async getTopAgents(count = 10): Promise<AgentProfile[]> {
    if (this.integration) {
      const profiles = await this.integration.getTopAgents(count);
      return profiles.map((p: Record<string, unknown>) => this._parseProfile(p));
    }
    
    const allAgents = await this.identity.getActiveAgents(0, 200);
    const profiles = await this.getAgentProfiles(allAgents);
    
    return profiles
      .filter(p => !p.isBanned)
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, count);
  }

  /**
   * Get all active agents
   */
  async getActiveAgents(offset = 0, limit = 100): Promise<bigint[]> {
    return await this.identity.getActiveAgents(offset, limit);
  }

  /**
   * Get total agent count
   */
  async getTotalAgents(): Promise<number> {
    return Number(await this.identity.totalAgents());
  }

  // ============================================================================
  // Eligibility Checks
  // ============================================================================

  /**
   * Check if agent can submit proposals
   */
  async canSubmitProposal(agentId: bigint): Promise<EligibilityResult> {
    if (this.integration) {
      const [eligible, reason] = await this.integration.canSubmitProposal(agentId);
      return { eligible, reason };
    }
    
    const profile = await this.getAgentProfile(agentId);
    if (!profile) return { eligible: false, reason: 'Agent does not exist' };
    if (profile.isBanned) return { eligible: false, reason: 'Agent is banned' };
    if (profile.compositeScore < 50) return { eligible: false, reason: 'Composite score too low' };
    return { eligible: true, reason: '' };
  }

  /**
   * Check if agent can vote
   */
  async canVote(agentId: bigint): Promise<EligibilityResult> {
    if (this.integration) {
      const [eligible, reason] = await this.integration.canVote(agentId);
      return { eligible, reason };
    }
    
    const profile = await this.getAgentProfile(agentId);
    if (!profile) return { eligible: false, reason: 'Agent does not exist' };
    if (profile.isBanned) return { eligible: false, reason: 'Agent is banned' };
    if (profile.compositeScore < 30) return { eligible: false, reason: 'Composite score too low' };
    return { eligible: true, reason: '' };
  }

  /**
   * Check if agent can conduct research
   */
  async canConductResearch(agentId: bigint): Promise<EligibilityResult> {
    if (this.integration) {
      const [eligible, reason] = await this.integration.canConductResearch(agentId);
      return { eligible, reason };
    }
    
    const profile = await this.getAgentProfile(agentId);
    if (!profile) return { eligible: false, reason: 'Agent does not exist' };
    if (profile.isBanned) return { eligible: false, reason: 'Agent is banned' };
    if (profile.stakeTier < 2) return { eligible: false, reason: 'Insufficient stake tier' };
    if (profile.compositeScore < 70) return { eligible: false, reason: 'Composite score too low' };
    return { eligible: true, reason: '' };
  }

  // ============================================================================
  // Delegation Queries
  // ============================================================================

  /**
   * Get delegate info
   */
  async getDelegate(address: string) {
    if (!this.delegation) return null;
    const d = await this.delegation.getDelegate(address);
    if (d.registeredAt === 0n) return null;
    return {
      delegate: d.delegate as string,
      agentId: d.agentId as bigint,
      name: d.name as string,
      profileHash: d.profileHash as string,
      expertise: d.expertise as string[],
      totalDelegated: d.totalDelegated as bigint,
      delegatorCount: Number(d.delegatorCount),
      registeredAt: Number(d.registeredAt),
      isActive: d.isActive as boolean,
      proposalsVoted: Number(d.proposalsVoted),
      proposalsCreated: Number(d.proposalsCreated),
    };
  }

  /**
   * Get top delegates
   */
  async getTopDelegates(limit = 10) {
    if (!this.delegation) return [];
    const delegates = await this.delegation.getTopDelegates(limit);
    return delegates.map((d: Record<string, unknown>) => ({
      delegate: d.delegate as string,
      agentId: d.agentId as bigint,
      name: d.name as string,
      totalDelegated: d.totalDelegated as bigint,
      delegatorCount: Number(d.delegatorCount),
      isActive: d.isActive as boolean,
    }));
  }

  /**
   * Get security council
   */
  async getSecurityCouncil() {
    if (!this.delegation) return [];
    const details = await this.delegation.getSecurityCouncilDetails();
    return details.map((m: Record<string, unknown>) => ({
      member: m.member as string,
      agentId: m.agentId as bigint,
      combinedScore: Number(m.combinedScore),
      electedAt: Number(m.electedAt),
    }));
  }

  /**
   * Check if address is security council member
   */
  async isSecurityCouncilMember(address: string): Promise<boolean> {
    if (!this.delegation) return false;
    return await this.delegation.isSecurityCouncilMember(address);
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

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
