/**
 * Governance Integration for Storage API
 * 
 * Integrates the storage service with the AI DAO council:
 * - Check agent eligibility before storing content
 * - Report content violations
 * - Track storage provider reputation
 * - Participate in storage-related governance
 */

import { type Address, createPublicClient, http, parseAbi } from 'viem';

// ============================================================================
// Types
// ============================================================================

export enum ContentViolationType {
  ILLEGAL_CONTENT = 0,
  COPYRIGHT_INFRINGEMENT = 1,
  MALWARE = 2,
  SPAM = 3,
  HARASSMENT = 4,
  PRIVACY_VIOLATION = 5,
  TOS_VIOLATION = 6,
}

export interface AgentProfile {
  agentId: string;
  owner: string;
  stakeTier: number;
  stakedAmount: string;
  isBanned: boolean;
  averageReputation: number;
  compositeScore: number;
  violationCount: number;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
}

export interface StorageProvider {
  address: string;
  agentId: string;
  endpoint: string;
  active: boolean;
  verified: boolean;
  compositeScore: number;
}

// ============================================================================
// Configuration
// ============================================================================

const COUNCIL_API_URL = process.env.COUNCIL_API_URL || 'http://localhost:8010';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

const JEJU_CHAIN = {
  id: parseInt(process.env.CHAIN_ID || '1337'),
  name: 'Jeju',
  network: 'jeju',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [process.env.RPC_URL || 'http://localhost:8545'] },
    public: { http: [process.env.RPC_URL || 'http://localhost:8545'] },
  },
} as const;

const IDENTITY_REGISTRY_ADDRESS = (process.env.IDENTITY_REGISTRY_ADDRESS || ZERO_ADDRESS) as Address;

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function agentExists(uint256 agentId) external view returns (bool)',
  'function ownerOf(uint256 agentId) external view returns (address)',
  'function getAgent(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed))',
]);

// ============================================================================
// Client
// ============================================================================

function getPublicClient() {
  return createPublicClient({
    chain: JEJU_CHAIN,
    transport: http(),
  });
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchCouncilApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${COUNCIL_API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  
  if (!response.ok) {
    throw new Error(`Council API error: ${response.statusText}`);
  }
  
  return response.json();
}

// ============================================================================
// Agent Verification
// ============================================================================

/**
 * Check if an agent is allowed to use storage services
 */
export async function checkStorageEligibility(agentId: string): Promise<EligibilityResult> {
  // First check on-chain ban status
  if (IDENTITY_REGISTRY_ADDRESS !== ZERO_ADDRESS) {
    const client = getPublicClient();
    
    const exists = await client.readContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'agentExists',
      args: [BigInt(agentId)],
    }).catch(() => false);

    if (!exists) {
      return { eligible: false, reason: 'Agent does not exist' };
    }

    const agent = await client.readContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgent',
      args: [BigInt(agentId)],
    }).catch(() => null);

    if (agent && agent.isBanned) {
      return { eligible: false, reason: 'Agent is banned from the network' };
    }
  }

  // Check composite score via council API
  const profile = await getAgentProfile(agentId);
  
  if (!profile) {
    return { eligible: false, reason: 'Agent not found' };
  }

  if (profile.isBanned) {
    return { eligible: false, reason: 'Agent is banned' };
  }

  // Require minimum composite score for storage access
  if (profile.compositeScore < 20) {
    return { 
      eligible: false, 
      reason: `Composite score too low (${profile.compositeScore}/20 required)` 
    };
  }

  return { eligible: true, reason: '' };
}

/**
 * Get agent profile from council
 */
export async function getAgentProfile(agentId: string): Promise<AgentProfile | null> {
  return fetchCouncilApi<AgentProfile>(`/api/v1/registry/profile/${agentId}`)
    .catch(() => null);
}

/**
 * Get weighted reputation for an agent
 */
export async function getWeightedReputation(agentId: string): Promise<{ reputation: number; weight: number }> {
  return fetchCouncilApi<{ reputation: number; weight: number }>(
    `/api/v1/registry/weighted-reputation/${agentId}`
  ).catch(() => ({ reputation: 0, weight: 0 }));
}

// ============================================================================
// Content Moderation
// ============================================================================

/**
 * Report content violation to governance
 */
export async function reportContentViolation(params: {
  contentCid: string;
  uploaderAddress: string;
  uploaderAgentId?: string;
  violationType: ContentViolationType;
  severity: number;
  evidence: string;
}): Promise<{ flagId: string; success: boolean }> {
  const flagType = violationTypeToFlagType(params.violationType);
  
  const result = await fetchCouncilApi<{ flagId: string }>(
    '/api/v1/moderation/flag',
    {
      method: 'POST',
      body: JSON.stringify({
        proposalId: `content-${params.contentCid}`,
        flagger: params.uploaderAddress,
        flagType,
        reason: `Content violation: ${ContentViolationType[params.violationType]} - CID: ${params.contentCid}`,
        stake: Math.min(params.severity, 100),
        evidence: params.evidence,
      }),
    }
  );

  return { flagId: result.flagId, success: true };
}

/**
 * Check if content should be rejected based on uploader reputation
 */
