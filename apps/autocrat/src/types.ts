/**
 * Council DAO Types - Multi-tenant Version
 */

import type { Address } from 'viem';

// ============ Enums ============

export enum DAOStatus {
  PENDING = 0,
  ACTIVE = 1,
  PAUSED = 2,
  ARCHIVED = 3,
}

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

export enum CasualProposalCategory {
  OPINION = 'opinion',
  SUGGESTION = 'suggestion',
  PROPOSAL = 'proposal',
  MEMBER_APPLICATION = 'member_application',
  PACKAGE_FUNDING = 'package_funding',
  REPO_FUNDING = 'repo_funding',
  PARAMETER_CHANGE = 'parameter_change',
  CEO_MODEL_CHANGE = 'ceo_model_change',
}

export enum FundingStatus {
  PROPOSED = 0,
  ACCEPTED = 1,
  ACTIVE = 2,
  PAUSED = 3,
  COMPLETED = 4,
  REJECTED = 5,
}

// ============ DAO Types ============

export interface CEOPersona {
  name: string;
  pfpCid: string;
  description: string;
  personality: string;
  traits: string[];
  voiceStyle: string;
  communicationTone: 'formal' | 'friendly' | 'professional' | 'playful' | 'authoritative';
  specialties: string[];
}

export interface CouncilMemberConfig {
  member: Address;
  agentId: bigint;
  role: string;
  weight: number;
  addedAt: number;
  isActive: boolean;
}

export interface GovernanceParams {
  minQualityScore: number;
  councilVotingPeriod: number;
  autocratVotingPeriod?: number;
  gracePeriod: number;
  minProposalStake: bigint;
  minBackers?: number;
  minStakeForVeto?: bigint;
  vetoThreshold?: number;
  quorumBps: number;
}

export interface AutocratVote {
  role: string;
  vote: string;
  reasoning: string;
  confidence: number;
  timestamp: number;
  daoId?: string;
}

export interface DAO {
  daoId: string;
  name: string;
  displayName: string;
  description: string;
  treasury: Address;
  council: Address;
  ceoAgent: Address;
  feeConfig: Address;
  ceoModelId: string;
  manifestCid: string;
  status: DAOStatus;
  createdAt: number;
  updatedAt: number;
  creator: Address;
}

export interface DAOFull {
  dao: DAO;
  ceoPersona: CEOPersona;
  params: GovernanceParams;
  councilMembers: CouncilMemberConfig[];
  linkedPackages: string[];
  linkedRepos: string[];
}

export interface DAOConfig {
  daoId: string;
  name: string;
  displayName: string;
  ceoPersona: CEOPersona;
  governanceParams: GovernanceParams;
  fundingConfig: FundingConfig;
  contracts: DAOContracts;
  agents: DAOAgents;
}

export interface DAOContracts {
  council: Address;
  ceoAgent: Address;
  treasury: Address;
  feeConfig: Address;
  daoRegistry: Address;
  daoFunding: Address;
  identityRegistry: Address;
  reputationRegistry: Address;
  packageRegistry: Address;
  repoRegistry: Address;
  modelRegistry: Address;
}

export interface DAOAgents {
  ceo: AgentConfig;
  council: AgentConfig[];
  proposalAgent: AgentConfig;
  researchAgent: AgentConfig;
  fundingAgent: AgentConfig;
}

// ============ Funding Types ============

export interface FundingConfig {
  minStake: bigint;
  maxStake: bigint;
  epochDuration: number;
  cooldownPeriod: number;
  matchingMultiplier: number;
  quadraticEnabled: boolean;
  ceoWeightCap: number;
}

export interface FundingProject {
  projectId: string;
  daoId: string;
  projectType: 'package' | 'repo';
  registryId: string;
  name: string;
  description: string;
  primaryRecipient: Address;
  additionalRecipients: Address[];
  recipientShares: number[];
  ceoWeight: number;
  communityStake: bigint;
  totalFunded: bigint;
  status: FundingStatus;
  createdAt: number;
  lastFundedAt: number;
  proposer: Address;
}

export interface FundingEpoch {
  epochId: number;
  daoId: string;
  startTime: number;
  endTime: number;
  totalBudget: bigint;
  matchingPool: bigint;
  distributed: bigint;
  finalized: boolean;
}

