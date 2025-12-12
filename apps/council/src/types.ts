/**
 * Council DAO Types
 * 
 * Core type definitions for the AI Council governance system.
 */

import type { Address } from 'viem';

// ============================================================================
// Proposal Types
// ============================================================================

export enum ProposalStatus {
  DRAFT = 0,           // Being crafted with proposal agent
  PENDING_QUALITY = 1, // Awaiting quality score
  SUBMITTED = 2,       // Submitted on-chain
  COUNCIL_REVIEW = 3,  // Council is deliberating
  RESEARCH = 4,        // Deep research in progress
  COUNCIL_FINAL = 5,   // Final council deliberation
  CEO_QUEUE = 6,       // Awaiting CEO decision
  APPROVED = 7,        // CEO approved, in grace period
  EXECUTING = 8,       // Being executed
  COMPLETED = 9,       // Fully executed
  REJECTED = 10,       // Rejected by council or CEO
  VETOED = 11,         // Vetoed during grace period
  DUPLICATE = 12,      // Marked as duplicate
  SPAM = 13,           // Marked as spam
}

export enum ProposalType {
  PARAMETER_CHANGE = 0,    // Change DAO parameters
  TREASURY_ALLOCATION = 1, // Allocate treasury funds
  CODE_UPGRADE = 2,        // Smart contract upgrades
  HIRE_CONTRACTOR = 3,     // Hire a contributor
  FIRE_CONTRACTOR = 4,     // Remove a contributor
  BOUNTY = 5,              // Create a bounty
  GRANT = 6,               // Issue a grant
  PARTNERSHIP = 7,         // Establish partnership
  POLICY = 8,              // Policy change
  EMERGENCY = 9,           // Emergency action
}

export interface Proposal {
  id: string;
  proposer: Address;
  proposerAgentId: bigint;
  title: string;
  summary: string;
  description: string;
  proposalType: ProposalType;
  status: ProposalStatus;
  qualityScore: number;          // 0-100, needs 90+ to submit
  createdAt: number;
  submittedAt: number;
  councilVoteStart: number;
  councilVoteEnd: number;
  ceoDecisionAt: number;
  gracePeriodEnd: number;
  executedAt: number;
  ipfsHash: string;              // Full proposal content
  calldata: string;              // Execution calldata
  targetContract: Address;
  value: bigint;
  backers: Address[];
  backerStakes: Map<Address, bigint>;
  backerReputations: Map<Address, number>;
  totalStaked: bigint;
  totalReputation: number;
  councilVotes: CouncilVote[];
  researchReport: ResearchReport | null;
  ceoDecision: CEODecision | null;
  vetoVotes: VetoVote[];
  commentary: ProposalComment[];
  tags: string[];
  relatedProposals: string[];
}

export interface ProposalDraft {
  title: string;
  summary: string;
  description: string;
  proposalType: ProposalType;
  targetContract?: Address;
  calldata?: string;
  value?: bigint;
  tags?: string[];
}

export interface QualityAssessment {
  overallScore: number;
  criteria: {
    clarity: number;
    completeness: number;
    feasibility: number;
    alignment: number;   // With DAO values
    impact: number;
    riskAssessment: number;
    costBenefit: number;
  };
  feedback: string[];
  suggestions: string[];
  blockers: string[];   // Must-fix issues
  readyToSubmit: boolean;
}

// ============================================================================
// Council Types
// ============================================================================

export enum CouncilRole {
  TREASURY = 0,
  CODE = 1,
  COMMUNITY = 2,
  SECURITY = 3,
}

export interface CouncilAgent {
  id: string;
  address: Address;
  agentId: bigint;
  role: CouncilRole;
  name: string;
  description: string;
  votingWeight: number;
  isActive: boolean;
  proposalsReviewed: number;
  approvalRate: number;
  lastActive: number;
}

export enum VoteType {
  APPROVE = 0,
  REJECT = 1,
  ABSTAIN = 2,
  REQUEST_CHANGES = 3,
}

export interface CouncilVote {
  proposalId: string;
  councilAgentId: string;
  role: CouncilRole;
  vote: VoteType;
  reasoning: string;
  concerns: string[];
  requirements: string[];  // Required changes
  votedAt: number;
  weight: number;
}

export interface CouncilDeliberation {
  proposalId: string;
  round: number;
  startedAt: number;
  endedAt: number;
  votes: CouncilVote[];
  outcome: 'approve' | 'reject' | 'request_changes' | 'pending';
  summary: string;
  requiredChanges: string[];
}

// ============================================================================
// CEO Types
// ============================================================================

