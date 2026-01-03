/**
 * Autocrat DAO Types - Multi-tenant Version
 *
 * Terminology:
 * - Director: The AI or human executive decision maker (formerly Director)
 * - Board: The advisory/oversight body (formerly Board)
 */

import type { Address } from 'viem'

export const DAOStatus = {
  PENDING: 0,
  ACTIVE: 1,
  PAUSED: 2,
  ARCHIVED: 3,
} as const
export type DAOStatus = (typeof DAOStatus)[keyof typeof DAOStatus]

export const ProposalStatus = {
  DRAFT: 0,
  PENDING_QUALITY: 1,
  SUBMITTED: 2,
  BOARD_REVIEW: 3,
  RESEARCH: 4,
  BOARD_FINAL: 5,
  DIRECTOR_QUEUE: 6,
  APPROVED: 7,
  EXECUTING: 8,
  COMPLETED: 9,
  REJECTED: 10,
  VETOED: 11,
  DUPLICATE: 12,
  SPAM: 13,
} as const
export type ProposalStatus =
  (typeof ProposalStatus)[keyof typeof ProposalStatus]

// Legacy alias
export const LegacyProposalStatus = {
  BOARD_REVIEW: ProposalStatus.BOARD_REVIEW,
  BOARD_FINAL: ProposalStatus.BOARD_FINAL,
  DIRECTOR_QUEUE: ProposalStatus.DIRECTOR_QUEUE,
} as const

