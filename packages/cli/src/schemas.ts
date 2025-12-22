/**
 * CLI Zod Schemas
 *
 * Validation schemas for CLI API responses.
 * Uses fail-fast validation - throws on invalid data instead of returning defaults.
 */

import { z } from 'zod'

// ============================================================================
// Package.json Schema
// ============================================================================

export const PackageJsonSchema = z.object({
  name: z.string().min(1).max(214).optional(), // npm name limits
  version: z.string().min(1).max(256), // semver + metadata
  description: z.string().max(1000).optional(),
  main: z.string().min(1).max(500).optional(),
  scripts: z.record(z.string(), z.string().min(1)).optional(),
  dependencies: z.record(z.string(), z.string().min(1)).optional(),
  devDependencies: z.record(z.string(), z.string().min(1)).optional(),
})
export type PackageJson = z.infer<typeof PackageJsonSchema>

// ============================================================================
// GitHub API Schemas
// ============================================================================

export const GitHubReleaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
})
export type GitHubRelease = z.infer<typeof GitHubReleaseSchema>

// ============================================================================
// Commander Error Schema
// ============================================================================

export const CommanderErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string().optional(),
})
export type CommanderError = z.infer<typeof CommanderErrorSchema>

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
  cid: z.string().min(1).max(100), // CIDs have a max practical length
  backend: z.string().min(1).max(50).optional(),
  size: z.number().int().nonnegative().optional(),
})
export type UploadResponse = z.infer<typeof UploadResponseSchema>

// Simple CID response (for uploads that just return cid)
export const CidResponseSchema = z.object({
  cid: z.string().min(1).max(100),
})
export type CidResponse = z.infer<typeof CidResponseSchema>

export const JNSRegistrationResponseSchema = z.object({
  success: z.boolean(),
  name: z.string().min(1).max(255),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  total: z.number().int().nonnegative(),
  txHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
})
export type JNSRegistrationResponse = z.infer<
  typeof JNSRegistrationResponseSchema
>

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
  content: z.string().min(1).max(100000), // Reasonable max for chat content
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export const ChatRequestSchema = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(ChatMessageSchema).min(1).max(100),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(100000).optional(),
  stream: z.boolean().optional(),
  provider: z.string().min(1).max(50).optional(),
})
export type ChatRequest = z.infer<typeof ChatRequestSchema>

// ============================================================================
// Training API Response Schemas
// ============================================================================

export const DWSHealthResponseSchema = z.object({
  status: z.string(),
  services: z.record(z.string(), z.boolean()).optional(),
})
export type DWSHealthResponse = z.infer<typeof DWSHealthResponseSchema>

export const TrainingRunSchema = z.object({
  runId: z.string(),
  model: z.string(),
  state: z.number(),
  clients: z.number(),
  step: z.number(),
  totalSteps: z.number(),
  createdAt: z.number().optional(),
})
export type TrainingRun = z.infer<typeof TrainingRunSchema>

export const TrainingRunsResponseSchema = z.array(TrainingRunSchema)
export type TrainingRunsResponse = z.infer<typeof TrainingRunsResponseSchema>

export const DWSNodeSchema = z.object({
  address: z.string(),
  gpuTier: z.string(),
  score: z.number(),
})
export type DWSNode = z.infer<typeof DWSNodeSchema>

export const DWSNodesResponseSchema = z.array(DWSNodeSchema)
export type DWSNodesResponse = z.infer<typeof DWSNodesResponseSchema>

export const DWSModelSchema = z.object({
  name: z.string(),
  organization: z.string(),
  type: z.string(),
})
export type DWSModel = z.infer<typeof DWSModelSchema>

export const DWSModelsResponseSchema = z.array(DWSModelSchema)
export type DWSModelsResponse = z.infer<typeof DWSModelsResponseSchema>

export const RLAIFRunCreateResponseSchema = z.object({
  runId: z.string(),
  status: z.string().optional(),
})
export type RLAIFRunCreateResponse = z.infer<
  typeof RLAIFRunCreateResponseSchema
>

export const RLAIFIterationSchema = z.object({
  iteration: z.number(),
  state: z.number(),
  evalPassed: z.boolean().optional(),
  metrics: z
    .object({
      evalScore: z.number().optional(),
    })
    .optional(),
})
export type RLAIFIteration = z.infer<typeof RLAIFIterationSchema>

