/**
 * Zod Schemas for Factory API
 *
 * Comprehensive validation schemas for all API endpoints.
 * These schemas enforce strict validation and fail-fast on invalid data.
 */

import { AddressSchema } from '@jejunetwork/types'
import { z } from 'zod'

// ============================================================================
// Common Schemas
// ============================================================================

export const addressSchema = AddressSchema

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

// ============================================================================
// Bounty Schemas
// ============================================================================

export const bountyStatusSchema = z.enum([
  'open',
  'in_progress',
  'review',
  'completed',
  'cancelled',
])

export const bountyMilestoneSchema = z.object({
  name: z.string().min(1, 'Milestone name is required'),
  description: z.string().min(1, 'Milestone description is required'),
  reward: z.string().regex(/^\d+(\.\d+)?$/, 'Reward must be a valid number'),
  currency: z.string().min(1, 'Currency is required'),
  deadline: z.number().int().positive('Deadline must be a positive timestamp'),
})

export const createBountySchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  reward: z.string().regex(/^\d+(\.\d+)?$/, 'Reward must be a valid number'),
  currency: z.string().min(1, 'Currency is required'),
  skills: z.array(z.string().min(1)).min(1, 'At least one skill is required'),
  deadline: z.number().int().positive('Deadline must be a positive timestamp'),
  milestones: z.array(bountyMilestoneSchema).optional(),
})

export const getBountiesQuerySchema = paginationSchema.extend({
  status: bountyStatusSchema.optional(),
  skill: z.string().optional(),
  minReward: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'minReward must be a valid number')
    .optional(),
  maxReward: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'maxReward must be a valid number')
    .optional(),
})

// ============================================================================
// Job Schemas
// ============================================================================

export const jobTypeSchema = z.enum([
  'full-time',
  'part-time',
  'contract',
  'bounty',
])

export const salarySchema = z
  .object({
    min: z.number().positive('Min salary must be positive'),
    max: z.number().positive('Max salary must be positive'),
    currency: z.string().min(1, 'Currency is required'),
    period: z.enum(['hour', 'day', 'week', 'month', 'year']).optional(),
  })
  .refine((data) => data.max >= data.min, {
    message: 'Max salary must be greater than or equal to min salary',
    path: ['max'],
  })

export const createJobSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters'),
  company: z
    .string()
    .min(1, 'Company is required')
    .max(100, 'Company must be less than 100 characters'),
  type: jobTypeSchema,
  remote: z.boolean(),
  location: z.string().min(1, 'Location is required'),
  salary: salarySchema.optional(),
  skills: z.array(z.string().min(1)).min(1, 'At least one skill is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
})

export const getJobsQuerySchema = paginationSchema.extend({
  type: jobTypeSchema.optional(),
  remote: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  skill: z.string().optional(),
})

// ============================================================================
// Project Schemas
// ============================================================================

export const projectStatusSchema = z.enum([
  'active',
  'archived',
  'completed',
  'on_hold',
])

export const projectVisibilitySchema = z.enum(['public', 'private', 'internal'])

export const createProjectSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  visibility: projectVisibilitySchema,
})

export const getProjectsQuerySchema = paginationSchema.extend({
  status: projectStatusSchema.optional(),
  owner: addressSchema.optional(),
})

// ============================================================================
// Git Schemas
// ============================================================================

export const createRepositorySchema = z.object({
  name: z
    .string()
    .min(1, 'Repository name is required')
    .max(100, 'Repository name must be less than 100 characters')
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'Repository name can only contain alphanumeric characters, dots, underscores, and hyphens',
    ),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),
  isPrivate: z.boolean().optional().default(false),
})

export const getRepositoriesQuerySchema = z.object({
  owner: addressSchema.optional(),
})

// ============================================================================
// Package Schemas
// ============================================================================

export const packageMetadataSchema = z.object({
  name: z
    .string()
    .min(1, 'Package name is required')
    .max(214, 'Package name must be less than 214 characters')
    .regex(
      /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
      'Invalid package name format',
    ),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-.+)?$/, 'Version must follow semantic versioning'),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional(),
  author: z.string().min(1, 'Author is required'),
  license: z.string().min(1, 'License is required'),
  dependencies: z.record(z.string(), z.string()).optional(),
})

export const getPackagesQuerySchema = z.object({
  q: z.string().optional(),
})

// ============================================================================
// Model Schemas
// ============================================================================

export const modelTypeSchema = z.enum([
  'llm',
  'embedding',
  'image',
  'audio',
  'multimodal',
  'code',
])

export const createModelSchema = z.object({
  name: z
    .string()
    .min(1, 'Model name is required')
    .max(100, 'Model name must be less than 100 characters')
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'Model name can only contain alphanumeric characters, dots, underscores, and hyphens',
    ),
  organization: z
    .string()
    .min(1, 'Organization is required')
    .max(100, 'Organization must be less than 100 characters')
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'Organization can only contain alphanumeric characters, dots, underscores, and hyphens',
    ),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  type: modelTypeSchema,
})

export const getModelsQuerySchema = z.object({
  type: modelTypeSchema.optional(),
  org: z.string().optional(),
  q: z.string().optional(),
})

