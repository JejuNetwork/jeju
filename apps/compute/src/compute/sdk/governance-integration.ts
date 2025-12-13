/**
 * Governance Integration for Compute SDK
 * 
 * Integrates the compute marketplace with the AI DAO council:
 * - Report violations to the council for review
 * - Check agent eligibility before providing service
 * - Track reputation from governance decisions
 * - Participate in provider-related proposals
 */

import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from 'ethers';

// ============================================================================
// Types
// ============================================================================

export enum ViolationType {
  API_ABUSE = 0,
  RESOURCE_EXPLOITATION = 1,
  SCAMMING = 2,
  PHISHING = 3,
  HACKING = 4,
  UNAUTHORIZED_ACCESS = 5,
  DATA_THEFT = 6,
  ILLEGAL_CONTENT = 7,
  HARASSMENT = 8,
  SPAM = 9,
  TOS_VIOLATION = 10,
}

export interface AgentProfile {
  agentId: bigint;
  owner: string;
  stakeTier: number;
  stakedAmount: bigint;
  isBanned: boolean;
  averageReputation: number;
  compositeScore: number;
  violationCount: number;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
}

export interface ViolationReport {
  agentId: bigint;
  violationType: ViolationType;
  severityScore: number;
  evidence: string;
  reportedAt: number;
  proposalId?: string;
}

export interface GovernanceIntegrationConfig {
  rpcUrl: string;
  councilApiUrl?: string;
  registryIntegrationAddress?: string;
  identityRegistryAddress?: string;
  reputationProviderAddress?: string;
  privateKey?: string;
}

// ============================================================================
// ABIs
// ============================================================================

const REGISTRY_INTEGRATION_ABI = [
  'function getAgentProfile(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, uint8 stakeTier, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, uint64 feedbackCount, uint8 averageReputation, uint256 violationCount, uint256 compositeScore, string[] tags, string a2aEndpoint, string mcpEndpoint))',
  'function canSubmitProposal(uint256 agentId) external view returns (bool eligible, string reason)',
  'function canVote(uint256 agentId) external view returns (bool eligible, string reason)',
  'function canConductResearch(uint256 agentId) external view returns (bool eligible, string reason)',
  'function getVotingPower(address voter, uint256 agentId, uint256 baseVotes) external view returns (tuple(uint256 baseVotes, uint256 reputationMultiplier, uint256 stakeMultiplier, uint256 effectiveVotes))',
] as const;

const REPUTATION_PROVIDER_ABI = [
  'function recordViolation(uint256 agentId, uint8 violationType, uint8 severityScore, string evidence) external',
  'function requestBanViaGovernance(uint256 agentId, uint8 reason) external payable returns (bytes32 proposalId)',
  'function getAgentViolationCount(uint256 agentId) external view returns (uint256)',
  'function isAuthorizedOperator(address operator) external view returns (bool)',
] as const;

const IDENTITY_REGISTRY_ABI = [
  'function agentExists(uint256 agentId) external view returns (bool)',
  'function ownerOf(uint256 agentId) external view returns (address)',
  'function getAgent(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed))',
] as const;

// ============================================================================
// Council API Client
// ============================================================================