export interface CEODecision {
  proposalId: string;
  approved: boolean;
  reasoning: string;
  encryptedReasoning: string;   // Full reasoning, TEE-encrypted
  conditions: string[];          // Conditions for execution
  modifications: string[];       // Required modifications
  timeline: string;
  decidedAt: number;
  confidence: number;            // 0-100
  alignmentScore: number;        // Alignment with DAO values
}

export interface CEOState {
  currentProposals: string[];
  pendingDecisions: number;
  totalDecisions: number;
  approvalRate: number;
  lastDecision: number;
  modelVersion: string;
  contextHash: string;          // Hash of current context/values
  encryptedState: string;       // TEE-encrypted internal state
}

// ============================================================================
// Reputation & Staking Types
// ============================================================================

export interface ProposerReputation {
  address: Address;
  agentId: bigint;
  totalProposals: number;
  approvedProposals: number;
  rejectedProposals: number;
  successRate: number;
  reputationScore: number;      // From leaderboard
  stakingPower: bigint;
  isVerifiedBuilder: boolean;
  linkedGithub: string | null;
  linkedWallets: Address[];
}

export interface BackerInfo {
  address: Address;
  agentId: bigint;
  stakedAmount: bigint;
  reputationWeight: number;
  backedAt: number;
  signature: string;
}

// ============================================================================
// Research Types
// ============================================================================

export interface ResearchReport {
  proposalId: string;
  researcher: string;           // Agent ID
  model: string;                // Model used (claude-opus-4-5)
  startedAt: number;
  completedAt: number;
  executionTime: number;
  tokenUsage: {
    input: number;
    output: number;
    cost: number;
  };
  sections: ResearchSection[];
  recommendation: 'proceed' | 'reject' | 'modify';
  confidenceLevel: number;      // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  keyFindings: string[];
  concerns: string[];
  alternatives: string[];
  ipfsHash: string;
}

export interface ResearchSection {
  title: string;
  content: string;
  sources: string[];
  confidence: number;
}

// ============================================================================
// Veto & Commentary Types
// ============================================================================

export interface VetoVote {
  proposalId: string;
  voter: Address;
  agentId: bigint;
  reason: string;
  category: VetoCategory;
  stakedAmount: bigint;
  reputationWeight: number;
  votedAt: number;
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

export interface ProposalComment {
  proposalId: string;
  author: Address;
  authorAgentId: bigint;
  content: string;
  sentiment: 'positive' | 'negative' | 'neutral' | 'concern';
  stakedAmount: bigint;
  reputationWeight: number;
  createdAt: number;
  parentCommentId: string | null;
  upvotes: number;
  downvotes: number;
}

// ============================================================================
// Market Types (for veto prediction markets)
// ============================================================================

export interface VetoMarket {
  proposalId: string;
  marketId: string;
  createdAt: number;
  closesAt: number;
  yesShares: bigint;
  noShares: bigint;
  totalVolume: bigint;
  resolved: boolean;
  outcome: boolean | null;
}

// ============================================================================
// Execution Types
// ============================================================================

export interface ExecutionPlan {
  proposalId: string;
  steps: ExecutionStep[];
  totalValue: bigint;
  estimatedGas: bigint;
  timelock: number;
  executor: Address;
  createdAt: number;
}

export interface ExecutionStep {
  order: number;
  targetContract: Address;
  calldata: string;
  value: bigint;
  description: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  txHash: string | null;
  executedAt: number | null;
}

// ============================================================================
// A2A Types
// ============================================================================

export interface A2AMessage {
  messageId: string;
  from: string;
  to: string;
  skillId: string;
  params: Record<string, unknown>;
  timestamp: number;
}

export interface A2AResponse {
  messageId: string;
  success: boolean;
  result: unknown;
  error: string | null;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface CouncilConfig {
  rpcUrl: string;
  contracts: {
    council: Address;
    proposalRegistry: Address;
    ceoAgent: Address;
    identityRegistry: Address;
    reputationRegistry: Address;
    stakingManager: Address;
    predimarket: Address;
  };
  agents: {
    ceo: AgentConfig;
    council: AgentConfig[];
    proposalAgent: AgentConfig;
    researchAgent: AgentConfig;
  };
  parameters: {
    minQualityScore: number;       // 90
    councilVotingPeriod: number;   // 3 days
    gracePeriod: number;           // 24 hours
    minBackers: number;            // 0
    minStakeForVeto: bigint;
    vetoThreshold: number;         // % of stake needed to veto
  };
  cloudEndpoint: string;
  computeEndpoint: string;
  storageEndpoint: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  endpoint: string;
  systemPrompt: string;
}
