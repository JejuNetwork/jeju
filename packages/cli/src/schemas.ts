/**
 * CLI Zod Schemas
 *
 * Validation schemas for CLI API responses.
 * Uses fail-fast validation - throws on invalid data instead of returning defaults.
 */

import { z } from 'zod'

// Re-export core validation utilities from @jejunetwork/types
export {
  expect,
  expectAddress,
  expectDefined,
  expectTrue,
  expectValid,
} from '@jejunetwork/types'

// ============================================================================
// Service Schemas
// ============================================================================

export const ServiceHealthResponseSchema = z.object({
  status: z.string(),
  service: z.string().optional(),
  version: z.string().optional(),
  uptime: z.number().optional(),
  mode: z.string().optional(),
  rpcUrl: z.string().optional(),
  services: z.record(z.string(), z.object({ status: z.string() })).optional(),
  backends: z
    .object({
      available: z.array(z.string()),
      health: z.record(z.string(), z.boolean()),
    })
    .optional(),
  decentralized: z
    .object({
      identityRegistry: z.string(),
      registeredNodes: z.number(),
      connectedPeers: z.number(),
      frontendCid: z.string(),
      p2pEnabled: z.boolean(),
    })
    .optional(),
})
export type ServiceHealthResponse = z.infer<typeof ServiceHealthResponseSchema>

// ============================================================================
// DWS API Response Schemas
// ============================================================================

export const UploadResponseSchema = z.object({
  cid: z.string(),
  backend: z.string().optional(),
  size: z.number().optional(),
})
export type UploadResponse = z.infer<typeof UploadResponseSchema>

export const RepoSchema = z.object({
  repoId: z.string(),
  owner: z.string(),
  name: z.string(),
  description: z.string().optional(),
  visibility: z.string().optional(),
  starCount: z.number().optional(),
  forkCount: z.number().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  defaultBranch: z.string().optional(),
  cloneUrl: z.string().optional(),
  branches: z
    .array(
      z.object({
        name: z.string(),
        tipCommit: z.string(),
        protected: z.boolean().optional(),
      }),
    )
    .optional(),
})
export type Repo = z.infer<typeof RepoSchema>

export const RepoListResponseSchema = z.object({
  repositories: z.array(RepoSchema),
  total: z.number().optional(),
})
export type RepoListResponse = z.infer<typeof RepoListResponseSchema>

export const CreateRepoResponseSchema = z.object({
  repoId: z.string(),
  cloneUrl: z.string(),
})
export type CreateRepoResponse = z.infer<typeof CreateRepoResponseSchema>

export const PackageSearchResultSchema = z.object({
  objects: z.array(
    z.object({
      package: z.object({
        name: z.string(),
        scope: z.string().optional(),
        version: z.string(),
        description: z.string().optional(),
        publisher: z.object({ username: z.string() }),
      }),
    }),
  ),
  total: z.number(),
})
export type PackageSearchResult = z.infer<typeof PackageSearchResultSchema>

export const PackageInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  'dist-tags': z.record(z.string(), z.string()).optional(),
  versions: z.record(
    z.string(),
    z.object({
      version: z.string(),
      description: z.string().optional(),
    }),
  ),
  time: z.record(z.string(), z.string()).optional(),
})
export type PackageInfo = z.infer<typeof PackageInfoSchema>

// ============================================================================
// CI/CD Schemas
// ============================================================================

export const WorkflowSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  triggers: z.array(z.string()),
  jobs: z.array(
    z.object({
      name: z.string(),
      stepCount: z.number(),
    }),
  ),
  active: z.boolean(),
})
export type Workflow = z.infer<typeof WorkflowSchema>

export const WorkflowListResponseSchema = z.object({
  workflows: z.array(WorkflowSchema),
})
export type WorkflowListResponse = z.infer<typeof WorkflowListResponseSchema>

export const CIRunSchema = z.object({
  runId: z.string(),
  workflowId: z.string(),
  repoId: z.string().optional(),
  status: z.string(),
  conclusion: z.string().nullable(),
  branch: z.string(),
  commitSha: z.string(),
  triggeredBy: z.string().optional(),
  startedAt: z.number(),
  completedAt: z.number().nullable(),
  duration: z.number().optional(),
  jobs: z
    .array(
      z.object({
        jobId: z.string(),
        name: z.string(),
        status: z.string(),
        conclusion: z.string().nullable(),
        steps: z.array(
          z.object({
            stepId: z.string(),
            name: z.string(),
            status: z.string(),
            conclusion: z.string().nullable(),
            exitCode: z.number().nullable(),
          }),
        ),
      }),
    )
    .optional(),
})
export type CIRun = z.infer<typeof CIRunSchema>

export const CIRunListResponseSchema = z.object({
  runs: z.array(CIRunSchema),
  total: z.number(),
})
export type CIRunListResponse = z.infer<typeof CIRunListResponseSchema>

// ============================================================================
// Inference Schemas
// ============================================================================

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ChatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  stream: z.boolean().optional(),
  provider: z.string().optional(),
})
export type ChatRequest = z.infer<typeof ChatRequestSchema>

// ============================================================================
// Validation Helper
// ============================================================================

/**
 * Validate data with a schema, throwing on failure
 */
export function validate<T>(
  data: unknown,
  schema: z.ZodType<T>,
  context?: string,
): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join(', ')
    throw new Error(
      `Validation failed${context ? ` in ${context}` : ''}: ${errors}`,
    )
  }
  return result.data
}
