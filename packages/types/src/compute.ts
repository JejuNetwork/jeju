/**
 * @fileoverview Compute Marketplace Types
 *
 * Types for the decentralized AI compute marketplace.
 * Includes Zod schemas for runtime validation.
 */

import { z } from 'zod';
import { AddressSchema, HashSchema } from './validation';

// ============================================================================
// Status Schemas
// ============================================================================

/**
 * Run/Job execution status schema
 */
export const RunStatusSchema = z.enum([
  'queued',       // Waiting to start
  'waiting',      // Waiting for dependencies
  'in_progress',  // Currently executing
  'started',      // Started (alias for in_progress)
  'completed',    // Successfully finished
  'failed',       // Execution failed
  'cancelled',    // User cancelled
  'skipped',      // Skipped due to conditions
  'timeout',      // Execution timed out
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** Job status schema (alias for RunStatus for backward compatibility) */
export const JobStatusSchema = RunStatusSchema;
export type JobStatus = RunStatus;

/**
 * Todo/Task status schema
 */
export const TodoStatusSchema = z.enum([
  'pending',      // Not started
  'in_progress',  // Currently being worked on
  'completed',    // Finished successfully
  'cancelled',    // Cancelled/abandoned
]);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;

/** Execution status schema (alias for RunStatus for backward compatibility) */
export const ExecutionStatusSchema = RunStatusSchema;
export type ExecutionStatus = RunStatus;

// ============================================================================
// Provider Schemas
// ============================================================================

export const ComputeProviderSchema = z.object({
  address: AddressSchema,
  name: z.string(),
  endpoint: z.string().url(),
  attestationHash: HashSchema,
  stake: z.bigint(),
  registeredAt: z.number(),
  agentId: z.number().int().nonnegative(),
  active: z.boolean(),
});
export type ComputeProvider = z.infer<typeof ComputeProviderSchema>;

export const ComputeCapabilitySchema = z.object({
  model: z.string(),
  pricePerInputToken: z.bigint(),
  pricePerOutputToken: z.bigint(),
  maxContextLength: z.number().int().positive(),
  active: z.boolean(),
});
export type ComputeCapability = z.infer<typeof ComputeCapabilitySchema>;

// ============================================================================
// Ledger Types
// ============================================================================

export const ComputeLedgerSchema = z.object({
  totalBalance: z.bigint(),
  availableBalance: z.bigint(),
  lockedBalance: z.bigint(),
  createdAt: z.number(),
});
export type ComputeLedger = z.infer<typeof ComputeLedgerSchema>;

export const ProviderSubAccountSchema = z.object({
  balance: z.bigint(),
  pendingRefund: z.bigint(),
  refundUnlockTime: z.number(),
  acknowledged: z.boolean(),
});
export type ProviderSubAccount = z.infer<typeof ProviderSubAccountSchema>;

// ============================================================================
// Inference Schemas
// ============================================================================

export const InferenceServiceSchema = z.object({
  provider: AddressSchema,
  model: z.string(),
  endpoint: z.string().url(),
  pricePerInputToken: z.bigint(),
  pricePerOutputToken: z.bigint(),
  active: z.boolean(),
});
export type InferenceService = z.infer<typeof InferenceServiceSchema>;

export const InferenceSettlementSchema = z.object({
  user: AddressSchema,
  provider: AddressSchema,
  requestHash: HashSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  fee: z.bigint(),
  timestamp: z.number(),
});
export type InferenceSettlement = z.infer<typeof InferenceSettlementSchema>;

export const ChatMessageRoleSchema = z.enum(['system', 'user', 'assistant']);
export type ChatMessageRole = z.infer<typeof ChatMessageRoleSchema>;

export const ChatMessageSchema = z.object({
  role: ChatMessageRoleSchema,
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const InferenceRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  seed: z.number().int().optional(),
});
export type InferenceRequest = z.infer<typeof InferenceRequestSchema>;

export const FinishReasonSchema = z.enum(['stop', 'length', 'content_filter']).nullable();
export type FinishReason = z.infer<typeof FinishReasonSchema>;

export const InferenceChoiceSchema = z.object({
  message: ChatMessageSchema,
  finish_reason: FinishReasonSchema,
});
export type InferenceChoice = z.infer<typeof InferenceChoiceSchema>;

export const TokenUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const SettlementInfoSchema = z.object({
  provider: AddressSchema,
  requestHash: HashSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  nonce: z.number().int().nonnegative(),
  signature: z.string(),
});
export type SettlementInfo = z.infer<typeof SettlementInfoSchema>;

export const InferenceResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(InferenceChoiceSchema),
  usage: TokenUsageSchema,
  settlement: SettlementInfoSchema.optional(),
});
export type InferenceResponse = z.infer<typeof InferenceResponseSchema>;