export async function shouldRejectContent(
  uploaderAddress: string,
  uploaderAgentId?: string
): Promise<{ reject: boolean; reason?: string }> {
  // If agent ID provided, check agent eligibility
  if (uploaderAgentId) {
    const eligibility = await checkStorageEligibility(uploaderAgentId);
    if (!eligibility.eligible) {
      return { reject: true, reason: eligibility.reason };
    }
  }

  // Check moderation flags for the uploader
  const response = await fetchCouncilApi<{ shouldReject: boolean; reasons: string[] }>(
    `/api/v1/moderation/should-reject/${uploaderAddress}`
  ).catch(() => ({ shouldReject: false, reasons: [] }));

  if (response.shouldReject) {
    return { reject: true, reason: response.reasons.join(', ') };
  }

  return { reject: false };
}

// ============================================================================
// Provider Discovery
// ============================================================================

/**
 * Get storage providers sorted by composite score
 */
export async function getTopStorageProviders(count = 10): Promise<StorageProvider[]> {
  // Search for agents tagged as 'storage'
  const result = await fetchCouncilApi<{ agentIds: string[] }>(
    `/api/v1/registry/search/tag/storage?limit=${count * 2}`
  ).catch(() => ({ agentIds: [] }));

  if (result.agentIds.length === 0) {
    return [];
  }

  // Get profiles for these agents
  const profilesResult = await fetchCouncilApi<{ profiles: AgentProfile[] }>(
    '/api/v1/registry/profiles',
    {
      method: 'POST',
      body: JSON.stringify({ agentIds: result.agentIds }),
    }
  ).catch(() => ({ profiles: [] }));

  // Sort by composite score and return top N
  return profilesResult.profiles
    .filter(p => !p.isBanned && p.compositeScore >= 30)
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, count)
    .map(p => ({
      address: p.owner,
      agentId: p.agentId,
      endpoint: '', // Would need to fetch from registry
      active: true,
      verified: p.stakeTier >= 2,
      compositeScore: p.compositeScore,
    }));
}

/**
 * Get provider reputation for pricing/priority decisions
 */
export async function getProviderReputation(agentId: string): Promise<{
  score: number;
  tier: 'basic' | 'verified' | 'premium';
  discount: number;
}> {
  const profile = await getAgentProfile(agentId);
  
  if (!profile) {
    return { score: 0, tier: 'basic', discount: 0 };
  }

  // Determine tier based on composite score and stake
  let tier: 'basic' | 'verified' | 'premium' = 'basic';
  let discount = 0;

  if (profile.compositeScore >= 80 && profile.stakeTier >= 3) {
    tier = 'premium';
    discount = 20; // 20% discount
  } else if (profile.compositeScore >= 60 && profile.stakeTier >= 2) {
    tier = 'verified';
    discount = 10; // 10% discount
  }

  return {
    score: profile.compositeScore,
    tier,
    discount,
  };
}

// ============================================================================
// Governance Participation
// ============================================================================

/**
 * Get storage-related governance proposals
 */
export async function getStorageProposals(): Promise<Array<{
  proposalId: string;
  title: string;
  status: string;
  createdAt: number;
}>> {
  const response = await fetchCouncilApi<{
    proposals: Array<{
      proposalId: string;
      status: number;
      proposalType: number;
      createdAt: number;
    }>;
  }>('/api/v1/proposals?active=true');

  // Filter for storage-related proposals (POLICY type often includes storage)
  return response.proposals
    .filter(p => [1, 8].includes(p.proposalType)) // TREASURY_ALLOCATION, POLICY
    .map(p => ({
      proposalId: p.proposalId,
      title: `Proposal ${p.proposalId.slice(0, 8)}...`,
      status: statusToString(p.status),
      createdAt: p.createdAt,
    }));
}

/**
 * Check if address is security council member
 */
export async function isSecurityCouncilMember(address: string): Promise<boolean> {
  const response = await fetchCouncilApi<{ isMember: boolean }>(
    `/api/v1/registry/is-council-member/${address}`
  ).catch(() => ({ isMember: false }));
  return response.isMember;
}

/**
 * Get governance health status
 */
export async function getGovernanceHealth(): Promise<{
  available: boolean;
  version: string;
  registryActive: boolean;
}> {
  const health = await fetchCouncilApi<{
    status: string;
    version: string;
    erc8004: { identity: boolean; reputation: boolean };
    registry: { integration: boolean };
  }>('/health').catch(() => null);

  if (!health) {
    return { available: false, version: '0.0.0', registryActive: false };
  }

  return {
    available: health.status === 'ok',
    version: health.version,
    registryActive: health.registry?.integration ?? false,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function violationTypeToFlagType(type: ContentViolationType): string {
  switch (type) {
    case ContentViolationType.SPAM: return 'spam';
    case ContentViolationType.ILLEGAL_CONTENT:
    case ContentViolationType.MALWARE: return 'harmful';
    case ContentViolationType.COPYRIGHT_INFRINGEMENT: return 'other';
    case ContentViolationType.HARASSMENT: return 'harmful';
    default: return 'other';
  }
}

function statusToString(status: number): string {
  const statuses = [
    'SUBMITTED', 'COUNCIL_REVIEW', 'RESEARCH_PENDING', 'COUNCIL_FINAL',
    'CEO_QUEUE', 'APPROVED', 'EXECUTING', 'COMPLETED', 'REJECTED',
    'VETOED', 'FUTARCHY_PENDING', 'FUTARCHY_APPROVED', 'FUTARCHY_REJECTED',
    'DUPLICATE', 'SPAM'
  ];
  return statuses[status] || 'UNKNOWN';
}
