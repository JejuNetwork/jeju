/**
 * Zod Schemas for Autocrat App
 * 
 * Comprehensive validation schemas for all types, routes, and endpoints.
 * Uses shared base schemas from @jejunetwork/types/validation.
 */

import { z } from 'zod';
import { AddressSchema } from '@jejunetwork/types';
import {
  BigIntSchema,
  HexSchema,
  HashSchema,
} from '@jejunetwork/types';

// Re-export shared schemas and helpers for convenience
export {
  BigIntSchema,
  expectValid,
  expectValid as validateOrThrow,
  expectDefined,
  expectTrue as expect,
} from '@jejunetwork/types';

// ============ Base Schemas ============

export const HexStringSchema = HexSchema;
export const ProposalIdSchema = HashSchema; // 0x + 64 hex chars (32-byte hash)
export const Bytes32Schema = HashSchema;

// ============ Enum Schemas ============

export const DAOStatusSchema = z.nativeEnum({
  PENDING: 0,
  ACTIVE: 1,
  PAUSED: 2,
  ARCHIVED: 3,
});

export const ProposalStatusSchema = z.nativeEnum({
  DRAFT: 0,
  PENDING_QUALITY: 1,
  SUBMITTED: 2,
  COUNCIL_REVIEW: 3,
  RESEARCH: 4,
  COUNCIL_FINAL: 5,
  CEO_QUEUE: 6,
  APPROVED: 7,
  EXECUTING: 8,
  COMPLETED: 9,
  REJECTED: 10,
  VETOED: 11,
  DUPLICATE: 12,
  SPAM: 13,
});

export const ProposalTypeSchema = z.nativeEnum({
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
});

export const CasualProposalCategorySchema = z.enum([
  'opinion',
  'suggestion',
  'proposal',
  'member_application',
  'package_funding',
  'repo_funding',
  'parameter_change',
  'ceo_model_change',
]);

export const FundingStatusSchema = z.nativeEnum({
  PROPOSED: 0,
  ACCEPTED: 1,
  ACTIVE: 2,
  PAUSED: 3,
  COMPLETED: 4,
  REJECTED: 5,
});

export const CouncilRoleSchema = z.nativeEnum({
  TREASURY: 0,
  CODE: 1,
  COMMUNITY: 2,
  SECURITY: 3,
});

export const VoteTypeSchema = z.nativeEnum({
  APPROVE: 0,
  REJECT: 1,
  ABSTAIN: 2,
  REQUEST_CHANGES: 3,
});

export const VetoCategorySchema = z.nativeEnum({
  ALREADY_DONE: 0,
  DUPLICATE: 1,
  IMPOSSIBLE: 2,
  HARMFUL: 3,
  MISALIGNED: 4,
  INSUFFICIENT_INFO: 5,
  OTHER: 6,
});

export const CommunicationToneSchema = z.enum([
  'formal',
  'friendly',
  'professional',
  'playful',
  'authoritative',
]);

export const SentimentSchema = z.enum([
  'positive',
  'negative',
  'neutral',
  'concern',
]);

export const RiskLevelSchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);

export const RecommendationSchema = z.enum([
  'proceed',
  'reject',
  'modify',
]);

export const CasualStatusSchema = z.enum([
  'pending',
  'reviewing',
  'accepted',
  'rejected',
  'needs_revision',
]);

export const ModelStatusSchema = z.enum([
  'candidate',
  'active',
  'deprecated',
]);

export const DeliberationOutcomeSchema = z.enum([
  'approve',
  'reject',
  'request_changes',
  'pending',
]);

export const ExecutionStepStatusSchema = z.enum([
  'pending',
  'executing',
  'completed',
  'failed',
]);

// ============ Bug Bounty Schemas ============

export const BountySeveritySchema = z.nativeEnum({
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
});

export const VulnerabilityTypeSchema = z.nativeEnum({
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
});

export const BountySubmissionStatusSchema = z.nativeEnum({
  PENDING: 0,
  VALIDATING: 1,
  GUARDIAN_REVIEW: 2,
  CEO_REVIEW: 3,
  APPROVED: 4,
  REJECTED: 5,
  PAID: 6,
  WITHDRAWN: 7,
});