// ============================================================================
// Container Schemas
// ============================================================================

export const createContainerSchema = z.object({
  name: z
    .string()
    .min(1, 'Container name is required')
    .max(255, 'Container name must be less than 255 characters')
    .regex(
      /^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/,
      'Invalid container name format',
    ),
  tag: z
    .string()
    .min(1, 'Tag is required')
    .max(128, 'Tag must be less than 128 characters')
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'Tag can only contain alphanumeric characters, dots, underscores, and hyphens',
    ),
  digest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/, 'Digest must be a valid sha256 hash'),
  size: z.number().int().positive('Size must be a positive integer'),
  platform: z.string().min(1, 'Platform is required'),
  labels: z.record(z.string(), z.string()).optional(),
})

export const getContainersQuerySchema = z.object({
  org: z.string().optional(),
  q: z.string().optional(),
})

// ============================================================================
// Dataset Schemas
// ============================================================================

export const datasetTypeSchema = z.enum([
  'text',
  'code',
  'image',
  'audio',
  'multimodal',
  'tabular',
])

export const createDatasetSchema = z.object({
  name: z
    .string()
    .min(1, 'Dataset name is required')
    .max(100, 'Dataset name must be less than 100 characters')
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'Dataset name can only contain alphanumeric characters, dots, underscores, and hyphens',
    ),
  organization: z
    .string()
    .min(1, 'Organization is required')
    .max(100, 'Organization must be less than 100 characters')
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'Organization can only contain alphanumeric characters, dots, underscores, and hyphens',
    ),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  type: datasetTypeSchema,
  license: z.string().min(1, 'License is required'),
})

export const getDatasetsQuerySchema = z.object({
  type: datasetTypeSchema.optional(),
  org: z.string().optional(),
  q: z.string().optional(),
  sortBy: z
    .enum(['downloads', 'stars', 'createdAt', 'updatedAt'])
    .optional()
    .default('downloads'),
})

// ============================================================================
// Agent Schemas
// ============================================================================

export const agentTypeSchema = z.enum(['ai_agent', 'trading_bot', 'org_tool'])

export const agentStatusSchema = z.enum(['active', 'inactive', 'banned'])

export const createAgentSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  type: agentTypeSchema,
  // Agent config allows arbitrary JSON as each agent type has different config requirements
  config: z.record(z.string(), z.unknown()),
  modelId: z.string().optional(),
})

export const getAgentsQuerySchema = z.object({
  type: agentTypeSchema.optional(),
  status: agentStatusSchema.optional(),
  q: z.string().optional(),
})

// ============================================================================
// Issue Schemas
// ============================================================================

export const issueStatusSchema = z.enum(['open', 'closed'])

export const createIssueSchema = z.object({
  repo: z.string().min(1, 'Repository is required'),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters'),
  body: z.string().min(10, 'Body must be at least 10 characters'),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
})

export const getIssuesQuerySchema = paginationSchema.extend({
  repo: z.string().optional(),
  status: issueStatusSchema.optional(),
  label: z.string().optional(),
  assignee: addressSchema.optional(),
})

// ============================================================================
// Pull Request Schemas
// ============================================================================

export const pullRequestStatusSchema = z.enum(['open', 'closed', 'merged'])

export const createPullRequestSchema = z.object({
  repo: z.string().min(1, 'Repository is required'),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters'),
  body: z.string().min(10, 'Body must be at least 10 characters'),
  sourceBranch: z.string().min(1, 'Source branch is required'),
  targetBranch: z.string().min(1, 'Target branch is required'),
  isDraft: z.boolean().optional().default(false),
})

export const getPullsQuerySchema = paginationSchema.extend({
  repo: z.string().optional(),
  status: pullRequestStatusSchema.optional(),
  author: addressSchema.optional(),
})

// ============================================================================
// Feed Schemas
// ============================================================================

export const createFeedPostSchema = z.object({
  text: z
    .string()
    .min(1, 'Text is required')
    .max(320, 'Text must be less than 320 characters'),
  embeds: z
    .array(z.object({ url: z.string().url('Invalid embed URL') }))
    .optional(),
  parentHash: z.string().optional(),
  channelId: z.string().optional(),
})

export const getFeedQuerySchema = z.object({
  channel: z.string().optional(),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .default('20')
    .transform((val) => {
      const parsed = parseInt(val, 10)
      if (Number.isNaN(parsed) || parsed < 1 || parsed > 100) {
        throw new Error('Limit must be between 1 and 100')
      }
      return parsed
    }),
})

// ============================================================================
// CI Schemas
// ============================================================================

export const ciStatusSchema = z.enum([
  'queued',
  'running',
  'success',
  'failure',
  'cancelled',
])

export const createCIRunSchema = z.object({
  repo: z.string().min(1, 'Repository is required'),
  workflow: z.string().min(1, 'Workflow is required'),
  branch: z.string().min(1, 'Branch is required'),
  inputs: z.record(z.string(), z.string()).optional(),
})

export const getCIQuerySchema = paginationSchema.extend({
  repo: z.string().optional(),
  status: ciStatusSchema.optional(),
  branch: z.string().optional(),
})
