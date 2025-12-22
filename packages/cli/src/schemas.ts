/**
 * CLI Zod Schemas
 * 
 * Validation schemas for CLI inputs, API responses, and configuration.
 * Uses fail-fast validation - throws on invalid data instead of returning defaults.
 */

import { z } from 'zod';
import { isAddress, type Address, type Hex } from 'viem';

// Re-export core validation utilities from @jejunetwork/types
export { expect, expectValid, expectAddress, expectTrue, expectDefined } from '@jejunetwork/types/validation';

// ============================================================================
// Core Primitive Schemas
// ============================================================================

export const AddressSchema = z.string().refine(
  (val): val is Address => isAddress(val),
  { message: 'Invalid Ethereum address' }
) as unknown as z.ZodType<Address>;

export const HexSchema = z.string().refine(
  (val): val is Hex => /^0x[0-9a-fA-F]*$/.test(val),
  { message: 'Invalid hex string' }
);

export const NetworkTypeSchema = z.enum(['localnet', 'testnet', 'mainnet']);
export type NetworkType = z.infer<typeof NetworkTypeSchema>;

// ============================================================================
// Chain Status Schemas
// ============================================================================

export const ChainStatusSchema = z.object({
  running: z.boolean(),
  l1Rpc: z.string().optional(),
  l2Rpc: z.string().optional(),
  chainId: z.number().optional(),
  blockNumber: z.bigint().optional(),
});
export type ChainStatus = z.infer<typeof ChainStatusSchema>;

// ============================================================================
// Health Check Schemas
// ============================================================================

export const HealthStatusSchema = z.enum(['ok', 'warn', 'error']);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const HealthCheckResultSchema = z.object({
  name: z.string(),
  status: HealthStatusSchema,
  message: z.string(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type HealthCheckResult = z.infer<typeof HealthCheckResultSchema>;

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
  backends: z.object({
    available: z.array(z.string()),
    health: z.record(z.string(), z.boolean()),
  }).optional(),
  decentralized: z.object({
    identityRegistry: z.string(),
    registeredNodes: z.number(),
    connectedPeers: z.number(),
    frontendCid: z.string(),
    p2pEnabled: z.boolean(),
  }).optional(),
});
export type ServiceHealthResponse = z.infer<typeof ServiceHealthResponseSchema>;

export const ServiceStatusSchema = z.object({
  name: z.string(),
  status: z.enum(['running', 'stopped', 'starting', 'error']),
  port: z.number().optional(),
  url: z.string().optional(),
  healthy: z.boolean(),
});
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

// ============================================================================
// DWS API Response Schemas
// ============================================================================

export const UploadResponseSchema = z.object({
  cid: z.string(),
  backend: z.string().optional(),
  size: z.number().optional(),
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

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
  branches: z.array(z.object({
    name: z.string(),
    tipCommit: z.string(),
    protected: z.boolean().optional(),
  })).optional(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const RepoListResponseSchema = z.object({
  repositories: z.array(RepoSchema),
  total: z.number().optional(),
});
export type RepoListResponse = z.infer<typeof RepoListResponseSchema>;

export const CreateRepoResponseSchema = z.object({
  repoId: z.string(),
  cloneUrl: z.string(),
});
export type CreateRepoResponse = z.infer<typeof CreateRepoResponseSchema>;

export const PackageSearchResultSchema = z.object({
  objects: z.array(z.object({
    package: z.object({
      name: z.string(),
      scope: z.string().optional(),
      version: z.string(),
      description: z.string().optional(),
      publisher: z.object({ username: z.string() }),
    }),
  })),
  total: z.number(),
});
export type PackageSearchResult = z.infer<typeof PackageSearchResultSchema>;

export const PackageInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  'dist-tags': z.record(z.string(), z.string()).optional(),
  versions: z.record(z.string(), z.object({
    version: z.string(),
    description: z.string().optional(),
  })),
  time: z.record(z.string(), z.string()).optional(),
});
export type PackageInfo = z.infer<typeof PackageInfoSchema>;

// ============================================================================
// CI/CD Schemas
// ============================================================================

export const WorkflowSchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  triggers: z.array(z.string()),
  jobs: z.array(z.object({
    name: z.string(),
    stepCount: z.number(),
  })),
  active: z.boolean(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const WorkflowListResponseSchema = z.object({
  workflows: z.array(WorkflowSchema),
});
export type WorkflowListResponse = z.infer<typeof WorkflowListResponseSchema>;

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
  jobs: z.array(z.object({
    jobId: z.string(),
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullable(),
    steps: z.array(z.object({
      stepId: z.string(),
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      exitCode: z.number().nullable(),
    })),
  })).optional(),
});
export type CIRun = z.infer<typeof CIRunSchema>;

export const CIRunListResponseSchema = z.object({
  runs: z.array(CIRunSchema),
  total: z.number(),
});
export type CIRunListResponse = z.infer<typeof CIRunListResponseSchema>;

// ============================================================================
// Oracle Schemas
// ============================================================================

export const PriceDataSchema = z.object({
  price: z.number(),
  priceRaw: z.string().optional(),
  decimals: z.number().optional(),
  timestamp: z.number(),
  source: z.string(),
});
export type PriceData = z.infer<typeof PriceDataSchema>;

export const PricesResponseSchema = z.record(z.string(), PriceDataSchema);
export type PricesResponse = z.infer<typeof PricesResponseSchema>;

// ============================================================================
// Inference Schemas
// ============================================================================

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  stream: z.boolean().optional(),
  provider: z.string().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  model: z.string(),
  created: z.number().optional(),
  choices: z.array(z.object({
    index: z.number().optional(),
    message: z.object({
      role: z.literal('assistant'),
      content: z.string(),
    }),
    finish_reason: z.string().optional(),
  })),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }).optional(),
});
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponseSchema>;