export const ProposalType = {
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
export type ProposalType = (typeof ProposalType)[keyof typeof ProposalType]

export const CasualProposalCategory = {
  OPINION: 'opinion',
  SUGGESTION: 'suggestion',
  PROPOSAL: 'proposal',
  MEMBER_APPLICATION: 'member_application',
  PACKAGE_FUNDING: 'package_funding',
  REPO_FUNDING: 'repo_funding',
  PARAMETER_CHANGE: 'parameter_change',
  DIRECTOR_MODEL_CHANGE: 'director_model_change',
} as const
export type CasualProposalCategory =
  (typeof CasualProposalCategory)[keyof typeof CasualProposalCategory]

export const FundingStatus = {
  PROPOSED: 0,
  ACCEPTED: 1,
  ACTIVE: 2,
  PAUSED: 3,
  COMPLETED: 4,
  REJECTED: 5,
} as const
export type FundingStatus = (typeof FundingStatus)[keyof typeof FundingStatus]

export interface DirectorPersona {
  name: string
  pfpCid: string
  description: string
  personality: string
  traits: string[]
  voiceStyle: string
  communicationTone:
    | 'formal'
    | 'friendly'
    | 'professional'
    | 'playful'
    | 'authoritative'
  specialties: string[]
  isHuman: boolean
  humanAddress?: Address // Set if isHuman=true
  agentId?: bigint // EIP-8004 ID if AI director
  decisionFallbackDays: number // 1-30 days before fallback (0 = no fallback)
}

// Legacy alias - DirectorPersona is already the canonical name

export interface BoardMemberConfig {
  member: Address
  agentId: bigint // EIP-8004 ID for AI, 0n for human
  role: string
  weight: number
  addedAt: number
  isActive: boolean
  isHuman: boolean
}

export interface GovernanceParams {
  minQualityScore: number
  boardVotingPeriod: number
  autocratVotingPeriod?: number
  gracePeriod: number
  minProposalStake: bigint
  minBackers?: number
  minStakeForVeto?: bigint
  vetoThreshold?: number
  quorumBps: number
}

export interface AutocratVote {
  role: string
  vote: string
  reasoning: string
  confidence: number
  timestamp: number
  daoId?: string
}

export interface DAO {
  daoId: string
  name: string
  displayName: string
  description: string
  treasury: Address
  board: Address // Board governance contract (formerly board)
  directorAgent: Address // Director agent contract (formerly directorAgent)
  feeConfig: Address
  directorModelId: string // AI model ID (formerly directorModelId)
  manifestCid: string
  status: DAOStatus
  createdAt: number
  updatedAt: number
  creator: Address
}

export interface DAOFull {
  dao: DAO
  directorPersona: DirectorPersona
  params: GovernanceParams
  boardMembers: BoardMemberConfig[]
  linkedPackages: string[]
  linkedRepos: string[]
}

export interface DAOConfig {
  daoId: string
  name: string
  displayName: string
  directorPersona: DirectorPersona
  governanceParams: GovernanceParams
  fundingConfig: FundingConfig
  contracts: DAOContracts
  agents: DAOAgents
}

export interface DAOContracts {
  board: Address // Board governance contract (formerly board)
  directorAgent: Address // Director agent contract (formerly directorAgent)
  treasury: Address
  feeConfig: Address
  daoRegistry: Address
  daoFunding: Address
  identityRegistry: Address
  reputationRegistry: Address
  packageRegistry: Address
  repoRegistry: Address
  modelRegistry: Address
}

export interface DAOAgents {
  director: AgentConfig // Formerly director
  board: AgentConfig[] // Formerly board
  proposalAgent: AgentConfig
  researchAgent: AgentConfig
  fundingAgent: AgentConfig
}

export interface FundingConfig {
  minStake: bigint
  maxStake: bigint
  epochDuration: number
  cooldownPeriod: number
  matchingMultiplier: number
  quadraticEnabled: boolean
  directorWeightCap: number // Formerly directorWeightCap
}

export interface FundingProject {
  projectId: string
  daoId: string
  projectType: 'package' | 'repo'
  registryId: string
  name: string
  description: string
  primaryRecipient: Address
  additionalRecipients: Address[]
  recipientShares: number[]
  directorWeight: number // Formerly directorWeight
  communityStake: bigint
  totalFunded: bigint
  status: FundingStatus
  createdAt: number
  lastFundedAt: number
  proposer: Address
}

export interface FundingEpoch {
  epochId: number
  daoId: string
  startTime: number
  endTime: number
  totalBudget: bigint
  matchingPool: bigint
  distributed: bigint
  finalized: boolean
}

export interface FundingStake {
  amount: bigint
  epochId: number
  timestamp: number
  withdrawn: boolean
}

export interface FundingAllocation {
  projectId: string
  projectName: string
  directorWeight: number
  communityStake: bigint
  stakerCount: number
  allocation: bigint
  allocationPercentage: number
}

export interface Proposal {
  id: string
  daoId: string
  proposer: Address
  proposerAgentId: bigint
  title: string
  summary: string
  description: string
  proposalType: ProposalType
  casualCategory: CasualProposalCategory
  status: ProposalStatus
  qualityScore: number
  alignmentScore: number
  relevanceScore: number
  createdAt: number
  submittedAt: number
  boardVoteStart: number // Formerly boardVoteStart
  boardVoteEnd: number // Formerly boardVoteEnd
  directorDecisionAt: number // Formerly directorDecisionAt
  gracePeriodEnd: number
  executedAt: number
  ipfsHash: string
  calldata: string
  targetContract: Address
  value: bigint
  backers: Address[]
  backerStakes: Map<Address, bigint>
  backerReputations: Map<Address, number>
  totalStaked: bigint
  totalReputation: number
  boardVotes: BoardVote[] // Formerly boardVotes
  researchReport: ResearchReport | null
  directorDecision: DirectorDecision | null // Formerly directorDecision
  vetoVotes: VetoVote[]
  commentary: ProposalComment[]
  tags: string[]
  relatedProposals: string[]
  linkedPackage: string | null
  linkedRepo: string | null
}

export interface CasualProposal {
  id: string
  daoId: string
  proposer: Address
  category: CasualProposalCategory
  title: string
  content: string
  stake: bigint
  alignmentScore: number
  relevanceScore: number
  clarityScore: number
  status: 'pending' | 'reviewing' | 'accepted' | 'rejected' | 'needs_revision'
  aiAssessment: AIAssessment | null
  boardFeedback: string[] // Formerly boardFeedback
  directorFeedback: string | null // Formerly directorFeedback
  linkedPackageId: string | null
  linkedRepoId: string | null
  createdAt: number
  updatedAt: number
  convertedToProposalId: string | null
}

export interface AIAssessment {
  isAligned: boolean
  alignmentReason: string
  isRelevant: boolean
  relevanceReason: string
  isClear: boolean
  clarityReason: string
  suggestions: string[]
  improvedVersion: string | null
  recommendedCategory: CasualProposalCategory
  shouldAccept: boolean
  overallFeedback: string
}

export interface ProposalDraft {
  daoId: string
  title: string
  summary: string
  description: string
  proposalType: ProposalType
  casualCategory?: CasualProposalCategory
  targetContract?: Address
  calldata?: string
  value?: bigint
  tags?: string[]
  linkedPackageId?: string
  linkedRepoId?: string
}

export interface QualityAssessment {
  overallScore: number
  criteria: {
    clarity: number
    completeness: number
    feasibility: number
    alignment: number
    impact: number
    riskAssessment: number
    costBenefit: number
  }
  feedback: string[]
  suggestions: string[]
  blockers: string[]
  readyToSubmit: boolean
}

export const BoardRole = {
  TREASURY: 0,
  CODE: 1,
  COMMUNITY: 2,
  SECURITY: 3,
  LEGAL: 4,
} as const
export type BoardRole = (typeof BoardRole)[keyof typeof BoardRole]

export interface BoardAgent {
  id: string
  daoId: string
  address: Address
  agentId: bigint
  role: BoardRole
  name: string
  description: string
  votingWeight: number
  isActive: boolean
  isHuman: boolean
  proposalsReviewed: number
  approvalRate: number
  lastActive: number
}

export const VoteType = {
  APPROVE: 0,
  REJECT: 1,
  ABSTAIN: 2,
  REQUEST_CHANGES: 3,
} as const
export type VoteType = (typeof VoteType)[keyof typeof VoteType]

export interface BoardVote {
  proposalId: string
  daoId: string
  boardAgentId: string
  role: BoardRole
  vote: VoteType
  reasoning: string
  concerns: string[]
  requirements: string[]
  votedAt: number
  weight: number
  isHuman: boolean
}

export interface BoardDeliberation {
  proposalId: string
  daoId: string
  round: number
  startedAt: number
  endedAt: number
  votes: BoardVote[]
  outcome: 'approve' | 'reject' | 'request_changes' | 'pending'
  summary: string
  requiredChanges: string[]
}

export interface DirectorDecision {
  proposalId: string
  daoId: string
  approved: boolean
  reasoning: string
  encryptedReasoning: string
  conditions: string[]
  modifications: string[]
  timeline: string
  decidedAt: number
  confidence: number
  alignmentScore: number
  personaResponse: string
  isHumanDecision?: boolean
}

export interface DirectorState {
  daoId: string
  persona: DirectorPersona
  currentProposals: string[]
  pendingDecisions: number
  totalDecisions: number
  approvalRate: number
  lastDecision: number
  modelVersion: string
  modelId: string
  contextHash: string
  encryptedState: string
  isHuman: boolean
  humanAddress?: Address
  decisionFallbackDays: number
}

export interface DirectorModelCandidate {
  modelId: string
  name: string
  description: string
  provider: string
  benchmarkScore: number
  alignmentScore: number
  votes: number
  delegations: number
  status: 'candidate' | 'active' | 'deprecated'
}

export interface ProposerReputation {
  address: Address
  agentId: bigint
  daoId: string
  totalProposals: number
  approvedProposals: number
  rejectedProposals: number
  successRate: number
  reputationScore: number
  stakingPower: bigint
  isVerifiedBuilder: boolean
  linkedGithub: string | null
  linkedWallets: Address[]
}

export interface BackerInfo {
  address: Address
  agentId: bigint
  stakedAmount: bigint
  reputationWeight: number
  backedAt: number
  signature: string
}

export interface ResearchReport {
  proposalId: string
  daoId: string
  researcher: string
  model: string
  startedAt: number
  completedAt: number
  executionTime: number
  tokenUsage: { input: number; output: number; cost: number }
  sections: ResearchSection[]
  recommendation: 'proceed' | 'reject' | 'modify'
  confidenceLevel: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  summary: string
  keyFindings: string[]
  concerns: string[]
  alternatives: string[]
  ipfsHash: string
}

export interface ResearchSection {
  title: string
  content: string
  sources: string[]
  confidence: number
}

export interface VetoVote {
  proposalId: string
  daoId: string
  voter: Address
  agentId: bigint
  reason: string
  category: VetoCategory
  stakedAmount: bigint
  reputationWeight: number
  votedAt: number
}

export const VetoCategory = {
  ALREADY_DONE: 0,
  DUPLICATE: 1,
  IMPOSSIBLE: 2,
  HARMFUL: 3,
  MISALIGNED: 4,
  INSUFFICIENT_INFO: 5,
  OTHER: 6,
} as const
export type VetoCategory = (typeof VetoCategory)[keyof typeof VetoCategory]

export interface ProposalComment {
  proposalId: string
  daoId: string
  author: Address
  authorAgentId: bigint
  content: string
  sentiment: 'positive' | 'negative' | 'neutral' | 'concern'
  stakedAmount: bigint
  reputationWeight: number
  createdAt: number
  parentCommentId: string | null
  upvotes: number
  downvotes: number
}

export interface VetoMarket {
  proposalId: string
  daoId: string
  marketId: string
  createdAt: number
  closesAt: number
  yesShares: bigint
  noShares: bigint
  totalVolume: bigint
  resolved: boolean
  outcome: boolean | null
}

export interface ExecutionPlan {
  proposalId: string
  daoId: string
  steps: ExecutionStep[]
  totalValue: bigint
  estimatedGas: bigint
  timelock: number
  executor: Address
  createdAt: number
}

export interface ExecutionStep {
  order: number
  targetContract: Address
  calldata: string
  value: bigint
  description: string
  status: 'pending' | 'executing' | 'completed' | 'failed'
  txHash: string | null
  executedAt: number | null
}

export interface VoteStorage {
  type: 'vote'
  proposalId: string
  daoId?: string
  role: string
  vote: string
  reasoning: string
  confidence: number
  timestamp: number
}

export interface ResearchStorage {
  type: 'research'
  proposalId: string
  report: string
  model: string
  completedAt: number
}

export interface CommentaryStorage {
  type: 'commentary'
  proposalId: string
  content: string
  sentiment: 'positive' | 'negative' | 'neutral' | 'concern'
  timestamp: number
}

export interface DirectorDecisionStorage {
  type: 'director_decision'
  proposalId: string
  approved: boolean
  confidenceScore: number
  alignmentScore: number
  boardVotes: { approve: number; reject: number; abstain: number }
  reasoning: string
  recommendations: string[]
  timestamp: string
  model: string
  teeMode: string
  isHumanDecision?: boolean
}

// Detailed vote storage from orchestrator (includes agent info for on-chain)
export interface AutocratVoteDetailStorage {
  type: 'autocrat_vote_detail'
  proposalId: string
  daoId: string
  agent: string
  role: string
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN'
  reasoning: string
  confidence: number
  isHuman?: boolean
}

// TEE Attestation type
export interface TEEAttestation {
  provider: 'local' | 'remote'
  quote?: string
  measurement?: string
  timestamp: number
  verified: boolean
}

// TEE Decision storage
export interface TEEDecisionData {
  approved: boolean
  publicReasoning: string
  confidenceScore: number
  alignmentScore: number
  recommendations: string[]
  encryptedHash: string
  attestation: TEEAttestation
}

// Director analysis from runtime (simpler than full DirectorDecision)
export interface DirectorAnalysisResult {
  approved: boolean
  reasoning: string
  personaResponse: string
  confidence: number
  alignment: number
  recommendations: string[]
  isHumanDecision?: boolean
}

// Director decision detail storage from orchestrator (includes TEE data)
export interface DirectorDecisionDetailStorage {
  type: 'director_decision_detail'
  proposalId: string
  daoId: string
  directorAnalysis: DirectorAnalysisResult
  teeDecision: TEEDecisionData
  personaResponse: string
  decidedAt: number
  isHumanDecision?: boolean
}

export type StoredObject =
  | VoteStorage
  | ResearchStorage
  | CommentaryStorage
  | DirectorDecisionStorage
  | AutocratVoteDetailStorage
  | DirectorDecisionDetailStorage

export interface A2AChatParams {
  message: string
  agent?: 'director' | 'treasury' | 'code' | 'community' | 'security'
}

export interface A2AAssessProposalParams {
  title: string
  summary: string
  description: string
}

export interface A2ASubmitProposalParams {
  proposalType: string
  qualityScore: number
  contentHash: `0x${string}`
  targetContract?: Address
  callData?: `0x${string}`
  value?: string
}

export interface A2ABackProposalParams {
  proposalId: `0x${string}`
  stakeAmount?: string
  reputationWeight?: number
}

export interface A2ASubmitVoteParams {
  proposalId: `0x${string}`
  agentId: string
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN'
  reasoning?: string
  confidence?: number
}

export interface A2ADeliberateParams {
  proposalId: `0x${string}`
  title?: string
  description?: string
  proposalType?: string
  submitter?: string
}

export interface A2ARequestResearchParams {
  proposalId: `0x${string}`
  description?: string
}

export interface A2ACastVetoParams {
  proposalId: `0x${string}`
  category: string
  reason: `0x${string}`
}

export interface A2AAddCommentaryParams {
  proposalId: `0x${string}`
  content: string
  sentiment?: 'positive' | 'negative' | 'neutral' | 'concern'
}

export interface A2AProposalIdParams {
  proposalId: `0x${string}`
}

export interface A2AListProposalsParams {
  activeOnly?: boolean
}

export type A2ASkillParams =
  | A2AChatParams
  | A2AAssessProposalParams
  | A2ASubmitProposalParams
  | A2ABackProposalParams
  | A2ASubmitVoteParams
  | A2ADeliberateParams
  | A2ARequestResearchParams
  | A2ACastVetoParams
  | A2AAddCommentaryParams
  | A2AProposalIdParams
  | A2AListProposalsParams
  | Record<string, never> // Empty params for status endpoints

export interface SkillResultData {
  [key: string]:
    | string
    | number
    | boolean
    | null
    | string[]
    | SkillResultData
    | SkillResultData[]
}

export interface A2ASkillResult {
  message: string
  data: SkillResultData
}

export interface A2AMessage {
  messageId: string
  from: string
  to: string
  daoId: string
  skillId: string
  params: A2ASkillParams
  timestamp: number
}

export interface A2AResponse {
  messageId: string
  success: boolean
  result: A2ASkillResult | null
  error: string | null
}

export interface AutocratConfig {
  rpcUrl: string
  chainId?: number
  daoRegistry?: Address
  daoFunding?: Address
  defaultDAO?: string
  daoId?: string
  daos?: Record<string, DAOConfig>
  contracts?: DAOContracts
  agents?: DAOAgents
  parameters?: GovernanceParams
  directorPersona?: DirectorPersona
  directorModelId?: string
  fundingConfig?: FundingConfig
  cloudEndpoint?: string
  computeEndpoint?: string
  storageEndpoint?: string
  teaEndpoint?: string
  indexerUrl?: string
  ethPriceUsd?: number
  proposalBond?: bigint
}

export interface BoardConfig {
  rpcUrl: string
  daoId: string
  contracts: DAOContracts
  agents: DAOAgents
  parameters: GovernanceParams
  directorPersona: DirectorPersona
  directorModelId?: string // Model ID for the AI Director
  fundingConfig: FundingConfig
  cloudEndpoint: string
  computeEndpoint: string
  storageEndpoint: string
}

export interface AgentConfig {
  id: string
  name: string
  model: string
  endpoint: string
  systemPrompt: string
  persona?: DirectorPersona
  isHuman?: boolean
}

export interface PackageInfo {
  packageId: string
  name: string
  description: string
  version: string
  maintainers: Address[]
  cid: string
  daoId: string | null
  fundingStatus: FundingStatus
  totalFunded: bigint
  createdAt: number
  updatedAt: number
}

export interface RepoInfo {
  repoId: string
  name: string
  description: string
  owner: Address
  collaborators: Address[]
  contentCid: string
  daoId: string | null
  fundingStatus: FundingStatus
  totalFunded: bigint
  createdAt: number
  updatedAt: number
}

export interface ModelInfo {
  modelId: string
  name: string
  description: string
  provider: string
  huggingFaceRepo: string
  ipfsHash: string
  benchmarkScore: number
  alignmentScore: number
  isActive: boolean
  daoUsages: string[]
  createdAt: number
  updatedAt: number
}

export interface ModelDelegation {
  delegator: Address
  modelId: string
  daoId: string
  amount: bigint
  delegatedAt: number
}

export type AutocratEventType =
  | 'ProposalSubmitted'
  | 'ProposalBacked'
  | 'BoardVoteCast'
  | 'DirectorDecisionMade'
  | 'VetoCast'
  | 'ProposalExecuted'
  | 'CommentAdded'
  | 'ResearchCompleted'

export interface ProposalSubmittedEventData {
  proposalId: string
  proposer: Address
  proposalType: number
  qualityScore: number
}

export interface ProposalBackedEventData {
  proposalId: string
  backer: Address
  stakeAmount: string
}

export interface BoardVoteCastEventData {
  proposalId: string
  boardAgentId: string
  vote: number
  weight: number
  isHuman: boolean
}

export interface DirectorDecisionMadeEventData {
  proposalId: string
  approved: boolean
  confidenceScore: number
  isHumanDecision?: boolean
}

export interface VetoCastEventData {
  proposalId: string
  voter: Address
  category: number
}

export interface ProposalExecutedEventData {
  proposalId: string
  executor: Address
  success: boolean
}

export interface CommentAddedEventData {
  proposalId: string
  author: Address
  sentiment: string
}

export interface ResearchCompletedEventData {
  proposalId: string
  researcher: string
  recommendation: string
}

export type AutocratEventData =
  | ProposalSubmittedEventData
  | ProposalBackedEventData
  | BoardVoteCastEventData
  | DirectorDecisionMadeEventData
  | VetoCastEventData
  | ProposalExecutedEventData
  | CommentAddedEventData
  | ResearchCompletedEventData

export interface AutocratEvent {
  eventType: AutocratEventType
  daoId: string
  data: AutocratEventData
  timestamp: number
  blockNumber: number
  transactionHash: string
}

export interface DAOStats {
  daoId: string
  totalProposals: number
  activeProposals: number
  approvedProposals: number
  rejectedProposals: number
  totalStaked: bigint
  totalFunded: bigint
  uniqueProposers: number
  averageQualityScore: number
  averageApprovalTime: number
  directorApprovalRate: number
  linkedPackages: number
  linkedRepos: number
}

export interface FundingStats {
  daoId: string
  currentEpoch: number
  epochBudget: bigint
  matchingPool: bigint
  totalProjects: number
  activeProjects: number
  totalStaked: bigint
  totalDistributed: bigint
  uniqueStakers: number
}

export const BountySeverity = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
} as const
export type BountySeverity =
  (typeof BountySeverity)[keyof typeof BountySeverity]