export const ValidationResultSchema = z.nativeEnum({
  VALID: 0,
  INVALID: 1,
  NEEDS_REVIEW: 2,
});

// ============ Core Type Schemas ============

export const CEOPersonaSchema = z.object({
  name: z.string().min(1).max(100),
  pfpCid: z.string().min(1),
  description: z.string().min(10).max(500),
  personality: z.string().min(10).max(200),
  traits: z.array(z.string().min(1)).min(1).max(10),
  voiceStyle: z.string().min(5).max(100),
  communicationTone: CommunicationToneSchema,
  specialties: z.array(z.string().min(1)).min(1).max(10),
});

export const CouncilMemberConfigSchema = z.object({
  member: AddressSchema,
  agentId: BigIntSchema,
  role: z.string().min(1).max(50),
  weight: z.number().int().min(0).max(10000),
  addedAt: z.number().int().positive(),
  isActive: z.boolean(),
});

export const GovernanceParamsSchema = z.object({
  minQualityScore: z.number().int().min(0).max(100),
  councilVotingPeriod: z.number().int().positive(),
  autocratVotingPeriod: z.number().int().positive().optional(),
  gracePeriod: z.number().int().positive(),
  minProposalStake: BigIntSchema,
  minBackers: z.number().int().min(0).optional(),
  minStakeForVeto: BigIntSchema.optional(),
  vetoThreshold: z.number().int().min(0).max(10000).optional(),
  quorumBps: z.number().int().min(0).max(10000),
});

export const FundingConfigSchema = z.object({
  minStake: BigIntSchema,
  maxStake: BigIntSchema,
  epochDuration: z.number().int().positive(),
  cooldownPeriod: z.number().int().positive(),
  matchingMultiplier: z.number().int().min(0).max(100000),
  quadraticEnabled: z.boolean(),
  ceoWeightCap: z.number().int().min(0).max(10000),
});

export const DAOContractsSchema = z.object({
  council: AddressSchema,
  ceoAgent: AddressSchema,
  treasury: AddressSchema,
  feeConfig: AddressSchema,
  daoRegistry: AddressSchema,
  daoFunding: AddressSchema,
  identityRegistry: AddressSchema,
  reputationRegistry: AddressSchema,
  packageRegistry: AddressSchema,
  repoRegistry: AddressSchema,
  modelRegistry: AddressSchema,
});

export const AgentConfigSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  endpoint: z.string().url(),
  systemPrompt: z.string().min(10).max(5000),
  persona: CEOPersonaSchema.optional(),
});

export const DAOAgentsSchema = z.object({
  ceo: AgentConfigSchema,
  council: z.array(AgentConfigSchema).min(1).max(20),
  proposalAgent: AgentConfigSchema,
  researchAgent: AgentConfigSchema,
  fundingAgent: AgentConfigSchema,
});

export const DAOSchema = z.object({
  daoId: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  description: z.string().min(10).max(2000),
  treasury: AddressSchema,
  council: AddressSchema,
  ceoAgent: AddressSchema,
  feeConfig: AddressSchema,
  ceoModelId: z.string().min(1),
  manifestCid: z.string().min(1),
  status: DAOStatusSchema,
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  creator: AddressSchema,
});

export const DAOFullSchema = z.object({
  dao: DAOSchema,
  ceoPersona: CEOPersonaSchema,
  params: GovernanceParamsSchema,
  councilMembers: z.array(CouncilMemberConfigSchema),
  linkedPackages: z.array(z.string().min(1)),
  linkedRepos: z.array(z.string().min(1)),
});

// ============ Proposal Schemas ============

export const ProposalDraftSchema = z.object({
  daoId: z.string().min(1).max(100),
  title: z.string().min(10).max(200),
  summary: z.string().min(50).max(500),
  description: z.string().min(200).max(10000),
  proposalType: ProposalTypeSchema,
  casualCategory: CasualProposalCategorySchema.optional(),
  targetContract: AddressSchema.optional(),
  calldata: HexStringSchema.optional(),
  value: z.union([BigIntSchema, z.string()]).optional().transform((val) => typeof val === 'bigint' ? val.toString() : val),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  linkedPackageId: z.string().min(1).optional(),
  linkedRepoId: z.string().min(1).optional(),
});