export interface FundingStake {
  amount: bigint;
  epochId: number;
  timestamp: number;
  withdrawn: boolean;
}

export interface FundingAllocation {
  projectId: string;
  projectName: string;
  ceoWeight: number;
  communityStake: bigint;
  stakerCount: number;
  allocation: bigint;
  allocationPercentage: number;
}

// ============ Proposal Types ============

export interface Proposal {
  id: string;
  daoId: string;
  proposer: Address;
  proposerAgentId: bigint;
  title: string;
  summary: string;
  description: string;
  proposalType: ProposalType;
  casualCategory: CasualProposalCategory;
  status: ProposalStatus;
  qualityScore: number;
  alignmentScore: number;
  relevanceScore: number;
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
  linkedPackage: string | null;
  linkedRepo: string | null;
}

export interface CasualProposal {
  id: string;
  daoId: string;
  proposer: Address;
  category: CasualProposalCategory;
  title: string;
  content: string;
  stake: bigint;
  alignmentScore: number;
  relevanceScore: number;
  clarityScore: number;
  status: 'pending' | 'reviewing' | 'accepted' | 'rejected' | 'needs_revision';
  aiAssessment: AIAssessment | null;
  councilFeedback: string[];
  ceoFeedback: string | null;
  linkedPackageId: string | null;
  linkedRepoId: string | null;
  createdAt: number;
  updatedAt: number;
  convertedToProposalId: string | null;
}

export interface AIAssessment {
  isAligned: boolean;
  alignmentReason: string;
  isRelevant: boolean;
  relevanceReason: string;
  isClear: boolean;
  clarityReason: string;
  suggestions: string[];
  improvedVersion: string | null;
  recommendedCategory: CasualProposalCategory;
  shouldAccept: boolean;
  overallFeedback: string;
}

