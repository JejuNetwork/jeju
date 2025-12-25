/**
 * Zod Schemas for Autocrat App
 *
 * Comprehensive validation schemas for all types, routes, and endpoints.
 * Uses shared base schemas from @jejunetwork/types.
 */

import {
  AddressSchema,
  BigIntSchema,
  expectValid,
  HashSchema,
  HexSchema,
} from '@jejunetwork/types'

// Re-export validation utility
export { expectValid }

import { z } from 'zod'
import {
  BountySeverity,
  BountySubmissionStatus,
  ValidationResult,
  VulnerabilityType,
} from './types'

export const HexStringSchema = HexSchema
export const ProposalIdSchema = HashSchema // 0x + 64 hex chars (32-byte hash)
export const Bytes32Schema = HashSchema

export const DAOStatusSchema = z.nativeEnum({
  PENDING: 0,
  ACTIVE: 1,
  PAUSED: 2,
  ARCHIVED: 3,
})

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
})

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
})

export const CasualProposalCategorySchema = z.enum([
  'opinion',
  'suggestion',
  'proposal',
  'member_application',
  'package_funding',
  'repo_funding',
  'parameter_change',
  'ceo_model_change',
])

export const FundingStatusSchema = z.nativeEnum({
  PROPOSED: 0,
  ACCEPTED: 1,
  ACTIVE: 2,
  PAUSED: 3,
  COMPLETED: 4,
  REJECTED: 5,
})

export const CouncilRoleSchema = z.nativeEnum({
  TREASURY: 0,
  CODE: 1,
  COMMUNITY: 2,
  SECURITY: 3,
})

export const VoteTypeSchema = z.nativeEnum({
  APPROVE: 0,
  REJECT: 1,
  ABSTAIN: 2,
  REQUEST_CHANGES: 3,
})

export const VetoCategorySchema = z.nativeEnum({
  ALREADY_DONE: 0,
  DUPLICATE: 1,
  IMPOSSIBLE: 2,
  HARMFUL: 3,
  MISALIGNED: 4,
  INSUFFICIENT_INFO: 5,
  OTHER: 6,
})

export const CommunicationToneSchema = z.enum([
  'formal',
  'friendly',
  'professional',
  'playful',
  'authoritative',
])

export const SentimentSchema = z.enum([
  'positive',
  'negative',
  'neutral',
  'concern',
])

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical'])

export const RecommendationSchema = z.enum(['proceed', 'reject', 'modify'])

export const CasualStatusSchema = z.enum([
  'pending',
  'reviewing',
  'accepted',
  'rejected',
  'needs_revision',
])

export const ModelStatusSchema = z.enum(['candidate', 'active', 'deprecated'])

export const DeliberationOutcomeSchema = z.enum([
  'approve',
  'reject',
  'request_changes',
  'pending',
])

export const ExecutionStepStatusSchema = z.enum([
  'pending',
  'executing',
  'completed',
  'failed',
])

// Use the const objects from types.ts so that Zod infers the exact same types
export const BountySeveritySchema = z.nativeEnum(BountySeverity)

export const VulnerabilityTypeSchema = z.nativeEnum(VulnerabilityType)

export const BountySubmissionStatusSchema = z.nativeEnum(BountySubmissionStatus)

export const ValidationResultSchema = z.nativeEnum(ValidationResult)

export const CEOPersonaSchema = z.object({
  name: z.string().min(1).max(100),
  pfpCid: z.string().min(1),
  description: z.string().min(10).max(500),
  personality: z.string().min(10).max(200),
  traits: z.array(z.string().min(1)).min(1).max(10),
  voiceStyle: z.string().min(5).max(100),
  communicationTone: CommunicationToneSchema,
  specialties: z.array(z.string().min(1)).min(1).max(10),
})

export const CouncilMemberConfigSchema = z.object({
  member: AddressSchema,
  agentId: BigIntSchema,
  role: z.string().min(1).max(50),
  weight: z.number().int().min(0).max(10000),
  addedAt: z.number().int().positive(),
  isActive: z.boolean(),
})

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
})

export const FundingConfigSchema = z.object({
  minStake: BigIntSchema,
  maxStake: BigIntSchema,
  epochDuration: z.number().int().positive(),
  cooldownPeriod: z.number().int().positive(),
  matchingMultiplier: z.number().int().min(0).max(100000),
  quadraticEnabled: z.boolean(),
  ceoWeightCap: z.number().int().min(0).max(10000),
})

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
})