export const QualityCriteriaSchema = z.object({
  clarity: z.number().int().min(0).max(100),
  completeness: z.number().int().min(0).max(100),
  feasibility: z.number().int().min(0).max(100),
  alignment: z.number().int().min(0).max(100),
  impact: z.number().int().min(0).max(100),
  riskAssessment: z.number().int().min(0).max(100),
  costBenefit: z.number().int().min(0).max(100),
});

export const QualityAssessmentSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  criteria: QualityCriteriaSchema,
  feedback: z.array(z.string().min(1)),
  suggestions: z.array(z.string().min(1)),
  blockers: z.array(z.string().min(1)),
  readyToSubmit: z.boolean(),
});

export const CouncilVoteSchema = z.object({
  proposalId: ProposalIdSchema,
  daoId: z.string().min(1).max(100),
  councilAgentId: z.string().min(1),
  role: CouncilRoleSchema,
  vote: VoteTypeSchema,
  reasoning: z.string().min(10).max(2000),
  concerns: z.array(z.string().min(1)),
  requirements: z.array(z.string().min(1)),
  votedAt: z.number().int().positive(),
  weight: z.number().int().min(0).max(10000),
});

export const ResearchSectionSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(50).max(5000),
  sources: z.array(z.string().url()),
  confidence: z.number().int().min(0).max(100),
});

export const ResearchReportSchema = z.object({
  proposalId: ProposalIdSchema,
  daoId: z.string().min(1).max(100),
  researcher: AddressSchema,
  model: z.string().min(1),
  startedAt: z.number().int().positive(),
  completedAt: z.number().int().positive(),
  executionTime: z.number().int().nonnegative(),
  tokenUsage: z.object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cost: z.number().nonnegative(),
  }),
  sections: z.array(ResearchSectionSchema).min(1),
  recommendation: RecommendationSchema,
  confidenceLevel: z.number().int().min(0).max(100),
  riskLevel: RiskLevelSchema,
  summary: z.string().min(50).max(2000),
  keyFindings: z.array(z.string().min(1)),
  concerns: z.array(z.string().min(1)),
  alternatives: z.array(z.string().min(1)),
  ipfsHash: z.string().min(1),
});

export const CEODecisionSchema = z.object({
  proposalId: ProposalIdSchema,
  daoId: z.string().min(1).max(100),
  approved: z.boolean(),
  reasoning: z.string().min(10).max(5000),
  encryptedReasoning: z.string().min(1),
  conditions: z.array(z.string().min(1)),
  modifications: z.array(z.string().min(1)),
  timeline: z.string().min(1).max(500),
  decidedAt: z.number().int().positive(),
  confidence: z.number().int().min(0).max(100),
  alignmentScore: z.number().int().min(0).max(100),
  personaResponse: z.string().min(10).max(2000),
});

export const VetoVoteSchema = z.object({
  proposalId: ProposalIdSchema,
  daoId: z.string().min(1).max(100),
  voter: AddressSchema,
  agentId: BigIntSchema,
  reason: z.string().min(10).max(2000),
  category: VetoCategorySchema,
  stakedAmount: BigIntSchema,
  reputationWeight: z.number().int().min(0).max(10000),
  votedAt: z.number().int().positive(),
});

export const ProposalCommentSchema = z.object({
  proposalId: ProposalIdSchema,
  daoId: z.string().min(1).max(100),
  author: AddressSchema,
  authorAgentId: BigIntSchema,
  content: z.string().min(10).max(2000),
  sentiment: SentimentSchema,
  stakedAmount: BigIntSchema,
  reputationWeight: z.number().int().min(0).max(10000),
  createdAt: z.number().int().positive(),
  parentCommentId: ProposalIdSchema.nullable(),
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative(),
});

export const CasualSubmissionSchema = z.object({
  daoId: z.string().min(1).max(100),
  category: CasualProposalCategorySchema,
  title: z.string().min(10).max(200),
  content: z.string().min(200).max(10000),
});