// ============================================================================
// Staking Schemas
// ============================================================================

export const ComputeStakeTypeSchema = z.enum(['NONE', 'USER', 'PROVIDER', 'GUARDIAN']);
export type ComputeStakeTypeEnum = z.infer<typeof ComputeStakeTypeSchema>;

/** Numeric enum for contract compatibility */
export enum ComputeStakeType {
  NONE = 0,
  USER = 1,
  PROVIDER = 2,
  GUARDIAN = 3,
}

export const ComputeStakeSchema = z.object({
  amount: z.bigint(),
  stakeType: z.nativeEnum(ComputeStakeType),
  stakedAt: z.number(),
  lockedUntil: z.number(),
  slashed: z.boolean(),
});
export type ComputeStake = z.infer<typeof ComputeStakeSchema>;

// ============================================================================
// Hardware Types
// ============================================================================

export const PlatformSchema = z.enum(['darwin', 'linux', 'win32']);
export type Platform = z.infer<typeof PlatformSchema>;

export const ArchitectureSchema = z.enum(['arm64', 'x64']);
export type Architecture = z.infer<typeof ArchitectureSchema>;

export const HardwareInfoSchema = z.object({
  platform: PlatformSchema,
  arch: ArchitectureSchema,
  cpus: z.number().int().positive(),
  memory: z.number().positive(),
  gpuType: z.string().nullable(),
  gpuVram: z.number().nullable(),
  cudaVersion: z.string().nullable(),
  mlxVersion: z.string().nullable(),
});
export type HardwareInfo = z.infer<typeof HardwareInfoSchema>;

export const AttestationReportSchema = z.object({
  signingAddress: z.string(),
  hardware: HardwareInfoSchema,
  timestamp: z.string(),
  nonce: z.string(),
  signature: z.string(),
  simulated: z.boolean(),
});
export type AttestationReport = z.infer<typeof AttestationReportSchema>;

// ============================================================================
// SDK Configuration Types
// ============================================================================

export const ComputeSDKConfigSchema = z.object({
  rpcUrl: z.string().url(),
  privateKey: z.string().optional(),
  contracts: z.object({
    registry: AddressSchema,
    ledger: AddressSchema,
    inference: AddressSchema,
  }),
});
export type ComputeSDKConfig = z.infer<typeof ComputeSDKConfigSchema>;

export const ModerationSDKConfigSchema = z.object({
  rpcUrl: z.string().url(),
  privateKey: z.string().optional(),
  contracts: z.object({
    staking: AddressSchema,
    banManager: AddressSchema,
  }),
});
export type ModerationSDKConfig = z.infer<typeof ModerationSDKConfigSchema>;

// ============================================================================
// Auth Types
// ============================================================================

export const ComputeAuthHeadersSchema = z.object({
  'x-jeju-address': z.string(),
  'x-jeju-nonce': z.string(),
  'x-jeju-signature': z.string(),
  'x-jeju-timestamp': z.string(),
});
export type ComputeAuthHeaders = z.infer<typeof ComputeAuthHeadersSchema>;

// ============================================================================
// Node Configuration Types
// ============================================================================

export const ModelBackendSchema = z.enum(['ollama', 'llamacpp', 'mock']);
export type ModelBackend = z.infer<typeof ModelBackendSchema>;