export const VulnerabilityType = {
  FUNDS_AT_RISK: 0,
  WALLET_DRAIN: 1,
  REMOTE_CODE_EXECUTION: 2,
  TEE_BYPASS: 3,
  CONSENSUS_ATTACK: 4,
  MPC_KEY_EXPOSURE: 5,
  PRIVILEGE_ESCALATION: 6,
  DENIAL_OF_SERVICE: 7,
  INFORMATION_DISCLOSURE: 8,
  OTHER: 9,
} as const
export type VulnerabilityType =
  (typeof VulnerabilityType)[keyof typeof VulnerabilityType]

export const BountySubmissionStatus = {
  PENDING: 0,
  VALIDATING: 1,
  GUARDIAN_REVIEW: 2,
  DIRECTOR_REVIEW: 3, // Formerly DIRECTOR_REVIEW
  APPROVED: 4,
  REJECTED: 5,
  PAID: 6,
  WITHDRAWN: 7,
} as const
export type BountySubmissionStatus =
  (typeof BountySubmissionStatus)[keyof typeof BountySubmissionStatus]

export const ValidationResult = {
  PENDING: 0,
  VERIFIED: 1,
  LIKELY_VALID: 2,
  NEEDS_MORE_INFO: 3,
  INVALID: 4,
  SANDBOX_ERROR: 5,
} as const
export type ValidationResult =
  (typeof ValidationResult)[keyof typeof ValidationResult]