export const AIAssessmentSchema = z.object({
  isAligned: z.boolean(),
  alignmentReason: z.string().min(10).max(1000),
  isRelevant: z.boolean(),
  relevanceReason: z.string().min(10).max(1000),
  isClear: z.boolean(),
  clarityReason: z.string().min(10).max(1000),
  suggestions: z.array(z.string().min(1)),
  improvedVersion: z.string().nullable(),
  recommendedCategory: CasualProposalCategorySchema,
  shouldAccept: z.boolean(),
  overallFeedback: z.string().min(10).max(2000),
});

// ============ Bug Bounty Type Schemas ============

export const BountySubmissionDraftSchema = z.object({
  title: z.string().min(10).max(200),
  summary: z.string().min(50).max(500),
  description: z.string().min(200).max(10000),
  severity: BountySeveritySchema,
  vulnType: VulnerabilityTypeSchema,
  affectedComponents: z.array(z.string().min(1)).min(1).max(50),
  stepsToReproduce: z.array(z.string().min(10)).min(2).max(50),
  proofOfConcept: z.string().min(0).max(50000).optional(),
  suggestedFix: z.string().min(0).max(5000).optional(),
  impact: z.string().min(0).max(2000).optional(),
});

export const BountyGuardianVoteSchema = z.object({
  submissionId: z.string().min(1),
  guardian: AddressSchema,
  agentId: BigIntSchema,
  approved: z.boolean(),
  suggestedReward: BigIntSchema,
  feedback: z.string().min(10).max(2000),
  votedAt: z.number().int().positive(),
});

// ============ API Request Schemas ============

export const AssessProposalRequestSchema = ProposalDraftSchema;

export const ImproveProposalRequestSchema = z.object({
  draft: ProposalDraftSchema,
  criterion: z.enum(['clarity', 'completeness', 'feasibility', 'alignment', 'impact', 'riskAssessment', 'costBenefit']),
});

export const GenerateProposalRequestSchema = z.object({
  idea: z.string().min(20).max(2000),
  proposalType: ProposalTypeSchema.optional(),
});

export const ResearchRequestSchema = z.object({
  proposalId: ProposalIdSchema,
  title: z.string().min(10).max(200),
  description: z.string().min(200).max(10000),
});

export const FactCheckRequestSchema = z.object({
  claim: z.string().min(10).max(2000),
  context: z.string().min(0).max(5000).optional(),
});

export const AgentRegisterRequestSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(100),
  a2aEndpoint: z.string().url().optional(),
  mcpEndpoint: z.string().url().optional(),
});

export const AgentFeedbackRequestSchema = z.object({
  score: z.number().int().min(0).max(100),
  tag: z.string().min(1).max(50),
  details: z.string().min(0).max(2000).optional(),
});

export const FutarchyEscalateRequestSchema = z.object({
  proposalId: ProposalIdSchema,
});

export const FutarchyResolveRequestSchema = z.object({
  proposalId: ProposalIdSchema,
});

export const FutarchyExecuteRequestSchema = z.object({
  proposalId: ProposalIdSchema,
});

export const ModerationFlagRequestSchema = z.object({
  proposalId: ProposalIdSchema,
  flagger: AddressSchema,
  flagType: z.enum(['spam', 'duplicate', 'harmful', 'misaligned', 'insufficient_info', 'other']),
  reason: z.string().min(10).max(2000),
  stake: z.number().int().min(0).max(1000000),
  evidence: z.string().url().optional(),
});

export const ModerationVoteRequestSchema = z.object({
  flagId: z.string().min(1),
  voter: AddressSchema,
  upvote: z.boolean(),
});

export const ModerationResolveRequestSchema = z.object({
  flagId: z.string().min(1),
  upheld: z.boolean(),
});

export const CasualAssessRequestSchema = z.object({
  category: CasualProposalCategorySchema,
  title: z.string().min(10).max(200),
  content: z.string().min(200).max(10000),
});

export const CasualHelpRequestSchema = z.object({
  category: CasualProposalCategorySchema,
  content: z.string().min(0).max(10000).optional(),
});

export const OrchestratorActiveRequestSchema = z.object({
  active: z.boolean(),
});

export const RegistryProfilesRequestSchema = z.object({
  agentIds: z.array(z.string().min(1)).min(1).max(100),
});

