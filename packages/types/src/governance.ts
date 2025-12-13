/**
 * Shared Governance Types for AI DAO
 * 
 * Used across all apps for consistent governance integration
 */

// ============================================================================
// Proposal Types
// ============================================================================

export enum ProposalType {
  PARAMETER_CHANGE = 0,
  TREASURY_ALLOCATION = 1,
  CODE_UPGRADE = 2,
  HIRE_CONTRACTOR = 3,
  FIRE_CONTRACTOR = 4,
  BOUNTY = 5,
  GRANT = 6,
  PARTNERSHIP = 7,
  POLICY = 8,
  EMERGENCY = 9,
}

export enum ProposalStatus {
  SUBMITTED = 0,
  COUNCIL_REVIEW = 1,
  RESEARCH_PENDING = 2,
  COUNCIL_FINAL = 3,
  CEO_QUEUE = 4,
  APPROVED = 5,
  EXECUTING = 6,
  COMPLETED = 7,
  REJECTED = 8,
  VETOED = 9,
  FUTARCHY_PENDING = 10,
  FUTARCHY_APPROVED = 11,
  FUTARCHY_REJECTED = 12,
  DUPLICATE = 13,
  SPAM = 14,
}

export enum CouncilRole {
  TREASURY = 0,
  CODE = 1,
  COMMUNITY = 2,
  SECURITY = 3,
}

export enum VoteType {
  APPROVE = 0,
  REJECT = 1,
  ABSTAIN = 2,
  REQUEST_CHANGES = 3,
}

export enum VetoCategory {
  ALREADY_DONE = 0,
  DUPLICATE = 1,
  IMPOSSIBLE = 2,
  HARMFUL = 3,
  MISALIGNED = 4,
  INSUFFICIENT_INFO = 5,
  OTHER = 6,
}

// ============================================================================
// Agent & Reputation Types
// ============================================================================

export enum StakeTier {
  NONE = 0,
  SMALL = 1,
  MEDIUM = 2,
  HIGH = 3,
}

export interface AgentProfile {
  agentId: string;
  owner: string;
  stakeTier: StakeTier;
  stakedAmount: string;
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
  providerAgentId: string;
  stakeAmount: string;
  stakeTime: number;
  averageReputation: number;
  violationsReported: number;
  operatorCount: number;
  lastUpdated: number;
  weightedScore: number;
}

// ============================================================================
// Voting Types
// ============================================================================

export interface VotingPower {
  baseVotes: string;
  reputationMultiplier: number; // 100 = 1x, 200 = 2x
  stakeMultiplier: number;      // 100 = 1x, 200 = 2x
  effectiveVotes: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reason: string;
}

export interface Eligibility {
  agentId: string;
  canSubmitProposal: EligibilityResult;
  canVote: EligibilityResult;
  canConductResearch: EligibilityResult;
}

// ============================================================================
// Proposal Types
// ============================================================================

export interface Proposal {
  proposalId: string;
  proposer: string;
  proposerAgentId: string;
  proposalType: ProposalType;
  status: ProposalStatus;
  qualityScore: number;
  createdAt: number;
  councilVoteEnd: number;
  gracePeriodEnd: number;
  contentHash: string;
  targetContract: string;
  callData: string;
  value: string;
  totalStaked: string;
  totalReputation: string;
  backerCount: number;
  hasResearch: boolean;
  researchHash: string;
  ceoApproved: boolean;
  ceoDecisionHash: string;
}

export interface CouncilVote {
  proposalId: string;
  councilAgent: string;
  role: CouncilRole;
  vote: VoteType;
  reasoningHash: string;
  votedAt: number;
  weight: number;
}

export interface BackerInfo {
  backer: string;
  agentId: string;
  stakedAmount: string;
  reputationWeight: string;
  backedAt: number;
}

export interface VetoVote {
  voter: string;
  agentId: string;
  category: VetoCategory;
  reasonHash: string;
  stakedAmount: string;
  reputationWeight: string;
  votedAt: number;
}

// ============================================================================
// Delegation Types
// ============================================================================

export interface Delegate {
  delegate: string;
  agentId: string;
  name: string;
  profileHash: string;
  expertise: string[];
  totalDelegated: string;
  delegatorCount: number;
  registeredAt: number;
  isActive: boolean;
  proposalsVoted: number;
  proposalsCreated: number;
}

export interface VoteDelegation {
  delegator: string;
  delegate: string;
  amount: string;
  delegatedAt: number;
  lockedUntil: number;
}

export interface SecurityCouncilMember {
  member: string;
  agentId: string;
  combinedScore: number;
  electedAt: number;
}

// ============================================================================
// Moderation Types
// ============================================================================

export enum FlagType {
  SPAM = 'spam',
  DUPLICATE = 'duplicate',
  HARMFUL = 'harmful',
  SCAM = 'scam',
  LOW_QUALITY = 'low-quality',
  MISALIGNED = 'misaligned',
  OTHER = 'other',
}

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

export interface ProposalFlag {
  flagId: string;
  proposalId: string;
  flagger: string;
  flagType: FlagType;
  reason: string;
  stake: number;
  evidence?: string;
  upvotes: number;
  downvotes: number;
  resolved: boolean;
  upheld: boolean;
  createdAt: number;
}

export interface ModerationScore {
  proposalId: string;
  totalFlags: number;
  activeFlags: number;
  upheldFlags: number;
  overallScore: number;
  shouldReject: boolean;
  reasons: string[];
}

// ============================================================================
// API Types
// ============================================================================

export interface CouncilHealth {
  status: string;
  version: string;
  orchestrator: boolean;
  erc8004: {
    identity: boolean;
    reputation: boolean;
    validation: boolean;
  };
  futarchy: {
    council: boolean;
    predimarket: boolean;
  };
  registry: {
    integration: boolean;
    delegation: boolean;
  };
}

export interface GovernanceStats {
  totalProposals: number;
  activeProposals: number;
  executedProposals: number;
  rejectedProposals: number;
  vetoedProposals: number;
  totalStaked: string;
  totalDelegated: string;
  councilAgentsActive: number;
  securityCouncilSize: number;
}

export interface QualityAssessment {
  overallScore: number;
  criteria: {
    clarity: { score: number; feedback: string };
    completeness: { score: number; feedback: string };
    feasibility: { score: number; feedback: string };
    alignment: { score: number; feedback: string };
    impact: { score: number; feedback: string };
  };
  suggestions: string[];
  contentHash: string;
}

// ============================================================================
// Event Types
// ============================================================================

export interface GovernanceEvent {
  type: 'proposal_submitted' | 'vote_cast' | 'proposal_approved' | 'proposal_rejected' | 
        'veto_cast' | 'proposal_vetoed' | 'proposal_executed' | 'delegate_registered' |
        'delegation_changed' | 'security_council_updated' | 'ceo_decision';
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
  data: Record<string, unknown>;
}