export const AgentConfigSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  endpoint: z.string().url(),
  systemPrompt: z.string().min(10).max(5000),
  persona: CEOPersonaSchema.optional(),
})

export const DAOAgentsSchema = z.object({
  ceo: AgentConfigSchema,
  council: z.array(AgentConfigSchema).min(1).max(20),
  proposalAgent: AgentConfigSchema,
  researchAgent: AgentConfigSchema,
  fundingAgent: AgentConfigSchema,
})

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
})

export const DAOFullSchema = z.object({
  dao: DAOSchema,
  ceoPersona: CEOPersonaSchema,
  params: GovernanceParamsSchema,
  councilMembers: z.array(CouncilMemberConfigSchema),
  linkedPackages: z.array(z.string().min(1)),
  linkedRepos: z.array(z.string().min(1)),
})

export const ProposalDraftSchema = z.object({
  daoId: z.string().min(1).max(100),
  title: z.string().min(10).max(200),
  summary: z.string().min(50).max(500),
  description: z.string().min(200).max(10000),
  proposalType: ProposalTypeSchema,
  casualCategory: CasualProposalCategorySchema.optional(),
  targetContract: AddressSchema.optional(),
  calldata: HexStringSchema.optional(),
  value: z
    .union([BigIntSchema, z.string()])
    .optional()
    .transform((val) => (typeof val === 'bigint' ? val.toString() : val)),
  tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  linkedPackageId: z.string().min(1).optional(),
  linkedRepoId: z.string().min(1).optional(),
})

export const QualityCriteriaSchema = z.object({
  clarity: z.number().int().min(0).max(100),
  completeness: z.number().int().min(0).max(100),
  feasibility: z.number().int().min(0).max(100),
  alignment: z.number().int().min(0).max(100),
  impact: z.number().int().min(0).max(100),
  riskAssessment: z.number().int().min(0).max(100),
  costBenefit: z.number().int().min(0).max(100),
})

export const QualityCriterionKeySchema = z.enum([
  'clarity',
  'completeness',
  'feasibility',
  'alignment',
  'impact',
  'riskAssessment',
  'costBenefit',
])
export type QualityCriterionKey = z.infer<typeof QualityCriterionKeySchema>

export const QualityAssessmentSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  criteria: QualityCriteriaSchema,
  feedback: z.array(z.string().min(1)),
  suggestions: z.array(z.string().min(1)),
  blockers: z.array(z.string().min(1)),
  readyToSubmit: z.boolean(),
})

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
})

export const ResearchSectionSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(50).max(5000),
  sources: z.array(z.string().url()),
  confidence: z.number().int().min(0).max(100),
})

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
})

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
})

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
})

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
})

export const CasualSubmissionSchema = z.object({
  daoId: z.string().min(1).max(100),
  category: CasualProposalCategorySchema,
  title: z.string().min(10).max(200),
  content: z.string().min(200).max(10000),
})

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
})

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
})

export const BountyGuardianVoteSchema = z.object({
  submissionId: z.string().min(1),
  guardian: AddressSchema,
  agentId: BigIntSchema,
  approved: z.boolean(),
  suggestedReward: BigIntSchema,
  feedback: z.string().min(10).max(2000),
  votedAt: z.number().int().positive(),
})

/** Full BountySubmission schema for cached data parsing */
export const BountySubmissionSchema = BountySubmissionDraftSchema.extend({
  submissionId: z.string().min(1),
  researcher: AddressSchema,
  researcherAgentId: BigIntSchema,
  stake: BigIntSchema,
  rewardAmount: BigIntSchema,
  status: BountySubmissionStatusSchema,
  validationResult: ValidationResultSchema,
  validationNotes: z.string().optional(),
  guardianApprovals: z.number().int().nonnegative(),
  guardianRejections: z.number().int().nonnegative(),
  submittedAt: z.number().int().positive(),
  validatedAt: z.number().int().positive().optional(),
  resolvedAt: z.number().int().positive().optional(),
  fixCommitHash: z.string().optional(),
  disclosureDate: z.number().int().positive().optional(),
  researcherDisclosed: z.boolean().optional(),
  encryptedReportCid: z.string().min(1),
  encryptionKeyId: z.string().min(1),
  proofOfConceptHash: z.string().min(1),
})

/** Schema for string arrays (affectedComponents, stepsToReproduce) */
export const StringArraySchema = z.array(z.string())