export interface ProposalDraft {
  daoId: string;
  title: string;
  summary: string;
  description: string;
  proposalType: ProposalType;
  casualCategory?: CasualProposalCategory;
  targetContract?: Address;
  calldata?: string;
  value?: bigint;
  tags?: string[];
  linkedPackageId?: string;
  linkedRepoId?: string;
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

// ============ Council Types ============

export enum CouncilRole {
  TREASURY = 0,
  CODE = 1,
  COMMUNITY = 2,
  SECURITY = 3,
}

export interface CouncilAgent {
  id: string;
  daoId: string;
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
  daoId: string;
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
  daoId: string;
  round: number;
  startedAt: number;
  endedAt: number;
  votes: CouncilVote[];
  outcome: 'approve' | 'reject' | 'request_changes' | 'pending';
  summary: string;
  requiredChanges: string[];
}

// ============ CEO Types ============

export interface CEODecision {
  proposalId: string;
  daoId: string;
  approved: boolean;
  reasoning: string;
  encryptedReasoning: string;
  conditions: string[];
  modifications: string[];
  timeline: string;
  decidedAt: number;
  confidence: number;
  alignmentScore: number;
  personaResponse: string;
}

export interface CEOState {
  daoId: string;
  persona: CEOPersona;
  currentProposals: string[];
  pendingDecisions: number;
  totalDecisions: number;
  approvalRate: number;
  lastDecision: number;
  modelVersion: string;
  modelId: string;
  contextHash: string;
  encryptedState: string;
}

export interface CEOModelCandidate {
  modelId: string;
  name: string;
  description: string;
  provider: string;
  benchmarkScore: number;
  alignmentScore: number;
  votes: number;
  delegations: number;
  status: 'candidate' | 'active' | 'deprecated';
}

// ============ Reputation Types ============

export interface ProposerReputation {
  address: Address;
  agentId: bigint;
  daoId: string;
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

// ============ Research Types ============

export interface ResearchReport {
  proposalId: string;
  daoId: string;
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

// ============ Veto Types ============

export interface VetoVote {
  proposalId: string;
  daoId: string;
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
  daoId: string;
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

// ============ Market Types ============

export interface VetoMarket {
  proposalId: string;
  daoId: string;
  marketId: string;
  createdAt: number;
  closesAt: number;
  yesShares: bigint;
  noShares: bigint;
  totalVolume: bigint;
  resolved: boolean;
  outcome: boolean | null;
}

// ============ Execution Types ============

export interface ExecutionPlan {
  proposalId: string;
  daoId: string;
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

// ============ Stored Object Types ============
// Used by local-services.ts and state.ts for type-safe storage

export interface VoteStorage {
  type: 'vote';
  proposalId: string;
  daoId?: string;
  role: string;
  vote: string;
  reasoning: string;
  confidence: number;
  timestamp: number;
}

export interface ResearchStorage {
  type: 'research';
  proposalId: string;
  report: string;
  model: string;
  completedAt: number;
}

export interface CommentaryStorage {
  type: 'commentary';
  proposalId: string;
  content: string;
  sentiment: 'positive' | 'negative' | 'neutral' | 'concern';
  timestamp: number;
}

export interface CEODecisionStorage {
  type: 'ceo_decision';
  proposalId: string;
  approved: boolean;
  confidenceScore: number;
  alignmentScore: number;
  autocratVotes: { approve: number; reject: number; abstain: number };
  reasoning: string;
  recommendations: string[];
  timestamp: string;
  model: string;
  teeMode: string;
}

// Detailed vote storage from orchestrator (includes agent info for on-chain)
export interface AutocratVoteDetailStorage {
  type: 'autocrat_vote_detail';
  proposalId: string;
  daoId: string;
  agent: string;
  role: string;
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN';
  reasoning: string;
  confidence: number;
}

// TEE Attestation type
export interface TEEAttestation {
  provider: 'local' | 'remote';
  quote?: string;
  measurement?: string;
  timestamp: number;
  verified: boolean;
}

// TEE Decision storage
export interface TEEDecisionData {
  approved: boolean;
  publicReasoning: string;
  confidenceScore: number;
  alignmentScore: number;
  recommendations: string[];
  encryptedHash: string;
  attestation: TEEAttestation;
}

// CEO analysis from runtime (simpler than full CEODecision)
export interface CEOAnalysisResult {
  approved: boolean;
  reasoning: string;
  personaResponse: string;
  confidence: number;
  alignment: number;
  recommendations: string[];
}

// CEO decision detail storage from orchestrator (includes TEE data)
export interface CEODecisionDetailStorage {
  type: 'ceo_decision_detail';
  proposalId: string;
  daoId: string;
  ceoAnalysis: CEOAnalysisResult;
  teeDecision: TEEDecisionData;
  personaResponse: string;
  decidedAt: number;
}

export type StoredObject = 
  | VoteStorage 
  | ResearchStorage 
  | CommentaryStorage 
  | CEODecisionStorage
  | AutocratVoteDetailStorage
  | CEODecisionDetailStorage;

// ============ A2A Skill Parameter Types ============

export interface A2AChatParams {
  message: string;
  agent?: 'ceo' | 'treasury' | 'code' | 'community' | 'security';
}

export interface A2AAssessProposalParams {
  title: string;
  summary: string;
  description: string;
}

export interface A2ASubmitProposalParams {
  proposalType: string;
  qualityScore: number;
  contentHash: `0x${string}`;
  targetContract?: Address;
  callData?: `0x${string}`;
  value?: string;
}

export interface A2ABackProposalParams {
  proposalId: `0x${string}`;
  stakeAmount?: string;
  reputationWeight?: number;
}

export interface A2ASubmitVoteParams {
  proposalId: `0x${string}`;
  agentId: string;
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN';
  reasoning?: string;
  confidence?: number;
}

export interface A2ADeliberateParams {
  proposalId: `0x${string}`;
  title?: string;
  description?: string;
  proposalType?: string;
  submitter?: string;
}

export interface A2ARequestResearchParams {
  proposalId: `0x${string}`;
  description?: string;
}

export interface A2ACastVetoParams {
  proposalId: `0x${string}`;
  category: string;
  reason: `0x${string}`;
}

export interface A2AAddCommentaryParams {
  proposalId: `0x${string}`;
  content: string;
  sentiment?: 'positive' | 'negative' | 'neutral' | 'concern';
}

export interface A2AProposalIdParams {
  proposalId: `0x${string}`;
}

export interface A2AListProposalsParams {
  activeOnly?: boolean;
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
  | Record<string, never>; // Empty params for status endpoints

// ============ A2A Skill Result Types ============

export interface SkillResultData {
  [key: string]: string | number | boolean | null | string[] | SkillResultData | SkillResultData[];
}

export interface A2ASkillResult {
  message: string;
  data: SkillResultData;
}

// ============ Communication Types ============

export interface A2AMessage {
  messageId: string;
  from: string;
  to: string;
  daoId: string;
  skillId: string;
  params: A2ASkillParams;
  timestamp: number;
}

export interface A2AResponse {
  messageId: string;
  success: boolean;
  result: A2ASkillResult | null;
  error: string | null;
}

// ============ Configuration Types ============

export interface AutocratConfig {
  rpcUrl: string;
  chainId?: number;
  daoRegistry?: Address;
  daoFunding?: Address;
  defaultDAO?: string;
  daoId?: string;
  daos?: Record<string, DAOConfig>;
  contracts?: DAOContracts;
  agents?: DAOAgents;
  parameters?: GovernanceParams;
  ceoPersona?: CEOPersona;
  fundingConfig?: FundingConfig;
  cloudEndpoint?: string;
  computeEndpoint?: string;
  storageEndpoint?: string;
  teaEndpoint?: string;
}

export interface CouncilConfig {
  rpcUrl: string;
  daoId: string;
  contracts: DAOContracts;
  agents: DAOAgents;
  parameters: GovernanceParams;
  ceoPersona: CEOPersona;
  fundingConfig: FundingConfig;
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
  persona?: CEOPersona;
}

// ============ Package/Repo Types ============

export interface PackageInfo {
  packageId: string;
  name: string;
  description: string;
  version: string;
  maintainers: Address[];
  cid: string;
  daoId: string | null;
  fundingStatus: FundingStatus;
  totalFunded: bigint;
  createdAt: number;
  updatedAt: number;
}

export interface RepoInfo {
  repoId: string;
  name: string;
  description: string;
  owner: Address;
  collaborators: Address[];
  contentCid: string;
  daoId: string | null;
  fundingStatus: FundingStatus;
  totalFunded: bigint;
  createdAt: number;
  updatedAt: number;
}

// ============ Model Types ============

export interface ModelInfo {
  modelId: string;
  name: string;
  description: string;
  provider: string;
  huggingFaceRepo: string;
  ipfsHash: string;
  benchmarkScore: number;
  alignmentScore: number;
  isActive: boolean;
  daoUsages: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ModelDelegation {
  delegator: Address;
  modelId: string;
  daoId: string;
  amount: bigint;
  delegatedAt: number;
}

// ============ Event Types ============

export type AutocratEventType =
  | 'ProposalSubmitted'
  | 'ProposalBacked'
  | 'CouncilVoteCast'
  | 'CEODecisionMade'
  | 'VetoCast'
  | 'ProposalExecuted'
  | 'CommentAdded'
  | 'ResearchCompleted';

export interface ProposalSubmittedEventData {
  proposalId: string;
  proposer: Address;
  proposalType: number;
  qualityScore: number;
}

export interface ProposalBackedEventData {
  proposalId: string;
  backer: Address;
  stakeAmount: string;
}

export interface CouncilVoteCastEventData {
  proposalId: string;
  councilAgentId: string;
  vote: number;
  weight: number;
}

export interface CEODecisionMadeEventData {
  proposalId: string;
  approved: boolean;
  confidenceScore: number;
}

export interface VetoCastEventData {
  proposalId: string;
  voter: Address;
  category: number;
}

export interface ProposalExecutedEventData {
  proposalId: string;
  executor: Address;
  success: boolean;
}

export interface CommentAddedEventData {
  proposalId: string;
  author: Address;
  sentiment: string;
}

export interface ResearchCompletedEventData {
  proposalId: string;
  researcher: string;
  recommendation: string;
}

export type AutocratEventData =
  | ProposalSubmittedEventData
  | ProposalBackedEventData
  | CouncilVoteCastEventData
  | CEODecisionMadeEventData
  | VetoCastEventData
  | ProposalExecutedEventData
  | CommentAddedEventData
  | ResearchCompletedEventData;

export interface AutocratEvent {
  eventType: AutocratEventType;
  daoId: string;
  data: AutocratEventData;
  timestamp: number;
  blockNumber: number;
  transactionHash: string;
}

// ============ Statistics Types ============

export interface DAOStats {
  daoId: string;
  totalProposals: number;
  activeProposals: number;
  approvedProposals: number;
  rejectedProposals: number;
  totalStaked: bigint;
  totalFunded: bigint;
  uniqueProposers: number;
  averageQualityScore: number;
  averageApprovalTime: number;
  ceoApprovalRate: number;
  linkedPackages: number;
  linkedRepos: number;
}

export interface FundingStats {
  daoId: string;
  currentEpoch: number;
  epochBudget: bigint;
  matchingPool: bigint;
  totalProjects: number;
  activeProjects: number;
  totalStaked: bigint;
  totalDistributed: bigint;
  uniqueStakers: number;
}

// ============ Bug Bounty Types ============

export enum BountySeverity {
  LOW = 0,
  MEDIUM = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export enum VulnerabilityType {
  FUNDS_AT_RISK = 0,
  WALLET_DRAIN = 1,
  REMOTE_CODE_EXECUTION = 2,
  TEE_BYPASS = 3,
  CONSENSUS_ATTACK = 4,
  MPC_KEY_EXPOSURE = 5,
  PRIVILEGE_ESCALATION = 6,
  DENIAL_OF_SERVICE = 7,
  INFORMATION_DISCLOSURE = 8,
  OTHER = 9,
}

export enum BountySubmissionStatus {
  PENDING = 0,
  VALIDATING = 1,
  GUARDIAN_REVIEW = 2,
  CEO_REVIEW = 3,
  APPROVED = 4,
  REJECTED = 5,
  PAID = 6,
  WITHDRAWN = 7,
}

export enum ValidationResult {
  VALID = 0,
  INVALID = 1,
  NEEDS_REVIEW = 2,
}

export interface BountySubmissionDraft {
  title: string;
  summary: string;
  description: string;
  severity: BountySeverity;
  vulnType: VulnerabilityType;
  affectedComponents: string[];
  stepsToReproduce: string[];
  proofOfConcept?: string;
  suggestedFix?: string;
  impact?: string;
}

export interface BountySubmission extends BountySubmissionDraft {
  submissionId: string;
  researcher: Address;
  researcherAgentId: bigint;
  stake: bigint;
  rewardAmount: bigint;
  status: BountySubmissionStatus;
  validationResult: ValidationResult;
  validationNotes: string;
  guardianApprovals: number;
  guardianRejections: number;
  submittedAt: number;
  validatedAt: number;
  resolvedAt: number;
  fixCommitHash: string | null;
  disclosureDate: number | null;
  researcherDisclosed: boolean;
  encryptedReportCid: string;
  encryptionKeyId: string;
  proofOfConceptHash: string;
}

export interface BountyAssessment {
  severityScore: number;
  impactScore: number;
  exploitabilityScore: number;
  isImmediateThreat: boolean;
  estimatedReward: bigint;
  validationPriority: 'critical' | 'high' | 'medium' | 'low';
  feedback: string[];
  readyToSubmit: boolean;
}

export interface BountyGuardianVote {
  submissionId: string;
  guardian: Address;
  agentId: bigint;
  approved: boolean;
  suggestedReward: bigint;
  feedback: string;
  votedAt: number;
}

export interface ResearcherStats {
  address: Address;
  totalSubmissions: number;
  approvedSubmissions: number;
  rejectedSubmissions: number;
  totalEarned: bigint;
  averageReward: bigint;
  successRate: number;
}

export interface BountyPoolStats {
  totalPool: bigint;
  totalPaidOut: bigint;
  pendingPayouts: bigint;
  activeSubmissions: number;
  guardianCount: number;
}

export const SEVERITY_REWARDS: Record<BountySeverity, { min: string; max: string }> = {
  [BountySeverity.LOW]: { min: '$500', max: '$2,500' },
  [BountySeverity.MEDIUM]: { min: '$2,500', max: '$10,000' },
  [BountySeverity.HIGH]: { min: '$10,000', max: '$25,000' },
  [BountySeverity.CRITICAL]: { min: '$25,000', max: '$50,000' },
};