export const BugBountySubmitRequestSchema = BountySubmissionDraftSchema.extend({
  researcher: AddressSchema.optional(),
  researcherAgentId: z.string().min(1).optional(),
});

export const BugBountyVoteRequestSchema = z.object({
  guardian: AddressSchema,
  agentId: z.string().min(1),
  approved: z.boolean(),
  suggestedReward: z.string().min(1),
  feedback: z.string().min(10).max(2000),
});

export const BugBountyCEODecisionRequestSchema = z.object({
  approved: z.boolean(),
  rewardAmount: z.string().min(1),
  notes: z.string().min(10).max(2000),
});

export const BugBountyFixRequestSchema = z.object({
  commitHash: z.string().regex(/^[a-f0-9]{40}$/),
});

export const BugBountyDiscloseRequestSchema = z.object({
  researcher: AddressSchema,
});

export const BugBountyCompleteValidationRequestSchema = z.object({
  result: ValidationResultSchema,
  notes: z.string().min(1).max(5000),
});

// ============ A2A Request Schemas ============

export const A2AMessageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number().int().positive(),
  method: z.literal('message/send'),
  params: z.object({
    message: z.object({
      messageId: z.string().min(1),
      parts: z.array(z.union([
        z.object({
          kind: z.literal('text'),
          text: z.string().min(1),
        }),
        z.object({
          kind: z.literal('data'),
          data: z.object({
            skillId: z.string().min(1),
            params: z.record(z.string(), z.unknown()).optional(),
          }),
        }),
      ])).min(1),
    }),
  }),
});

export const A2AChatParamsSchema = z.object({
  message: z.string().min(1).max(5000),
  agent: z.enum(['ceo', 'treasury', 'code', 'community', 'security']).optional(),
});

export const A2AAssessProposalParamsSchema = z.object({
  title: z.string().min(10).max(200),
  summary: z.string().min(50).max(500),
  description: z.string().min(200).max(10000),
});

export const A2ASubmitProposalParamsSchema = z.object({
  proposalType: z.string().min(1),
  qualityScore: z.number().int().min(0).max(100),
  contentHash: HexStringSchema,
  targetContract: AddressSchema.optional(),
  callData: HexStringSchema.optional(),
  value: z.string().optional(),
});

export const A2ABackProposalParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  stakeAmount: z.string().optional(),
  reputationWeight: z.number().int().min(0).max(10000).optional(),
});

export const A2ASubmitVoteParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  agentId: z.string().min(1),
  vote: z.enum(['APPROVE', 'REJECT', 'ABSTAIN']),
  reasoning: z.string().min(10).max(2000).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
});

export const A2ADeliberateParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  title: z.string().min(10).max(200).optional(),
  description: z.string().min(200).max(10000).optional(),
  proposalType: z.string().optional(),
  submitter: z.string().optional(),
});

export const A2ARequestResearchParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  description: z.string().min(200).max(10000).optional(),
});

export const A2ACastVetoParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  category: z.string().min(1),
  reason: HexStringSchema,
});

export const A2AAddCommentaryParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  content: z.string().min(10).max(2000),
  sentiment: SentimentSchema.optional(),
});

// ============ MCP Request Schemas ============

export const MCPResourceReadRequestSchema = z.object({
  uri: z.string().min(1),
});

export const MCPToolCallRequestSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.string()).optional(),
});

// ============ Query Parameter Schemas ============

export const PaginationQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(1000)).optional(),
  offset: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0)).optional(),
});

export const ProposalListQuerySchema = PaginationQuerySchema.extend({
  active: z.enum(['true', 'false']).optional(),
  status: z.string().optional(),
  type: z.string().optional(),
});

export const RegistrySearchQuerySchema = PaginationQuerySchema.extend({
  minScore: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(100)).optional(),
  tag: z.string().min(1).max(50).optional(),
  count: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
});

export const BugBountyListQuerySchema = PaginationQuerySchema.extend({
  status: z.string().regex(/^\d+$/).optional(),
  severity: z.string().regex(/^\d+$/).optional(),
  researcher: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
}) as z.ZodType<{
  status?: string;
  severity?: string;
  researcher?: `0x${string}`;
  limit?: number;
  offset?: number;
}>;