export const AssessProposalRequestSchema = ProposalDraftSchema

export const ImproveProposalRequestSchema = z.object({
  draft: ProposalDraftSchema,
  criterion: z.enum([
    'clarity',
    'completeness',
    'feasibility',
    'alignment',
    'impact',
    'riskAssessment',
    'costBenefit',
  ]),
})

export const GenerateProposalRequestSchema = z.object({
  idea: z.string().min(20).max(2000),
  proposalType: ProposalTypeSchema.optional(),
})

export const ResearchRequestSchema = z.object({
  proposalId: ProposalIdSchema,
  title: z.string().min(10).max(200),
  description: z.string().min(200).max(10000),
})

export const FactCheckRequestSchema = z.object({
  claim: z.string().min(10).max(2000),
  context: z.string().min(0).max(5000).optional(),
})

export const AgentRegisterRequestSchema = z.object({
  name: z.string().min(1).max(100),
  role: z.string().min(1).max(100),
  a2aEndpoint: z.string().url().optional(),
  mcpEndpoint: z.string().url().optional(),
})

export const AgentFeedbackRequestSchema = z.object({
  score: z.number().int().min(0).max(100),
  tag: z.string().min(1).max(50),
  details: z.string().min(0).max(2000).optional(),
})

export const FutarchyEscalateRequestSchema = z.object({
  proposalId: ProposalIdSchema,
})

export const FutarchyResolveRequestSchema = z.object({
  proposalId: ProposalIdSchema,
})

export const FutarchyExecuteRequestSchema = z.object({
  proposalId: ProposalIdSchema,
})

export const ModerationFlagRequestSchema = z.object({
  proposalId: ProposalIdSchema,
  flagger: AddressSchema,
  flagType: z.enum([
    'spam',
    'duplicate',
    'harmful',
    'misaligned',
    'insufficient_info',
    'other',
  ]),
  reason: z.string().min(10).max(2000),
  stake: z.number().int().min(0).max(1000000),
  evidence: z.string().url().optional(),
})

export const ModerationVoteRequestSchema = z.object({
  flagId: z.string().min(1),
  voter: AddressSchema,
  upvote: z.boolean(),
})

export const ModerationResolveRequestSchema = z.object({
  flagId: z.string().min(1),
  upheld: z.boolean(),
})

export const CasualAssessRequestSchema = z.object({
  category: CasualProposalCategorySchema,
  title: z.string().min(10).max(200),
  content: z.string().min(200).max(10000),
})

export const CasualHelpRequestSchema = z.object({
  category: CasualProposalCategorySchema,
  content: z.string().min(0).max(10000).optional(),
})

export const OrchestratorActiveRequestSchema = z.object({
  active: z.boolean(),
})

export const RegistryProfilesRequestSchema = z.object({
  agentIds: z.array(z.string().min(1)).min(1).max(100),
})

export const BugBountySubmitRequestSchema = BountySubmissionDraftSchema.extend({
  researcher: AddressSchema.optional(),
  researcherAgentId: z.string().min(1).optional(),
})

export const BugBountyVoteRequestSchema = z.object({
  guardian: AddressSchema,
  agentId: z.string().min(1),
  approved: z.boolean(),
  suggestedReward: z.string().min(1),
  feedback: z.string().min(10).max(2000),
})

export const BugBountyCEODecisionRequestSchema = z.object({
  approved: z.boolean(),
  rewardAmount: z.string().min(1),
  notes: z.string().min(10).max(2000),
})

export const BugBountyFixRequestSchema = z.object({
  commitHash: z.string().regex(/^[a-f0-9]{40}$/),
})

export const BugBountyDiscloseRequestSchema = z.object({
  researcher: AddressSchema,
})

export const BugBountyCompleteValidationRequestSchema = z.object({
  result: ValidationResultSchema,
  notes: z.string().min(1).max(5000),
})

export const A2AMessageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number().int().positive(),
  method: z.literal('message/send'),
  params: z.object({
    message: z.object({
      messageId: z.string().min(1),
      parts: z
        .array(
          z.union([
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
          ]),
        )
        .min(1),
    }),
  }),
})

export const A2AChatParamsSchema = z.object({
  message: z.string().min(1).max(5000),
  agent: z
    .enum(['ceo', 'treasury', 'code', 'community', 'security'])
    .optional(),
})