// ============================================================================
// Config Schemas
// ============================================================================

export const KeyConfigSchema = z.object({
  name: z.string(),
  address: z.string(),
  privateKey: z.string(),
  role: z.string().optional(),
});
export type KeyConfig = z.infer<typeof KeyConfigSchema>;

export const KeySetSchema = z.object({
  network: NetworkTypeSchema,
  created: z.string(),
  keys: z.array(KeyConfigSchema),
  encrypted: z.boolean().optional(),
});
export type KeySet = z.infer<typeof KeySetSchema>;

export const DeployConfigSchema = z.object({
  network: NetworkTypeSchema,
  lastDeployed: z.string().optional(),
  deployerAddress: z.string().optional(),
  contracts: z.boolean().optional(),
  infrastructure: z.boolean().optional(),
  apps: z.boolean().optional(),
});
export type DeployConfig = z.infer<typeof DeployConfigSchema>;

export const PortsConfigSchema = z.object({
  l1Port: z.number(),
  l2Port: z.number(),
  cqlPort: z.number().optional(),
  l1Rpc: z.string(),
  l2Rpc: z.string(),
  cqlApi: z.string().nullable().optional(),
  chainId: z.number(),
  timestamp: z.string(),
});
export type PortsConfig = z.infer<typeof PortsConfigSchema>;

// ============================================================================
// App Manifest Schema
// ============================================================================

export const AppTestConfigSchema = z.object({
  unit: z.object({
    command: z.string(),
    timeout: z.number().optional(),
  }).optional(),
  e2e: z.object({
    command: z.string(),
    config: z.string().optional(),
    timeout: z.number().optional(),
    requiresChain: z.boolean().optional(),
    requiresWallet: z.boolean().optional(),
  }).optional(),
  integration: z.object({
    command: z.string(),
    timeout: z.number().optional(),
  }).optional(),
  services: z.array(z.string()).optional(),
});
export type AppTestConfig = z.infer<typeof AppTestConfigSchema>;

export const AppManifestSchema = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  version: z.string(),
  type: z.enum(['core', 'vendor', 'service']),
  description: z.string().optional(),
  commands: z.object({
    dev: z.string().optional(),
    build: z.string().optional(),
    test: z.string().optional(),
    start: z.string().optional(),
  }).optional(),
  ports: z.record(z.string(), z.number()).optional(),
  dependencies: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  testing: AppTestConfigSchema.optional(),
});
export type AppManifest = z.infer<typeof AppManifestSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Parse and validate JSON with a schema, throwing on failure
 */
export function parseJson<T>(json: string, schema: z.ZodType<T>, context?: string): T {
  const parsed = JSON.parse(json);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation failed${context ? ` in ${context}` : ''}: ${errors}`);
  }
  return result.data;
}

/**
 * Validate data with a schema, throwing on failure
 */
export function validate<T>(data: unknown, schema: z.ZodType<T>, context?: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Validation failed${context ? ` in ${context}` : ''}: ${errors}`);
  }
  return result.data;
}

/**
 * Validate data with a schema, returning null on failure (use sparingly)
 */
export function validateOrNull<T>(data: unknown, schema: z.ZodType<T>): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}