export interface BountySubmissionDraft {
  title: string
  summary: string
  description: string
  severity: BountySeverity
  vulnType: VulnerabilityType
  affectedComponents: string[]
  stepsToReproduce: string[]
  proofOfConcept?: string
  suggestedFix?: string
  impact?: string
}

export interface BountySubmission extends BountySubmissionDraft {
  submissionId: string
  researcher: Address
  researcherAgentId: bigint
  stake: bigint
  rewardAmount: bigint
  status: BountySubmissionStatus
  validationResult: ValidationResult
  validationNotes?: string
  guardianApprovals: number
  guardianRejections: number
  submittedAt: number
  validatedAt?: number
  resolvedAt?: number
  fixCommitHash?: string
  disclosureDate?: number
  researcherDisclosed?: boolean
  encryptedReportCid: string
  encryptionKeyId: string
  proofOfConceptHash: string
}

export interface BountyAssessment {
  severity: BountySeverity
  estimatedReward: {
    min: number
    max: number
    currency: string
  }
  qualityScore: number
  issues: string[]
  readyToSubmit: boolean
}

export interface BountyGuardianVote {
  submissionId: string
  guardian: Address
  guardianAgentId: bigint
  approved: boolean
  suggestedReward: bigint
  feedback: string
  votedAt: number
}