export const A2AAssessProposalParamsSchema = z.object({
  title: z.string().min(10).max(200),
  summary: z.string().min(50).max(500),
  description: z.string().min(200).max(10000),
})

export const A2ASubmitProposalParamsSchema = z.object({
  proposalType: z.string().min(1),
  qualityScore: z.number().int().min(0).max(100),
  contentHash: HexStringSchema,
  targetContract: AddressSchema.optional(),
  callData: HexStringSchema.optional(),
  value: z.string().optional(),
})

export const A2ABackProposalParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  stakeAmount: z.string().optional(),
  reputationWeight: z.number().int().min(0).max(10000).optional(),
})

export const A2ASubmitVoteParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  agentId: z.string().min(1),
  vote: z.enum(['APPROVE', 'REJECT', 'ABSTAIN']),
  reasoning: z.string().min(10).max(2000).optional(),
  confidence: z.number().int().min(0).max(100).optional(),
})

export const A2ADeliberateParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  title: z.string().min(10).max(200).optional(),
  description: z.string().min(200).max(10000).optional(),
  proposalType: z.string().optional(),
  submitter: z.string().optional(),
})

export const A2ARequestResearchParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  description: z.string().min(200).max(10000).optional(),
})

export const A2ACastVetoParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  category: z.string().min(1),
  reason: HexStringSchema,
})

export const A2AAddCommentaryParamsSchema = z.object({
  proposalId: ProposalIdSchema,
  content: z.string().min(10).max(2000),
  sentiment: SentimentSchema.optional(),
})

export const MCPResourceReadRequestSchema = z.object({
  uri: z.string().min(1),
})

export const MCPToolCallRequestSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.string()).optional(),
})

export const PaginationQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(1000))
    .optional(),
  offset: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0))
    .optional(),
})

export const ProposalListQuerySchema = PaginationQuerySchema.extend({
  active: z.enum(['true', 'false']).optional(),
  status: z.string().optional(),
  type: z.string().optional(),
})

export const RegistrySearchQuerySchema = PaginationQuerySchema.extend({
  minScore: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(100))
    .optional(),
  tag: z.string().min(1).max(50).optional(),
  count: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional(),
})

export const BugBountyListQuerySchema = PaginationQuerySchema.extend({
  status: z.string().regex(/^\d+$/).optional(),
  severity: z.string().regex(/^\d+$/).optional(),
  researcher: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
}) as z.ZodType<{
  status?: string
  severity?: string
  researcher?: `0x${string}`
  limit?: number
  offset?: number
}>

// --- GitHub API Responses ---

export const GitHubTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  scope: z.string().optional(),
})

export const GitHubUserProfileSchema = z.object({
  id: z.number(),
  login: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  avatar_url: z.string(),
})

export const GitHubRepoPermissionsSchema = z.object({
  permissions: z
    .object({
      admin: z.boolean().optional(),
      push: z.boolean().optional(),
      maintain: z.boolean().optional(),
    })
    .optional(),
})

// --- A2A Protocol Response Schemas ---

export const A2APartSchema = z.union([
  z.object({
    kind: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    kind: z.literal('data'),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
])

export const A2AResultSchema = z.object({
  parts: z.array(A2APartSchema).optional(),
})

export const A2AJsonRpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0').optional(),
  id: z.union([z.number(), z.string()]).optional(),
  result: A2AResultSchema.optional(),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string(),
    })
    .optional(),
})

export type A2AJsonRpcResponse = z.infer<typeof A2AJsonRpcResponseSchema>

// --- A2A Skill Response Data Schemas ---

export const GovernanceStatsDataSchema = z.object({
  totalProposals: z.number().int().nonnegative(),
  approvedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  avgQualityScore: z.number().nonnegative(),
})
export type GovernanceStatsData = z.infer<typeof GovernanceStatsDataSchema>

export const CEOStatusDataSchema = z.object({
  currentModel: z.object({
    name: z.string(),
    modelId: z.string(),
  }),
  decisionsThisPeriod: z.number().int().nonnegative(),
  approvalRate: z.number().nonnegative(),
  lastDecision: z
    .object({
      proposalId: ProposalIdSchema,
      approved: z.boolean(),
    })
    .optional(),
})
export type CEOStatusData = z.infer<typeof CEOStatusDataSchema>

export const AutocratStatusDataSchema = z.object({
  roles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string(),
    }),
  ),
  totalMembers: z.number().int().nonnegative(),
})
export type AutocratStatusData = z.infer<typeof AutocratStatusDataSchema>

