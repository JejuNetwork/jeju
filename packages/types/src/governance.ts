/**
 * AI DAO governance types.
 */

import { z } from 'zod'
import { AddressSchema, HashSchema } from './validation'

export const ProposalTypeSchema = z.enum([
  'PARAMETER_CHANGE',
  'TREASURY_ALLOCATION',
  'CODE_UPGRADE',
  'HIRE_CONTRACTOR',
  'FIRE_CONTRACTOR',
  'BOUNTY',
  'GRANT',
  'PARTNERSHIP',
  'POLICY',
  'EMERGENCY',
])
export type ProposalType = z.infer<typeof ProposalTypeSchema>

export const ProposalTypeValue = {
  PARAMETER_CHANGE: 0,
  TREASURY_ALLOCATION: 1,
  CODE_UPGRADE: 2,
  HIRE_CONTRACTOR: 3,
  FIRE_CONTRACTOR: 4,
  BOUNTY: 5,
  GRANT: 6,
  PARTNERSHIP: 7,
  POLICY: 8,
  EMERGENCY: 9,
} as const

export const ProposalStatusSchema = z.enum([
  'SUBMITTED',
  'COUNCIL_REVIEW',
  'RESEARCH_PENDING',
  'COUNCIL_FINAL',
  'CEO_QUEUE',
  'APPROVED',
  'EXECUTING',
  'COMPLETED',
  'REJECTED',
  'VETOED',
  'FUTARCHY_PENDING',
  'FUTARCHY_APPROVED',
  'FUTARCHY_REJECTED',
  'DUPLICATE',
  'SPAM',
])
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>

export const ProposalStatusValue = {
  SUBMITTED: 0,
  COUNCIL_REVIEW: 1,
  RESEARCH_PENDING: 2,
  COUNCIL_FINAL: 3,
  CEO_QUEUE: 4,
  APPROVED: 5,
  EXECUTING: 6,
  COMPLETED: 7,
  REJECTED: 8,
  VETOED: 9,
  FUTARCHY_PENDING: 10,
  FUTARCHY_APPROVED: 11,
  FUTARCHY_REJECTED: 12,
  DUPLICATE: 13,
  SPAM: 14,
} as const

export const CouncilRoleSchema = z.enum([
  'TREASURY',
  'CODE',
  'COMMUNITY',
  'SECURITY',
])
export type CouncilRole = z.infer<typeof CouncilRoleSchema>

/** Numeric enum for contract compatibility */
export const CouncilRoleValue = {
  TREASURY: 0,
  CODE: 1,
  COMMUNITY: 2,
  SECURITY: 3,
} as const

export const VoteTypeSchema = z.enum([
  'APPROVE',
  'REJECT',
  'ABSTAIN',
  'REQUEST_CHANGES',
])
export type VoteType = z.infer<typeof VoteTypeSchema>

/** Numeric enum for contract compatibility */
export const VoteTypeValue = {
  APPROVE: 0,
  REJECT: 1,
  ABSTAIN: 2,
  REQUEST_CHANGES: 3,
} as const

export const VetoCategorySchema = z.enum([
  'ALREADY_DONE',
  'DUPLICATE',
  'IMPOSSIBLE',
  'HARMFUL',
  'MISALIGNED',
  'INSUFFICIENT_INFO',
  'OTHER',
])
export type VetoCategory = z.infer<typeof VetoCategorySchema>

/** Numeric enum for contract compatibility */
export const VetoCategoryValue = {
  ALREADY_DONE: 0,
  DUPLICATE: 1,
  IMPOSSIBLE: 2,
  HARMFUL: 3,
  MISALIGNED: 4,
  INSUFFICIENT_INFO: 5,
  OTHER: 6,
} as const

// Agent & Reputation Schemas

export const StakeTierSchema = z.enum(['NONE', 'SMALL', 'MEDIUM', 'HIGH'])
export type StakeTier = z.infer<typeof StakeTierSchema>

/** Numeric enum for contract compatibility */
export const StakeTierValue = {
  NONE: 0,
  SMALL: 1,
  MEDIUM: 2,
  HIGH: 3,
} as const

export const AgentProfileSchema = z.object({
  agentId: z.string(),
  owner: AddressSchema,
  stakeTier: StakeTierSchema,
  stakedAmount: z.string(),
  registeredAt: z.number(),
  lastActivityAt: z.number(),
  isBanned: z.boolean(),
  feedbackCount: z.number(),
  averageReputation: z.number(),
  violationCount: z.number(),
  compositeScore: z.number(),
  tags: z.array(z.string()),
  a2aEndpoint: z.string(),
  mcpEndpoint: z.string(),
})
export type AgentProfile = z.infer<typeof AgentProfileSchema>