async function fetchCouncilApi<T>(
  baseUrl: string,
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  
  if (!response.ok) {
    throw new Error(`Council API error: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data as T;
}

// ============================================================================
// Governance Integration SDK
// ============================================================================

export class GovernanceIntegration {
  private provider: JsonRpcProvider;
  private signer: Wallet | null;
  private registryIntegration: Contract | null = null;
  private reputationProvider: Contract | null = null;
  private identityRegistry: Contract | null = null;
  private councilApiUrl: string;

  constructor(config: GovernanceIntegrationConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.signer = config.privateKey 
      ? new Wallet(config.privateKey, this.provider) 
      : null;
    this.councilApiUrl = config.councilApiUrl || 'http://localhost:8010';

    const signerOrProvider = this.signer || this.provider;

    if (config.registryIntegrationAddress) {
      this.registryIntegration = new Contract(
        config.registryIntegrationAddress,
        REGISTRY_INTEGRATION_ABI,
        signerOrProvider
      );
    }

    if (config.reputationProviderAddress) {
      this.reputationProvider = new Contract(
        config.reputationProviderAddress,
        REPUTATION_PROVIDER_ABI,
        signerOrProvider
      );
    }

    if (config.identityRegistryAddress) {
      this.identityRegistry = new Contract(
        config.identityRegistryAddress,
        IDENTITY_REGISTRY_ABI,
        signerOrProvider
      );
    }
  }

  // ============================================================================
  // Agent Verification
  // ============================================================================

  /**
   * Check if an agent is allowed to use compute services
   * Uses on-chain registry if available, falls back to API
   */
  async checkAgentEligibility(agentId: bigint): Promise<EligibilityResult> {
    // Try on-chain first
    if (this.identityRegistry) {
      const exists = await this.identityRegistry.agentExists(agentId);
      if (!exists) {
        return { eligible: false, reason: 'Agent does not exist' };
      }

      const agent = await this.identityRegistry.getAgent(agentId);
      if (agent.isBanned) {
        return { eligible: false, reason: 'Agent is banned' };
      }
    }

    // Check via council API for composite score
    const profile = await this.getAgentProfile(agentId);
    if (!profile) {
      return { eligible: false, reason: 'Agent not found' };
    }

    if (profile.isBanned) {
      return { eligible: false, reason: 'Agent is banned from the network' };
    }

    // Require minimum composite score of 30 for compute access
    if (profile.compositeScore < 30) {
      return { 
        eligible: false, 
        reason: `Composite score too low (${profile.compositeScore}/30 required)` 
      };
    }

    return { eligible: true, reason: '' };
  }

  /**
   * Get comprehensive agent profile with reputation data
   */
  async getAgentProfile(agentId: bigint): Promise<AgentProfile | null> {
    // Try on-chain registry integration first
    if (this.registryIntegration) {
      const profile = await this.registryIntegration.getAgentProfile(agentId);
      if (profile.agentId === BigInt(0)) return null;
      
      return {
        agentId: profile.agentId,
        owner: profile.owner,
        stakeTier: Number(profile.stakeTier),
        stakedAmount: profile.stakedAmount,
        isBanned: profile.isBanned,
        averageReputation: Number(profile.averageReputation),
        compositeScore: Number(profile.compositeScore),
        violationCount: Number(profile.violationCount),
      };
    }

    // Fall back to council API
    const response = await fetchCouncilApi<{
      agentId: string;
      owner: string;
      stakeTier: number;
      stakedAmount: string;
      isBanned: boolean;
      averageReputation: number;
      compositeScore: number;
      violationCount: number;
    }>(this.councilApiUrl, `/api/v1/registry/profile/${agentId}`).catch(() => null);

    if (!response) return null;

    return {
      agentId: BigInt(response.agentId),
      owner: response.owner,
      stakeTier: response.stakeTier,
      stakedAmount: BigInt(response.stakedAmount),
      isBanned: response.isBanned,
      averageReputation: response.averageReputation,
      compositeScore: response.compositeScore,
      violationCount: response.violationCount,
    };
  }

  // ============================================================================
  // Violation Reporting
  // ============================================================================

  /**
   * Report a violation to the governance system
   * Records on-chain via ReputationProvider if available
   */
  async reportViolation(
    agentId: bigint,
    violationType: ViolationType,
    severityScore: number,
    evidence: string
  ): Promise<ViolationReport> {
    if (severityScore < 0 || severityScore > 100) {
      throw new Error('Severity score must be 0-100');
    }

    const report: ViolationReport = {
      agentId,
      violationType,
      severityScore,
      evidence,
      reportedAt: Date.now(),
    };

    // Record on-chain if reputation provider is available
    if (this.reputationProvider && this.signer) {
      const tx = await this.reputationProvider.recordViolation(
        agentId,
        violationType,
        severityScore,
        evidence
      );
      await tx.wait();
    }

    // Also report via council API for tracking
    await fetchCouncilApi(
      this.councilApiUrl,
      '/api/v1/moderation/flag',
      {
        method: 'POST',
        body: JSON.stringify({
          proposalId: `violation-${agentId}-${Date.now()}`,
          flagger: this.signer?.address || 'anonymous',
          flagType: this.violationTypeToFlagType(violationType),
          reason: `${ViolationType[violationType]}: ${evidence}`,
          stake: Math.min(severityScore, 100),
          evidence,
        }),
      }
    ).catch(() => null); // Non-critical

    return report;
  }

  /**
   * Request a ban proposal through governance
   * Creates a futarchy market for community decision
   */
  async requestBanProposal(
    agentId: bigint,
    violationType: ViolationType,
    bondAmount: bigint = BigInt('1000000000000000') // 0.001 ETH default
  ): Promise<{ proposalId: string; txHash: string }> {
    if (!this.reputationProvider || !this.signer) {
      throw new Error('Reputation provider and signer required for ban proposals');
    }

    const tx = await this.reputationProvider.requestBanViaGovernance(
      agentId,
      violationType,
      { value: bondAmount }
    );
    const receipt = await tx.wait();

    // Extract proposal ID from event
    const proposalId = receipt.logs[0]?.topics[2] || 
      keccak256(toUtf8Bytes(`ban-${agentId}-${Date.now()}`));

    return {
      proposalId: proposalId.toString(),
      txHash: receipt.hash,
    };
  }

  /**
   * Get violation count for an agent
   */
  async getViolationCount(agentId: bigint): Promise<number> {
    if (this.reputationProvider) {
      const count = await this.reputationProvider.getAgentViolationCount(agentId);
      return Number(count);
    }

    // Fall back to profile data
    const profile = await this.getAgentProfile(agentId);
    return profile?.violationCount || 0;
  }

  // ============================================================================
  // Provider Registration Helpers
  // ============================================================================

  /**
   * Check if a provider can register with governance requirements
   */
  async canProviderRegister(agentId: bigint): Promise<EligibilityResult> {
    const profile = await this.getAgentProfile(agentId);
    
    if (!profile) {
      return { eligible: false, reason: 'Must have a registered agent' };
    }

    if (profile.isBanned) {
      return { eligible: false, reason: 'Agent is banned' };
    }

    if (profile.stakeTier < 1) {
      return { eligible: false, reason: 'Minimum SMALL stake tier required' };
    }

    if (profile.compositeScore < 50) {
      return { 
        eligible: false, 
        reason: `Composite score too low (${profile.compositeScore}/50 required)` 
      };
    }

    return { eligible: true, reason: '' };
  }

  /**
   * Get voting power for a provider in governance
   */
  async getProviderVotingPower(
    providerAddress: string,
    agentId: bigint,
    baseVotes: bigint
  ): Promise<{
    baseVotes: bigint;
    reputationMultiplier: number;
    stakeMultiplier: number;
    effectiveVotes: bigint;
  }> {
    if (this.registryIntegration) {
      const power = await this.registryIntegration.getVotingPower(
        providerAddress,
        agentId,
        baseVotes
      );
      return {
        baseVotes: power.baseVotes,
        reputationMultiplier: Number(power.reputationMultiplier),
        stakeMultiplier: Number(power.stakeMultiplier),
        effectiveVotes: power.effectiveVotes,
      };
    }

    // Fall back to API
    const response = await fetchCouncilApi<{
      baseVotes: string;
      reputationMultiplier: number;
      stakeMultiplier: number;
      effectiveVotes: string;
    }>(
      this.councilApiUrl,
      `/api/v1/registry/voting-power/${providerAddress}?agentId=${agentId}&baseVotes=${baseVotes}`
    );

    return {
      baseVotes: BigInt(response.baseVotes),
      reputationMultiplier: response.reputationMultiplier,
      stakeMultiplier: response.stakeMultiplier,
      effectiveVotes: BigInt(response.effectiveVotes),
    };
  }

  // ============================================================================
  // Governance Proposals
  // ============================================================================

  /**
   * Get active proposals related to compute marketplace
   */
  async getComputeProposals(): Promise<Array<{
    proposalId: string;
    title: string;
    status: string;
    proposalType: string;
    createdAt: number;
  }>> {
    const response = await fetchCouncilApi<{
      proposals: Array<{
        proposalId: string;
        contentHash: string;
        status: number;
        proposalType: number;
        createdAt: number;
      }>;
    }>(this.councilApiUrl, '/api/v1/proposals?active=true');

    // Filter for compute-related proposals (types 2, 3, 4, 5)
    const computeTypes = [2, 3, 4, 5]; // CODE_UPGRADE, HIRE_CONTRACTOR, FIRE_CONTRACTOR, BOUNTY
    
    return response.proposals
      .filter(p => computeTypes.includes(p.proposalType))
      .map(p => ({
        proposalId: p.proposalId,
        title: `Proposal ${p.proposalId.slice(0, 8)}...`,
        status: this.statusToString(p.status),
        proposalType: this.typeToString(p.proposalType),
        createdAt: p.createdAt,
      }));
  }

  /**
   * Check security council status
   */
  async isSecurityCouncilMember(address: string): Promise<boolean> {
    const response = await fetchCouncilApi<{ isMember: boolean }>(
      this.councilApiUrl,
      `/api/v1/registry/is-council-member/${address}`
    );
    return response.isMember;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private violationTypeToFlagType(type: ViolationType): string {
    switch (type) {
      case ViolationType.SPAM: return 'spam';
      case ViolationType.SCAMMING:
      case ViolationType.PHISHING: return 'scam';
      case ViolationType.HACKING:
      case ViolationType.UNAUTHORIZED_ACCESS:
      case ViolationType.DATA_THEFT: return 'harmful';
      default: return 'other';
    }
  }

  private statusToString(status: number): string {
    const statuses = [
      'SUBMITTED', 'COUNCIL_REVIEW', 'RESEARCH_PENDING', 'COUNCIL_FINAL',
      'CEO_QUEUE', 'APPROVED', 'EXECUTING', 'COMPLETED', 'REJECTED',
      'VETOED', 'FUTARCHY_PENDING', 'FUTARCHY_APPROVED', 'FUTARCHY_REJECTED',
      'DUPLICATE', 'SPAM'
    ];
    return statuses[status] || 'UNKNOWN';
  }

  private typeToString(type: number): string {
    const types = [
      'PARAMETER_CHANGE', 'TREASURY_ALLOCATION', 'CODE_UPGRADE',
      'HIRE_CONTRACTOR', 'FIRE_CONTRACTOR', 'BOUNTY', 'GRANT',
      'PARTNERSHIP', 'POLICY', 'EMERGENCY'
    ];
    return types[type] || 'UNKNOWN';
  }

  /**
   * Check if this SDK has write capabilities
   */
  hasWriteAccess(): boolean {
    return this.signer !== null;
  }

  /**
   * Get the signer address
   */
  getSignerAddress(): string | null {
    return this.signer?.address || null;
  }
}

// ============================================================================
// Factory
// ============================================================================

let instance: GovernanceIntegration | null = null;

export function getGovernanceIntegration(
  config: GovernanceIntegrationConfig
): GovernanceIntegration {
  if (!instance) {
    instance = new GovernanceIntegration(config);
  }
  return instance;
}

export function resetGovernanceIntegration(): void {
  instance = null;
}

/**
 * Create governance integration from environment variables
 */
export function createGovernanceIntegrationFromEnv(): GovernanceIntegration {
  return new GovernanceIntegration({
    rpcUrl: process.env.RPC_URL || 'http://localhost:8545',
    councilApiUrl: process.env.COUNCIL_API_URL || 'http://localhost:8010',
    registryIntegrationAddress: process.env.REGISTRY_INTEGRATION_ADDRESS,
    identityRegistryAddress: process.env.IDENTITY_REGISTRY_ADDRESS,
    reputationProviderAddress: process.env.REPUTATION_PROVIDER_ADDRESS,
    privateKey: process.env.COMPUTE_OPERATOR_KEY || process.env.PRIVATE_KEY,
  });
}