export const RLAIFStatusResponseSchema = z.object({
  config: z.object({
    runId: z.string(),
    environment: z.object({ id: z.string() }),
    targetIterations: z.number(),
  }),
  state: z.number(),
  currentIteration: z.number(),
  currentPolicyCID: z.string(),
  bestPolicyCID: z.string().optional(),
  bestEvalScore: z.number().optional(),
  iterations: z.array(RLAIFIterationSchema),
})
export type RLAIFStatusResponse = z.infer<typeof RLAIFStatusResponseSchema>

export const RLAIFRunSummarySchema = z.object({
  runId: z.string(),
  environment: z.string(),
  state: z.number(),
  currentIteration: z.number(),
  targetIterations: z.number(),
})
export type RLAIFRunSummary = z.infer<typeof RLAIFRunSummarySchema>

export const RLAIFRunsListResponseSchema = z.array(RLAIFRunSummarySchema)
export type RLAIFRunsListResponse = z.infer<typeof RLAIFRunsListResponseSchema>

export const ManifestResponseSchema = z.object({
  trajectoryCIDs: z.array(z.string()),
  totalCount: z.number(),
})
export type ManifestResponse = z.infer<typeof ManifestResponseSchema>

export const TrajectorySubmitResponseSchema = z.object({
  trajectoryCount: z.number(),
})
export type TrajectorySubmitResponse = z.infer<
  typeof TrajectorySubmitResponseSchema
>

// Score/Judge response for RLAIF labeling
export const ScoreResponseSchema = z.object({
  rewardsCID: z.string(),
  count: z.number(),
  averageScore: z.number(),
})
export type ScoreResponse = z.infer<typeof ScoreResponseSchema>

// Benchmark response
export const BenchmarkResultsSchema = z.object({
  score: z.number(),
  baselineScore: z.number().optional(),
  improvement: z.number().optional(),
  metrics: z.record(z.string(), z.number()),
})
export type BenchmarkResults = z.infer<typeof BenchmarkResultsSchema>

export const BenchmarkResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  results: BenchmarkResultsSchema.optional(),
})
export type BenchmarkResponse = z.infer<typeof BenchmarkResponseSchema>

// ============================================================================
// Compute API Response Schemas
// ============================================================================

export const ComputeHealthResponseSchema = z.object({
  service: z.string().optional(),
  status: z.string(),
  activeJobs: z.number().optional(),
  maxConcurrent: z.number().optional(),
  queuedJobs: z.number().optional(),
})
export type ComputeHealthResponse = z.infer<typeof ComputeHealthResponseSchema>

export const JobSubmitResponseSchema = z.object({
  jobId: z.string().min(1).max(100),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'queued']),
})
export type JobSubmitResponse = z.infer<typeof JobSubmitResponseSchema>

export const ComputeJobSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  exitCode: z.number().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
})
export type ComputeJob = z.infer<typeof ComputeJobSchema>

export const JobsListResponseSchema = z.object({
  jobs: z.array(ComputeJobSchema),
  total: z.number(),
})
export type JobsListResponse = z.infer<typeof JobsListResponseSchema>

export const JobDetailsResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  output: z.string().optional(),
  exitCode: z.number().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  duration: z.number().nullable(),
})
export type JobDetailsResponse = z.infer<typeof JobDetailsResponseSchema>

export const InferenceChoiceSchema = z.object({
  message: z.object({
    content: z.string(),
  }),
})
export type InferenceChoice = z.infer<typeof InferenceChoiceSchema>

export const InferenceUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
})
export type InferenceUsage = z.infer<typeof InferenceUsageSchema>

export const InferenceResponseSchema = z.object({
  choices: z.array(InferenceChoiceSchema),
  usage: InferenceUsageSchema,
})
export type InferenceResponse = z.infer<typeof InferenceResponseSchema>

// Anthropic API response schema
export const AnthropicUsageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
})
export type AnthropicUsage = z.infer<typeof AnthropicUsageSchema>

export const AnthropicContentSchema = z.object({
  text: z.string(),
})
export type AnthropicContent = z.infer<typeof AnthropicContentSchema>

export const AnthropicResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  content: z.array(AnthropicContentSchema),
  usage: AnthropicUsageSchema,
  stop_reason: z.string().optional(),
})
export type AnthropicResponse = z.infer<typeof AnthropicResponseSchema>

// Google Gemini API response schema
export const GeminiPartSchema = z.object({
  text: z.string(),
})

export const GeminiContentSchema = z.object({
  role: z.string().optional(),
  parts: z.array(GeminiPartSchema),
})