export const ProposalDataSchema = z.object({
  id: ProposalIdSchema,
  status: z.string(),
  proposer: AddressSchema,
  proposalType: z.number().int().nonnegative(),
  qualityScore: z.number().int().min(0).max(100),
  autocratVoteEnd: z.number().int().nonnegative(),
  gracePeriodEnd: z.number().int().nonnegative(),
  hasResearch: z.boolean(),
  researchHash: z.string().optional(),
  contentHash: z.string(),
})
export type ProposalData = z.infer<typeof ProposalDataSchema>

export const ProposalListDataSchema = z.object({
  proposals: z.array(ProposalDataSchema),
  total: z.number().int().nonnegative(),
})
export type ProposalListData = z.infer<typeof ProposalListDataSchema>

export const AutocratVoteDataSchema = z.object({
  role: z.string(),
  vote: z.enum(['APPROVE', 'REJECT', 'ABSTAIN']),
  reasoning: z.string(),
  confidence: z.number().int().min(0).max(100),
  timestamp: z.number().int().nonnegative().optional(),
})
export type AutocratVoteData = z.infer<typeof AutocratVoteDataSchema>

export const AutocratVotesDataSchema = z.object({
  votes: z.array(AutocratVoteDataSchema),
})
export type AutocratVotesData = z.infer<typeof AutocratVotesDataSchema>

export const ResearchDataSchema = z.object({
  report: z.string().optional(),
  status: z.string(),
  completedAt: z.number().int().nonnegative().optional(),
})
export type ResearchData = z.infer<typeof ResearchDataSchema>

export const SubmitVoteResultSchema = z.object({
  success: z.boolean(),
})
export type SubmitVoteResult = z.infer<typeof SubmitVoteResultSchema>

// --- LLM/Compute API Response Schemas ---

export const LLMChoiceSchema = z.object({
  message: z
    .object({
      content: z.string(),
      role: z.string().optional(),
    })
    .optional(),
  index: z.number().optional(),
  finish_reason: z.string().optional(),
})

export const LLMCompletionResponseSchema = z.object({
  choices: z.array(LLMChoiceSchema).optional(),
  content: z.string().optional(), // Alternative format
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
})

export const ComputeInferenceResponseSchema = z.object({
  requestId: z.string().optional(),
  content: z.string().optional(),
  tokensUsed: z
    .object({
      input: z.number(),
      output: z.number(),
    })
    .optional(),
  cost: z.object({
    amount: z.string(),
    currency: z.string(),
    paid: z.boolean().optional(),
  }),
  latencyMs: z.number(),
})

export type ComputeInferenceResponse = z.infer<
  typeof ComputeInferenceResponseSchema
>

// --- Sandbox/Container Execution Response Schemas ---

export const SandboxExecutionResponseSchema = z.object({
  executionId: z.string().optional(),
  status: z.string(),
  output: z
    .object({
      exploitTriggered: z.boolean().default(false),
      exploitDetails: z.string().default(''),
      result: z.string().default(''),
    })
    .default({ exploitTriggered: false, exploitDetails: '', result: '' }),
  logs: z.string().default(''),
  exitCode: z.number().default(-1),
  metrics: z
    .object({
      executionTimeMs: z.number().default(0),
      memoryUsedMb: z.number().default(0),
      cpuUsagePercent: z.number().default(0),
    })
    .default({ executionTimeMs: 0, memoryUsedMb: 0, cpuUsagePercent: 0 }),
})

export type SandboxExecutionResponse = z.infer<
  typeof SandboxExecutionResponseSchema
>

export const SandboxResultSchema = z.object({
  success: z.boolean(),
  exploitTriggered: z.boolean(),
  exploitDetails: z.string().optional(),
  executionTimeMs: z.number().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
})

export type SandboxResult = z.infer<typeof SandboxResultSchema>

// --- KMS/Encryption Response Schemas ---

export const KMSEncryptResponseSchema = z.object({
  cid: z.string(),
  keyId: z.string(),
  encrypted: z.string(),
})

// --- npm Registry Response Schemas ---