export interface ResearcherStats {
  totalSubmissions: number
  approvedSubmissions: number
  rejectedSubmissions: number
  totalEarned: bigint
  averageReward: bigint
  successRate: number
}

export interface BountyPoolStats {
  totalPool: bigint
  totalPaidOut: bigint
  pendingPayouts: bigint
  activeSubmissions: number
  guardianCount: number
}

export const SEVERITY_REWARDS: Record<
  BountySeverity,
  { minReward: number; maxReward: number }
> = {
  [BountySeverity.LOW]: { minReward: 500, maxReward: 2500 },
  [BountySeverity.MEDIUM]: { minReward: 2500, maxReward: 10000 },
  [BountySeverity.HIGH]: { minReward: 10000, maxReward: 25000 },
  [BountySeverity.CRITICAL]: { minReward: 25000, maxReward: 50000 },
}

// Reverse lookup maps for enum names
export const BountySeverityName: Record<BountySeverity, string> = {
  [BountySeverity.LOW]: 'LOW',
  [BountySeverity.MEDIUM]: 'MEDIUM',
  [BountySeverity.HIGH]: 'HIGH',
  [BountySeverity.CRITICAL]: 'CRITICAL',
}

export const VulnerabilityTypeName: Record<VulnerabilityType, string> = {
  [VulnerabilityType.FUNDS_AT_RISK]: 'FUNDS_AT_RISK',
  [VulnerabilityType.WALLET_DRAIN]: 'WALLET_DRAIN',
  [VulnerabilityType.REMOTE_CODE_EXECUTION]: 'REMOTE_CODE_EXECUTION',
  [VulnerabilityType.TEE_BYPASS]: 'TEE_BYPASS',
  [VulnerabilityType.CONSENSUS_ATTACK]: 'CONSENSUS_ATTACK',
  [VulnerabilityType.MPC_KEY_EXPOSURE]: 'MPC_KEY_EXPOSURE',
  [VulnerabilityType.PRIVILEGE_ESCALATION]: 'PRIVILEGE_ESCALATION',
  [VulnerabilityType.DENIAL_OF_SERVICE]: 'DENIAL_OF_SERVICE',
  [VulnerabilityType.INFORMATION_DISCLOSURE]: 'INFORMATION_DISCLOSURE',
  [VulnerabilityType.OTHER]: 'OTHER',
}