export const ProviderReputationSchema = z.object({
  provider: AddressSchema,
  providerAgentId: z.string(),
  stakeAmount: z.string(),
  stakeTime: z.number(),
  averageReputation: z.number(),
  violationsReported: z.number(),
  operatorCount: z.number(),
  lastUpdated: z.number(),
  weightedScore: z.number(),
})
export type ProviderReputation = z.infer<typeof ProviderReputationSchema>

// Voting Schemas

export const VotingPowerSchema = z.object({
  baseVotes: z.string(),
  reputationMultiplier: z.number(),
  stakeMultiplier: z.number(),
  effectiveVotes: z.string(),
})
export type VotingPower = z.infer<typeof VotingPowerSchema>

export const EligibilityResultSchema = z.object({
  eligible: z.boolean(),
  reason: z.string(),
})
export type EligibilityResult = z.infer<typeof EligibilityResultSchema>

export const EligibilitySchema = z.object({
  agentId: z.string(),
  canSubmitProposal: EligibilityResultSchema,
  canVote: EligibilityResultSchema,
  canConductResearch: EligibilityResultSchema,
})
export type Eligibility = z.infer<typeof EligibilitySchema>

// Proposal Schemas

export const ProposalSchema = z.object({
  proposalId: z.string(),
  proposer: AddressSchema,
  proposerAgentId: z.string(),
  proposalType: ProposalTypeSchema,
  status: ProposalStatusSchema,
  qualityScore: z.number(),
  createdAt: z.number(),
  councilVoteEnd: z.number(),
  gracePeriodEnd: z.number(),
  contentHash: z.string(),
  targetContract: AddressSchema,
  callData: z.string(),
  value: z.string(),
  totalStaked: z.string(),
  totalReputation: z.string(),
  backerCount: z.number(),
  hasResearch: z.boolean(),
  researchHash: z.string(),
  ceoApproved: z.boolean(),
  ceoDecisionHash: z.string(),
})
export type Proposal = z.infer<typeof ProposalSchema>

export const CouncilVoteSchema = z.object({
  proposalId: z.string(),
  councilAgent: AddressSchema,
  role: CouncilRoleSchema,
  vote: VoteTypeSchema,
  reasoningHash: z.string(),
  votedAt: z.number(),
  weight: z.number(),
})
export type CouncilVote = z.infer<typeof CouncilVoteSchema>

export const BackerInfoSchema = z.object({
  backer: AddressSchema,
  agentId: z.string(),
  stakedAmount: z.string(),
  reputationWeight: z.string(),
  backedAt: z.number(),
})
export type BackerInfo = z.infer<typeof BackerInfoSchema>

export const VetoVoteSchema = z.object({
  voter: AddressSchema,
  agentId: z.string(),
  category: VetoCategorySchema,
  reasonHash: z.string(),
  stakedAmount: z.string(),
  reputationWeight: z.string(),
  votedAt: z.number(),
})
export type VetoVote = z.infer<typeof VetoVoteSchema>

// Delegation Schemas

export const DelegateSchema = z.object({
  delegate: AddressSchema,
  agentId: z.string(),
  name: z.string(),
  profileHash: z.string(),
  expertise: z.array(z.string()),
  totalDelegated: z.string(),
  delegatorCount: z.number(),
  registeredAt: z.number(),
  isActive: z.boolean(),
  proposalsVoted: z.number(),
  proposalsCreated: z.number(),
})
export type Delegate = z.infer<typeof DelegateSchema>

export const VoteDelegationSchema = z.object({
  delegator: AddressSchema,
  delegate: AddressSchema,
  amount: z.string(),
  delegatedAt: z.number(),
  lockedUntil: z.number(),
})
export type VoteDelegation = z.infer<typeof VoteDelegationSchema>

export const SecurityCouncilMemberSchema = z.object({
  member: AddressSchema,
  agentId: z.string(),
  combinedScore: z.number(),
  electedAt: z.number(),
})
export type SecurityCouncilMember = z.infer<typeof SecurityCouncilMemberSchema>

// Moderation Schemas (Governance-specific)

export const FlagTypeSchema = z.enum([
  'spam',
  'duplicate',
  'harmful',
  'scam',
  'low-quality',
  'misaligned',
  'other',
])
export type FlagType = z.infer<typeof FlagTypeSchema>

export const ViolationTypeSchema = z.enum([
  'API_ABUSE',
  'RESOURCE_EXPLOITATION',
  'SCAMMING',
  'PHISHING',
  'HACKING',
  'UNAUTHORIZED_ACCESS',
  'DATA_THEFT',
  'ILLEGAL_CONTENT',
  'HARASSMENT',
  'SPAM',
  'TOS_VIOLATION',
])
export type ViolationType = z.infer<typeof ViolationTypeSchema>