export const NpmPackageResponseSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  homepage: z.string().optional(),
  repository: z
    .union([z.string(), z.object({ url: z.string().optional() })])
    .optional(),
  maintainers: z
    .array(
      z.object({ name: z.string().optional(), email: z.string().optional() }),
    )
    .optional(),
  license: z.string().optional(),
  'dist-tags': z.record(z.string(), z.string()).optional(),
  versions: z
    .record(z.string(), z.object({ license: z.string().optional() }))
    .optional(),
})

export const NpmPackageLatestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
})

// --- PyPI Response Schema ---

export const PyPIPackageResponseSchema = z.object({
  info: z
    .object({
      summary: z.string().optional(),
      home_page: z.string().optional(),
      project_url: z.string().optional(),
      project_urls: z.record(z.string(), z.string()).optional(),
      author: z.string().optional(),
      maintainer: z.string().optional(),
      license: z.string().optional(),
      requires_dist: z.array(z.string()).optional(),
    })
    .optional(),
})

// --- Crates.io Response Schema ---

export const CrateResponseSchema = z.object({
  crate: z
    .object({
      description: z.string().optional(),
      homepage: z.string().optional(),
      repository: z.string().optional(),
      downloads: z.number().optional(),
    })
    .optional(),
  versions: z
    .array(
      z.object({
        num: z.string().optional(),
        license: z.string().optional(),
      }),
    )
    .optional(),
})

export const CrateDependenciesResponseSchema = z.object({
  dependencies: z
    .array(
      z.object({
        kind: z.string(),
        crate_id: z.string(),
      }),
    )
    .optional(),
})

// --- Compute Trigger Response Schemas ---

export const TriggerRegisterResponseSchema = z.object({
  id: z.string(),
})

export const TriggerListResponseSchema = z.object({
  triggers: z.array(
    z.object({
      id: z.string(),
      source: z.string().optional(),
      type: z.string().optional(),
      name: z.string().optional(),
      active: z.boolean().optional(),
    }),
  ),
})

export const TriggerHistoryResponseSchema = z.object({
  executions: z.array(
    z.object({
      executionId: z.string(),
      triggerId: z.string(),
      status: z.string(),
      startedAt: z.string().optional(),
      finishedAt: z.string().optional(),
      output: z.record(z.string(), z.unknown()).optional(),
      error: z.string().optional(),
    }),
  ),
})

// --- MCP Tools Response Schema ---

export const MCPToolsResponseSchema = z.object({
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
      }),
    )
    .default([]),
})

export const MCPToolCallResponseSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.string().default(''),
        text: z.string().default(''),
      }),
    )
    .default([]),
})

// --- Agent Card Response Schema ---

export const AgentCardSchema = z.object({
  protocolVersion: z.string().default(''),
  name: z.string().default(''),
  description: z.string().default(''),
  url: z.string().default(''),
  skills: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().default(''),
        description: z.string().default(''),
      }),
    )
    .default([]),
})

export type AgentCard = z.infer<typeof AgentCardSchema>

/**
 * Safely parse response.json() and validate against schema
 * Throws on validation failure for fail-fast behavior
 */
export async function expectValidResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  context: string,
): Promise<T> {
  if (!response.ok) {
    throw new Error(
      `${context}: HTTP ${response.status} ${response.statusText}`,
    )
  }
  const raw: unknown = await response.json()
  return expectValid(schema, raw, context)
}

/**
 * Extract data from A2A response with validation
 * Returns the data part from the A2A response or throws
 */
export function extractA2AData<T>(
  response: A2AJsonRpcResponse,
  context: string,
): T {
  if (response.error) {
    throw new Error(`${context}: ${response.error.message}`)
  }
  const parts = response.result?.parts
  if (!parts || parts.length === 0) {
    throw new Error(`${context}: Response contains no parts`)
  }
  const dataPart = parts.find((p) => p.kind === 'data')
  if (!dataPart || dataPart.kind !== 'data' || !dataPart.data) {
    throw new Error(`${context}: Response contains no data part`)
  }
  return dataPart.data as T
}

/**
 * Extract text content from LLM response
 * Handles both OpenAI-style and direct content format
 */
export function extractLLMContent(
  response: z.infer<typeof LLMCompletionResponseSchema>,
  context: string,
): string {
  // Check for OpenAI-style response
  if (response.choices && response.choices.length > 0) {
    const choice = response.choices[0]
    const content = choice.message?.content
    if (content && content.length > 0) {
      return content
    }
  }
  // Check for direct content field
  if (response.content && response.content.length > 0) {
    return response.content
  }
  throw new Error(`${context}: No valid content in LLM response`)
}