export const ValidationResultName: Record<ValidationResult, string> = {
  [ValidationResult.PENDING]: 'PENDING',
  [ValidationResult.VERIFIED]: 'VERIFIED',
  [ValidationResult.LIKELY_VALID]: 'LIKELY_VALID',
  [ValidationResult.NEEDS_MORE_INFO]: 'NEEDS_MORE_INFO',
  [ValidationResult.INVALID]: 'INVALID',
  [ValidationResult.SANDBOX_ERROR]: 'SANDBOX_ERROR',
}

// ============ Human Director Interface Types ============

export interface HumanDirectorContext {
  proposal: Proposal
  boardVotes: BoardVote[]
  researchReport: ResearchReport | null
  riskAssessment: RiskAssessment
  similarHistoricalDecisions: HistoricalDecision[]
  daoStats: DAOStats
}

export interface RiskAssessment {
  overallRisk: 'low' | 'medium' | 'high' | 'critical'
  financialRisk: number
  technicalRisk: number
  reputationalRisk: number
  legalRisk: number
  mitigations: string[]
  concerns: string[]
}

export interface HistoricalDecision {
  proposalId: string
  title: string
  proposalType: ProposalType
  decision: 'approved' | 'rejected'
  directorReasoning: string
  outcome: string
  similarity: number
  decidedAt: number
}