export const GeminiCandidateSchema = z.object({
  content: GeminiContentSchema.optional(),
  finishReason: z.string().optional(),
})

export const GeminiUsageSchema = z.object({
  promptTokenCount: z.number().optional(),
  candidatesTokenCount: z.number().optional(),
  totalTokenCount: z.number().optional(),
})

export const GeminiResponseSchema = z.object({
  candidates: z.array(GeminiCandidateSchema).optional(),
  usageMetadata: GeminiUsageSchema.optional(),
})
export type GeminiResponse = z.infer<typeof GeminiResponseSchema>

// Cohere API response schema
export const CohereResponseSchema = z.object({
  generation_id: z.string().optional(),
  text: z.string().optional(),
  finish_reason: z.string().optional(),
  meta: z
    .object({
      billed_units: z
        .object({
          input_tokens: z.number().optional(),
          output_tokens: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
})
export type CohereResponse = z.infer<typeof CohereResponseSchema>

// OpenAI-compatible response schema (for various providers)
export const OpenAIChoiceSchema = z.object({
  message: z.object({
    role: z.string().optional(),
    content: z.string(),
  }),
  finish_reason: z.string().optional(),
})

export const OpenAIUsageSchema = z.object({
  prompt_tokens: z.number().optional(),
  completion_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
})

export const OpenAIResponseSchema = z.object({
  id: z.string().optional(),
  object: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(OpenAIChoiceSchema),
  usage: OpenAIUsageSchema.optional(),
})
export type OpenAIResponse = z.infer<typeof OpenAIResponseSchema>

// Union type for all provider responses
export const ProviderResponseSchema = z.union([
  AnthropicResponseSchema,
  GeminiResponseSchema,
  CohereResponseSchema,
  OpenAIResponseSchema,
])
export type ProviderResponse = z.infer<typeof ProviderResponseSchema>

// ============================================================================
// CDN Health Response Schema
// ============================================================================

export const CDNHealthResponseSchema = z.object({
  status: z.string(),
  service: z.string(),
  cache: z
    .object({
      entries: z.number(),
      hitRate: z.number(),
    })
    .optional(),
  edgeNodes: z.number().optional(),
})
export type CDNHealthResponse = z.infer<typeof CDNHealthResponseSchema>

// ============================================================================
// RPC Response Schemas
// ============================================================================

export const EthChainIdResponseSchema = z.object({
  result: z.string().optional(),
  error: z
    .object({
      message: z.string(),
    })
    .optional(),
})
export type EthChainIdResponse = z.infer<typeof EthChainIdResponseSchema>

// ============================================================================
// Price API Response Schemas
// ============================================================================

export const CoinGeckoPriceResponseSchema = z.object({
  ethereum: z
    .object({
      usd: z.number(),
    })
    .optional(),
  bitcoin: z
    .object({
      usd: z.number(),
    })
    .optional(),
})
export type CoinGeckoPriceResponse = z.infer<
  typeof CoinGeckoPriceResponseSchema
>

export const PriceDataResponseSchema = z.object({
  price: z.number().optional(),
  priceRaw: z.string().optional(),
})
export type PriceDataResponse = z.infer<typeof PriceDataResponseSchema>

// ============================================================================
// Federation Contract Response Schemas
// ============================================================================

export const NetworkDetailsSchema = z.object({
  chainId: z.bigint(),
  name: z.string(),
  rpcUrl: z.string(),
  operator: z.string(),
  stake: z.bigint(),
  trustTier: z.number(),
  isActive: z.boolean(),
  isVerified: z.boolean(),
  isSuperchain: z.boolean(),
  registeredAt: z.bigint(),
})
export type NetworkDetails = z.infer<typeof NetworkDetailsSchema>

export const NetworkListItemSchema = z.object({
  chainId: z.bigint(),
  name: z.string(),
  rpcUrl: z.string(),
  stake: z.bigint(),
  trustTier: z.number(),
  isActive: z.boolean(),
})
export type NetworkListItem = z.infer<typeof NetworkListItemSchema>

export const RegistryDetailsSchema = z.object({
  chainId: z.bigint(),
  name: z.string(),
  registryType: z.number(),
  contractAddress: z.string(),
  entryCount: z.bigint(),
  lastSyncBlock: z.bigint(),
})
export type RegistryDetails = z.infer<typeof RegistryDetailsSchema>

// ============================================================================
// Validation Helper
// ============================================================================

/**
 * Validate data with a schema, throwing on failure
 * Note: Uses different parameter order than expectValid from @jejunetwork/types
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
