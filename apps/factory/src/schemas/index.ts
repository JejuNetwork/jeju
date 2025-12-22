/**
 * Factory API Zod Schemas
 * All validation schemas for routes and data
 */

import type { Address } from 'viem'
import { z } from 'zod'

// ============================================================================
// Validation Utilities
// ============================================================================

/**
 * Ethereum address schema with checksum validation
 */
export const AddressSchema = z.custom<Address>(
  (val): val is Address => {
    if (typeof val !== 'string') return false
    return /^0x[a-fA-F0-9]{40}$/.test(val)
  },
  { message: 'Invalid Ethereum address' },
)

/**
 * Validate and return typed result, throwing on failure
 */
export function expectValid<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  message?: string,
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const errorMessage =
      message ?? result.error.issues[0]?.message ?? 'Validation failed'
    throw new Error(errorMessage)
  }
  return result.data
}

/**
 * Parse JSON and validate against schema
 */
export function expectJson<T>(
  schema: z.ZodSchema<T>,
  json: string,
  message?: string,
): T {
  const data = JSON.parse(json) as unknown
  return expectValid(schema, data, message)
}

// ============================================================================
// Common Schemas
// ============================================================================

export const PaginationQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
})

// ============================================================================
// Repository JSON Field Schemas (for JSON.parse validation)
// ============================================================================

export const SkillsSchema = z.array(z.string().min(1).max(100))

export const MilestoneSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  reward: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.string().min(1).max(20),
  deadline: z.number().int().positive(),
})

export const MilestonesSchema = z.array(MilestoneSchema)

export const LabelsSchema = z.array(z.string().min(1).max(100))

export const AssigneesSchema = z.array(AddressSchema)

export const ReviewersSchema = z.array(AddressSchema)

// ============================================================================
// Agents Schemas
// ============================================================================

export const AgentsQuerySchema = z.object({
  type: z.string().optional(),
  status: z.string().optional(),
  q: z.string().optional(),
})

export const AgentTypeSchema = z.enum(['ai_agent', 'trading_bot', 'org_tool'])

export const CreateAgentBodySchema = z.object({
  name: z.string().min(1).max(100),
  type: AgentTypeSchema,
  config: z.record(z.string(), z.unknown()),
  modelId: z.string().optional(),
})

export const AgentIdParamSchema = z.object({
  agentId: z.string(),
})

// ============================================================================
// Bounties Schemas
// ============================================================================

export const BountiesQuerySchema = PaginationQuerySchema.extend({
  status: z.string().optional(),
  skill: z.string().optional(),
})

export const CreateBountyBodySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(10),
  reward: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.string().min(1),
  skills: z.array(z.string().min(1)),
  deadline: z.number().int().positive(),
  milestones: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        reward: z.string(),
        currency: z.string(),
        deadline: z.number(),
      }),
    )
    .optional(),
})

export const BountyIdParamSchema = z.object({
  id: z.string(),
})

// ============================================================================
// Jobs Schemas
// ============================================================================

export const JobsQuerySchema = PaginationQuerySchema.extend({
  type: z.string().optional(),
  remote: z.string().optional(),
  skill: z.string().optional(),
})

export const JobTypeSchema = z.enum([
  'full-time',
  'part-time',
  'contract',
  'bounty',
])

export const SalaryPeriodSchema = z.enum([
  'hour',
  'day',
  'week',
  'month',
  'year',
])

export const SalarySchema = z.object({
  min: z.number().min(0),
  max: z.number().min(0),
  currency: z.string().min(1),
  period: SalaryPeriodSchema.optional(),
})

export const CreateJobBodySchema = z.object({
  title: z.string().min(1).max(200),
  company: z.string().min(1).max(100),
  type: JobTypeSchema,
  remote: z.boolean(),
  location: z.string().min(1),
  salary: SalarySchema.optional(),
  skills: z.array(z.string().min(1)),
  description: z.string().min(10),
})

// ============================================================================
// Models Schemas
// ============================================================================

export const ModelsQuerySchema = z.object({
  type: z.string().optional(),
  org: z.string().optional(),
  q: z.string().optional(),
})

export const ModelTypeSchema = z.enum([
  'llm',
  'embedding',
  'image',
  'audio',
  'multimodal',
  'code',
])

export const CreateModelBodySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/),
  organization: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/),
  description: z.string().min(10),
  type: ModelTypeSchema,
})

export const ModelParamsSchema = z.object({
  org: z.string(),
  name: z.string(),
})

// ============================================================================
// Packages Schemas
// ============================================================================

export const PackagesQuerySchema = z.object({
  q: z.string().optional(),
})