export interface HumanDirectorDecisionInput {
  proposalId: string
  daoId: string
  approved: boolean
  reasoning: string
  conditions: string[]
  modifications: string[]
  signature: `0x${string}` // EIP-712 signed decision
}

// ============ Supreme Court / Appeal Types ============

export const AppealStatus = {
  FILED: 0,
  BOARD_REVIEW: 1,
  DIRECTOR_DECISION: 2,
  RESOLVED: 3,
} as const
export type AppealStatus = (typeof AppealStatus)[keyof typeof AppealStatus]

export interface ModerationAppeal {
  appealId: string
  caseId: string // Original ban case from ModerationMarketplace
  appellant: Address
  stakeAmount: bigint
  newEvidence: string // IPFS CID of new evidence
  status: AppealStatus
  boardVotes: AppealBoardVote[]
  directorDecision: AppealDirectorDecision | null
  filedAt: number
  resolvedAt: number | null
  outcome: boolean | null // true = ban reversed
}

export interface AppealBoardVote {
  appealId: string
  voter: Address
  isHuman: boolean
  inFavorOfAppellant: boolean
  reasoning: string
  votedAt: number
}

export interface AppealDirectorDecision {
  appealId: string
  restoreAccount: boolean
  reasoning: string
  decidedAt: number
  isHumanDecision?: boolean
}