export const ModelConfigSchema = z.object({
  name: z.string(),
  backend: ModelBackendSchema,
  endpoint: z.string().url().optional(),
  pricePerInputToken: z.bigint(),
  pricePerOutputToken: z.bigint(),
  maxContextLength: z.number().int().positive(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const ComputeNodeConfigSchema = z.object({
  privateKey: z.string(),
  registryAddress: AddressSchema,
  ledgerAddress: AddressSchema,
  inferenceAddress: AddressSchema,
  rpcUrl: z.string().url(),
  port: z.number().int().positive(),
  models: z.array(ModelConfigSchema),
});
export type ComputeNodeConfig = z.infer<typeof ComputeNodeConfigSchema>;

// ============================================================================
// Network Types
// ============================================================================

export const ComputeNetworkSchema = z.object({
  name: z.string(),
  chainId: z.number().int().positive(),
  rpcUrl: z.string().url(),
  explorer: z.string().url(),
});
export type ComputeNetwork = z.infer<typeof ComputeNetworkSchema>;

export const ComputeDeploymentSchema = z.object({
  network: z.string(),
  chainId: z.number().int().positive(),
  deployer: AddressSchema,
  contracts: z.object({
    registry: AddressSchema,
    ledger: AddressSchema,
    inference: AddressSchema,
    staking: AddressSchema,
    banManager: AddressSchema,
    rental: AddressSchema.optional(),
  }),
  timestamp: z.string(),
});
export type ComputeDeployment = z.infer<typeof ComputeDeploymentSchema>;

// ============================================================================
// Compute Resource Types (vast.ai-style)
// ============================================================================

export enum ResourceType {
  GPU = 0,
  CPU = 1,
  MEMORY = 2,
  STORAGE = 3,
}

export const ResourceTypeSchema = z.nativeEnum(ResourceType);

export enum GPUType {
  NONE = 0,
  NVIDIA_RTX_4090 = 1,
  NVIDIA_A100_40GB = 2,
  NVIDIA_A100_80GB = 3,
  NVIDIA_H100 = 4,
  NVIDIA_H200 = 5,
  AMD_MI300X = 6,
  APPLE_M1_MAX = 7,
  APPLE_M2_ULTRA = 8,
  APPLE_M3_MAX = 9,
}

export const GPUTypeSchema = z.nativeEnum(GPUType);

export const ComputeResourcesSchema = z.object({
  gpuType: GPUTypeSchema,
  gpuCount: z.number().int().nonnegative(),
  gpuVram: z.number().nonnegative(), // GB
  cpuCores: z.number().int().positive(),
  memory: z.number().positive(), // GB
  storage: z.number().positive(), // GB
  bandwidth: z.number().positive(), // Mbps
  teeCapable: z.boolean(),
});
export type ComputeResources = z.infer<typeof ComputeResourcesSchema>;

export const ResourcePricingSchema = z.object({
  pricePerHour: z.bigint(), // wei per hour
  pricePerGpuHour: z.bigint(), // additional per GPU
  minimumRentalHours: z.number().int().positive(),
  maximumRentalHours: z.number().int().positive(),
});
export type ResourcePricing = z.infer<typeof ResourcePricingSchema>;

// ============================================================================
// Rental/Session Types
// ============================================================================

export enum RentalStatus {
  PENDING = 0,
  ACTIVE = 1,
  PAUSED = 2,
  COMPLETED = 3,
  CANCELLED = 4,
  EXPIRED = 5,
}

export const RentalStatusSchema = z.nativeEnum(RentalStatus);

export const ComputeRentalSchema = z.object({
  rentalId: z.string(),
  user: AddressSchema,
  provider: AddressSchema,
  resources: ComputeResourcesSchema,
  status: RentalStatusSchema,
  startTime: z.number(),
  endTime: z.number(),
  totalCost: z.bigint(),
  paidAmount: z.bigint(),
  sshPublicKey: z.string(),
  containerImage: z.string().optional(),
  startupScript: z.string().optional(),
  sshHost: z.string().optional(),
  sshPort: z.number().int().positive().optional(),
});
export type ComputeRental = z.infer<typeof ComputeRentalSchema>;

export const CreateRentalRequestSchema = z.object({
  provider: AddressSchema,
  durationHours: z.number().int().positive(),
  sshPublicKey: z.string(),
  containerImage: z.string().optional(),
  startupScript: z.string().optional(),
  environmentVars: z.record(z.string(), z.string()).optional(),
});
export type CreateRentalRequest = z.infer<typeof CreateRentalRequestSchema>;

export const ContainerStatusSchema = z.enum(['creating', 'running', 'paused', 'stopped', 'error']);
export type ContainerStatus = z.infer<typeof ContainerStatusSchema>;

export const PortMappingSchema = z.object({
  containerPort: z.number().int().positive(),
  hostPort: z.number().int().positive(),
  protocol: z.enum(['tcp', 'udp']),
});
export type PortMapping = z.infer<typeof PortMappingSchema>;

export const HealthCheckResultSchema = z.object({
  healthy: z.boolean(),
  lastCheck: z.number(),
  message: z.string().optional(),
});
export type HealthCheckResult = z.infer<typeof HealthCheckResultSchema>;

export const ContainerStateSchema = z.object({
  containerId: z.string(),
  image: z.string(),
  status: ContainerStatusSchema,
  ports: z.array(PortMappingSchema),
  healthCheck: HealthCheckResultSchema.optional(),
});
export type ContainerState = z.infer<typeof ContainerStateSchema>;

export const SessionMetricsSchema = z.object({
  cpuUsage: z.number().nonnegative(), // percentage
  memoryUsage: z.number().nonnegative(), // bytes
  gpuUsage: z.number().nonnegative(), // percentage
  gpuMemoryUsage: z.number().nonnegative(), // bytes
  networkRx: z.number().nonnegative(), // bytes
  networkTx: z.number().nonnegative(), // bytes
  diskUsage: z.number().nonnegative(), // bytes
  uptime: z.number().nonnegative().optional(), // seconds
  lastUpdated: z.number().optional(), // timestamp
});
export type SessionMetrics = z.infer<typeof SessionMetricsSchema>;

export const RentalSessionSchema = z.object({
  rentalId: z.string(),
  sshHost: z.string(),
  sshPort: z.number().int().positive(),
  sshUser: z.string(),
  containerState: ContainerStateSchema,
  metrics: SessionMetricsSchema,
});
export type RentalSession = z.infer<typeof RentalSessionSchema>;

// ============================================================================
// SSH Access Types
// ============================================================================

export const SSHCredentialsSchema = z.object({
  host: z.string(),
  port: z.number().int().positive(),
  username: z.string(),
  publicKey: z.string(),
});
export type SSHCredentials = z.infer<typeof SSHCredentialsSchema>;

export const SSHSessionSchema = z.object({
  sessionId: z.string(),
  rentalId: z.string(),
  user: AddressSchema,
  connectedAt: z.number(),
  lastActivity: z.number(),
  clientIp: z.string(),
});
export type SSHSession = z.infer<typeof SSHSessionSchema>;

export const SSHProxyConfigSchema = z.object({
  listenPort: z.number().int().positive(),
  targetHost: z.string(),
  targetPort: z.number().int().positive(),
  authMethod: z.enum(['publickey', 'signature']),
});
export type SSHProxyConfig = z.infer<typeof SSHProxyConfigSchema>;

// ============================================================================
// Compute Node Extended Types
// ============================================================================

export const ComputeNodeCapabilitiesSchema = z.object({
  inference: z.boolean(),
  ssh: z.boolean(),
  docker: z.boolean(),
  kubernetes: z.boolean(),
  tee: z.boolean(),
  resources: ComputeResourcesSchema,
  pricing: ResourcePricingSchema,
  supportedImages: z.array(z.string()),
});
export type ComputeNodeCapabilities = z.infer<typeof ComputeNodeCapabilitiesSchema>;

export const ExtendedProviderInfoSchema = ComputeProviderSchema.extend({
  capabilities: ComputeNodeCapabilitiesSchema,
  activeRentals: z.number().int().nonnegative(),
  maxRentals: z.number().int().positive(),
  uptime: z.number().nonnegative(),
  reputation: z.number().nonnegative(),
});
export type ExtendedProviderInfo = z.infer<typeof ExtendedProviderInfoSchema>;

// ============================================================================
// Gateway Proxy Types
// ============================================================================

export const GatewayRouteTypeSchema = z.enum(['ssh', 'http', 'tcp']);
export type GatewayRouteType = z.infer<typeof GatewayRouteTypeSchema>;

export const GatewayRouteSchema = z.object({
  routeId: z.string(),
  rentalId: z.string(),
  type: GatewayRouteTypeSchema,
  sourcePort: z.number().int().positive(),
  targetHost: z.string(),
  targetPort: z.number().int().positive(),
  user: AddressSchema,
  provider: AddressSchema,
  createdAt: z.number(),
  expiresAt: z.number(),
});
export type GatewayRoute = z.infer<typeof GatewayRouteSchema>;

export const ProxySessionSchema = z.object({
  sessionId: z.string(),
  route: GatewayRouteSchema,
  bytesIn: z.number().nonnegative(),
  bytesOut: z.number().nonnegative(),
  connectedAt: z.number(),
  lastActivity: z.number(),
});
export type ProxySession = z.infer<typeof ProxySessionSchema>;

// ============================================================================
// Events
// ============================================================================

export const RentalCreatedEventSchema = z.object({
  rentalId: z.string(),
  user: AddressSchema,
  provider: AddressSchema,
  durationHours: z.number().int().positive(),
  totalCost: z.bigint(),
  timestamp: z.number(),
});
export type RentalCreatedEvent = z.infer<typeof RentalCreatedEventSchema>;

export const RentalStartedEventSchema = z.object({
  rentalId: z.string(),
  sshHost: z.string(),
  sshPort: z.number().int().positive(),
  containerId: z.string(),
  timestamp: z.number(),
});
export type RentalStartedEvent = z.infer<typeof RentalStartedEventSchema>;

export const RentalCompletedEventSchema = z.object({
  rentalId: z.string(),
  actualDuration: z.number().nonnegative(),
  refundAmount: z.bigint(),
  timestamp: z.number(),
});
export type RentalCompletedEvent = z.infer<typeof RentalCompletedEventSchema>;