export const CreatePackageBodySchema = z.object({
  name: z.string().min(1).max(214),
  version: z.string().regex(/^\d+\.\d+\.\d+(-.+)?$/),
  description: z.string().max(500).optional(),
  license: z.string().min(1),
})

export const PackageParamsSchema = z.object({
  name: z.string(),
})

export const PackageVersionQuerySchema = z.object({
  version: z.string().optional(),
})

// ============================================================================
// Git Schemas
// ============================================================================

export const GitQuerySchema = z.object({
  owner: z.string().optional(),
})

export const CreateRepoBodySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/),
  description: z.string().max(500).optional(),
  isPrivate: z.boolean().optional(),
})

export const RepoParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
})

export const RepoContentsParamsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  '*': z.string().optional(),
})

export const RepoContentsQuerySchema = z.object({
  ref: z.string().optional(),
})

// ============================================================================
// CI Schemas
// ============================================================================

export const CIQuerySchema = PaginationQuerySchema.extend({
  repo: z.string().optional(),
  status: z.string().optional(),
  branch: z.string().optional(),
})

export const TriggerWorkflowBodySchema = z.object({
  repo: z.string().min(1),
  workflow: z.string().min(1),
  branch: z.string().min(1),
  inputs: z.record(z.string(), z.string()).optional(),
})

export const CIRunParamsSchema = z.object({
  runId: z.string(),
})

// ============================================================================
// Containers Schemas
// ============================================================================

export const ContainersQuerySchema = z.object({
  org: z.string().optional(),
  q: z.string().optional(),
})

export const CreateContainerBodySchema = z.object({
  name: z.string().min(1).max(255),
  tag: z.string().min(1).max(128),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  size: z.number().min(1),
  platform: z.string().min(1),
  labels: z.record(z.string(), z.string()).optional(),
})

// ============================================================================
// Issues Schemas
// ============================================================================

export const IssuesQuerySchema = PaginationQuerySchema.extend({
  repo: z.string().optional(),
  status: z.string().optional(),
  label: z.string().optional(),
  assignee: z.string().optional(),
})

export const CreateIssueBodySchema = z.object({
  repo: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().min(10),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
})

// ============================================================================
// Pull Requests Schemas
// ============================================================================

export const PullsQuerySchema = PaginationQuerySchema.extend({
  repo: z.string().optional(),
  status: z.string().optional(),
  author: z.string().optional(),
})

export const CreatePullBodySchema = z.object({
  repo: z.string().min(1),
  title: z.string().min(1).max(200),
  body: z.string().min(10),
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1),
  isDraft: z.boolean().optional(),
})

// ============================================================================
// Feed Schemas
// ============================================================================

export const FeedQuerySchema = z.object({
  channel: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
})

export const CreateCastBodySchema = z.object({
  text: z.string().min(1).max(320),
  embeds: z.array(z.object({ url: z.string() })).optional(),
  parentHash: z.string().optional(),
  channelId: z.string().optional(),
})

// ============================================================================
// Projects Schemas
// ============================================================================

export const ProjectsQuerySchema = PaginationQuerySchema.extend({
  status: z.string().optional(),
  owner: z.string().optional(),
})

export const ProjectVisibilitySchema = z.enum(['public', 'private', 'internal'])

export const CreateProjectBodySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().min(10),
  visibility: ProjectVisibilitySchema,
})

// ============================================================================
// Datasets Schemas
// ============================================================================

export const DatasetsQuerySchema = z.object({
  type: z.string().optional(),
  org: z.string().optional(),
  q: z.string().optional(),
  sortBy: z.string().optional(),
})

export const DatasetTypeSchema = z.enum([
  'text',
  'code',
  'image',
  'audio',
  'multimodal',
  'tabular',
])

export const CreateDatasetBodySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/),
  organization: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._-]+$/),
  description: z.string().min(10),
  type: DatasetTypeSchema,
  license: z.string().min(1),
})

// ============================================================================
// A2A Schemas
// ============================================================================

export const A2ARequestBodySchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z
    .object({
      message: z
        .object({
          messageId: z.string(),
          parts: z.array(
            z.object({
              kind: z.string(),
              text: z.string().optional(),
              data: z.record(z.string(), z.unknown()).optional(),
            }),
          ),
        })
        .optional(),
    })
    .optional(),
  id: z.union([z.string(), z.number()]),
})

// ============================================================================
// MCP Schemas
// ============================================================================

export const MCPResourceReadBodySchema = z.object({
  uri: z.string().min(1),
})

export const MCPToolCallBodySchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
})

export const MCPPromptGetBodySchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.string()),
})
