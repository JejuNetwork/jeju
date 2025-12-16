/**
 * Council DAO Types
 */

import type { Address } from 'viem';

export enum ProposalStatus {
  DRAFT = 0,
  PENDING_QUALITY = 1,
  SUBMITTED = 2,
  COUNCIL_REVIEW = 3,
  RESEARCH = 4,
  COUNCIL_FINAL = 5,
  CEO_QUEUE = 6,
  APPROVED = 7,
  EXECUTING = 8,
  COMPLETED = 9,
  REJECTED = 10,
  VETOED = 11,
  DUPLICATE = 12,
  SPAM = 13,
}

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

export interface Proposal {
  id: string;
  proposer: Address;
  proposerAgentId: bigint;
  title: string;
  summary: string;
  description: string;
  proposalType: ProposalType;
  status: ProposalStatus;
  qualityScore: number;
  createdAt: number;
  submittedAt: number;
  councilVoteStart: number;
  councilVoteEnd: number;
  ceoDecisionAt: number;
  gracePeriodEnd: number;
  executedAt: number;
  ipfsHash: string;
  calldata: string;
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
    alignment: number;
    impact: number;
    riskAssessment: number;
    costBenefit: number;
  };
  feedback: string[];
  suggestions: string[];
  blockers: string[];
  readyToSubmit: boolean;
}

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
  requirements: string[];
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

export interface CEODecision {
  proposalId: string;
  approved: boolean;
  reasoning: string;
  encryptedReasoning: string;
  conditions: string[];
  modifications: string[];
  timeline: string;
  decidedAt: number;
  confidence: number;
  alignmentScore: number;
}

export interface CEOState {
  currentProposals: string[];
  pendingDecisions: number;
  totalDecisions: number;
  approvalRate: number;
  lastDecision: number;
  modelVersion: string;
  contextHash: string;
  encryptedState: string;
}

export interface ProposerReputation {
  address: Address;
  agentId: bigint;
  totalProposals: number;
  approvedProposals: number;
  rejectedProposals: number;
  successRate: number;
  reputationScore: number;
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

export interface ResearchReport {
  proposalId: string;
  researcher: string;
  model: string;
  startedAt: number;
  completedAt: number;
  executionTime: number;
  tokenUsage: { input: number; output: number; cost: number };
  sections: ResearchSection[];
  recommendation: 'proceed' | 'reject' | 'modify';
  confidenceLevel: number;
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
    minQualityScore: number;
    councilVotingPeriod: number;
    gracePeriod: number;
    minBackers: number;
    minStakeForVeto: bigint;
    vetoThreshold: number;
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