/** Numeric enum for contract compatibility */
export const ViolationTypeValue = {
  API_ABUSE: 0,
  RESOURCE_EXPLOITATION: 1,
  SCAMMING: 2,
  PHISHING: 3,
  HACKING: 4,
  UNAUTHORIZED_ACCESS: 5,
  DATA_THEFT: 6,
  ILLEGAL_CONTENT: 7,
  HARASSMENT: 8,
  SPAM: 9,
  TOS_VIOLATION: 10,
} as const

export const ProposalFlagSchema = z.object({
  flagId: z.string(),
  proposalId: z.string(),
  flagger: AddressSchema,
  flagType: FlagTypeSchema,
  reason: z.string(),
  stake: z.number(),
  evidence: z.string().optional(),
  upvotes: z.number(),
  downvotes: z.number(),
  resolved: z.boolean(),
  upheld: z.boolean(),
  createdAt: z.number(),
})
export type ProposalFlag = z.infer<typeof ProposalFlagSchema>

export const ModerationScoreSchema = z.object({
  proposalId: z.string(),
  totalFlags: z.number(),
  activeFlags: z.number(),
  upheldFlags: z.number(),
  overallScore: z.number(),
  shouldReject: z.boolean(),
  reasons: z.array(z.string()),
})
export type ModerationScore = z.infer<typeof ModerationScoreSchema>

// API Schemas

export const CouncilHealthSchema = z.object({
  status: z.string(),
  version: z.string(),
  orchestrator: z.boolean(),
  erc8004: z.object({
    identity: z.boolean(),
    reputation: z.boolean(),
    validation: z.boolean(),
  }),
  futarchy: z.object({
    council: z.boolean(),
    predimarket: z.boolean(),
  }),
  registry: z.object({
    integration: z.boolean(),
    delegation: z.boolean(),
  }),
})
export type CouncilHealth = z.infer<typeof CouncilHealthSchema>

export const GovernanceStatsSchema = z.object({
  totalProposals: z.number(),
  activeProposals: z.number(),
  executedProposals: z.number(),
  rejectedProposals: z.number(),
  vetoedProposals: z.number(),
  totalStaked: z.string(),
  totalDelegated: z.string(),
  councilAgentsActive: z.number(),
  securityCouncilSize: z.number(),
})
export type GovernanceStats = z.infer<typeof GovernanceStatsSchema>

export const QualityCriterionSchema = z.object({
  score: z.number(),
  feedback: z.string(),
})
export type QualityCriterion = z.infer<typeof QualityCriterionSchema>

export const QualityAssessmentSchema = z.object({
  overallScore: z.number(),
  criteria: z.object({
    clarity: QualityCriterionSchema,
    completeness: QualityCriterionSchema,
    feasibility: QualityCriterionSchema,
    alignment: QualityCriterionSchema,
    impact: QualityCriterionSchema,
  }),
  suggestions: z.array(z.string()),
  contentHash: z.string(),
})
export type QualityAssessment = z.infer<typeof QualityAssessmentSchema>

// Event Schemas

export const GovernanceEventTypeSchema = z.enum([
  'proposal_submitted',
  'vote_cast',
  'proposal_approved',
  'proposal_rejected',
  'veto_cast',
  'proposal_vetoed',
  'proposal_executed',
  'delegate_registered',
  'delegation_changed',
  'security_council_updated',
  'ceo_decision',
])
export type GovernanceEventType = z.infer<typeof GovernanceEventTypeSchema>

/**
 * Strongly typed event data schemas for each event type
 */
export const ProposalSubmittedDataSchema = z.object({
  proposalId: z.string(),
  proposer: AddressSchema,
  proposalType: ProposalTypeSchema,
  contentHash: z.string(),
})

export const VoteCastDataSchema = z.object({
  proposalId: z.string(),
  voter: AddressSchema,
  vote: VoteTypeSchema,
  weight: z.number(),
})

export const ProposalDecisionDataSchema = z.object({
  proposalId: z.string(),
  finalStatus: ProposalStatusSchema,
})

export const DelegationDataSchema = z.object({
  delegator: AddressSchema,
  delegate: AddressSchema,
  amount: z.string(),
})

export const CEODecisionDataSchema = z.object({
  proposalId: z.string(),
  approved: z.boolean(),
  decisionHash: z.string(),
})

/**
 * Union of all event data types
 */
export const GovernanceEventDataSchema = z.union([
  ProposalSubmittedDataSchema,
  VoteCastDataSchema,
  ProposalDecisionDataSchema,
  DelegationDataSchema,
  CEODecisionDataSchema,
])
export type GovernanceEventData = z.infer<typeof GovernanceEventDataSchema>

export const GovernanceEventSchema = z.object({
  type: GovernanceEventTypeSchema,
  timestamp: z.number(),
  blockNumber: z.number(),
  transactionHash: HashSchema,
  /** Strongly typed event data based on event type */
  data: GovernanceEventDataSchema,
})
export type GovernanceEvent = z.infer<typeof GovernanceEventSchema>
