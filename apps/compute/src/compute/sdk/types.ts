/**
 * SDK Types for Jeju Compute Marketplace
 */

import type { Wallet } from 'ethers';

export interface SDKConfig {
  rpcUrl: string;
  signer?: Wallet;
  contracts: {
    registry: string;
    ledger: string;
    inference: string;
    rental?: string; // Optional rental contract
    // Multi-token payment support (ERC-4337 paymaster integration)
    creditManager?: string;      // CreditManager for prepaid balances
    paymasterFactory?: string;   // PaymasterFactory for gas sponsorship
    tokenRegistry?: string;      // TokenRegistry for supported tokens
    entryPoint?: string;         // ERC-4337 EntryPoint address
  };
}

// ============ Rental Types ============

// Rental status values match contract enum
export const RentalStatusEnum = {
  PENDING: 0,    // Created but not started
  ACTIVE: 1,     // Running
  PAUSED: 2,     // Temporarily suspended
  COMPLETED: 3,  // Finished normally
  CANCELLED: 4,  // User cancelled
  EXPIRED: 5,    // Time ran out
  DISPUTED: 6,   // Under dispute
} as const;

export type RentalStatus = typeof RentalStatusEnum[keyof typeof RentalStatusEnum];

// GPU type enum values match contract
export const GPUTypeEnum = {
  NONE: 0,
  NVIDIA_RTX_4090: 1,
  NVIDIA_A100_40GB: 2,
  NVIDIA_A100_80GB: 3,
  NVIDIA_H100: 4,
  NVIDIA_H200: 5,
  AMD_MI300X: 6,
  APPLE_M1_MAX: 7,
  APPLE_M2_ULTRA: 8,
  APPLE_M3_MAX: 9,
} as const;

export type GPUType = typeof GPUTypeEnum[keyof typeof GPUTypeEnum];

export interface ComputeResources {
  gpuType: GPUType;
  gpuCount: number;
  gpuVram: number;      // GB
  cpuCores: number;
  memory: number;       // GB
  storage: number;      // GB
  bandwidth: number;    // Mbps
  teeCapable: boolean;
}

export interface ResourcePricing {
  pricePerHour: bigint;        // wei per hour
  pricePerGpuHour: bigint;     // additional per GPU hour
  minimumRentalHours: number;
  maximumRentalHours: number;
}

export interface Rental {
  rentalId: string;
  user: string;
  provider: string;
  status: RentalStatus;
  startTime: number;
  endTime: number;
  totalCost: bigint;
  paidAmount: bigint;
  refundedAmount: bigint;
  sshPublicKey: string;
  containerImage: string;
  startupScript: string;
  sshHost: string;
  sshPort: number;
}

export interface ProviderResourcesInfo {
  resources: ComputeResources;
  pricing: ResourcePricing;
  maxConcurrentRentals: number;
  activeRentals: number;
  sshEnabled: boolean;
  dockerEnabled: boolean;
}

export interface CreateRentalParams {
  provider: string;
  durationHours: number;
  sshPublicKey: string;
  containerImage?: string;
  startupScript?: string;
}

// ============ Dispute Types ============

export const DisputeReasonEnum = {
  NONE: 0,
  PROVIDER_OFFLINE: 1,        // Provider unavailable
  WRONG_HARDWARE: 2,          // Hardware doesn't match advertised
  POOR_PERFORMANCE: 3,        // Performance below promised
  SECURITY_ISSUE: 4,          // Security vulnerability
  USER_ABUSE: 5,              // User generated illegal/abusive content
  USER_HACK_ATTEMPT: 6,       // User attempted to hack/exploit
  USER_TERMS_VIOLATION: 7,    // User violated terms
  PAYMENT_DISPUTE: 8,         // Payment/billing dispute
} as const;

export type DisputeReason = typeof DisputeReasonEnum[keyof typeof DisputeReasonEnum];

export interface Dispute {
  disputeId: string;
  rentalId: string;
  initiator: string;
  defendant: string;
  reason: DisputeReason;
  evidenceUri: string;
  createdAt: number;
  resolvedAt: number;
  resolved: boolean;
  inFavorOfInitiator: boolean;
  slashAmount: bigint;
}

export interface RentalRating {
  score: number;             // 0-100
  comment: string;
  ratedAt: number;
}

// ============ Reputation Types ============

export interface UserRecord {
  totalRentals: number;
  completedRentals: number;
  cancelledRentals: number;
  disputedRentals: number;
  abuseReports: number;
  banned: boolean;
  bannedAt: number;
  banReason: string;
}

export interface ProviderRecord {
  totalRentals: number;
  completedRentals: number;
  failedRentals: number;
  totalEarnings: bigint;
  avgRating: number;         // scaled by 100 (5000 = 50.00)
  ratingCount: number;
  banned: boolean;
}

export interface CreateDisputeParams {
  rentalId: string;
  reason: DisputeReason;
  evidenceUri: string;
}

export interface ReportAbuseParams {
  rentalId: string;
  reason: DisputeReason;
  evidenceUri: string;
}

// ============ Session/Container Types ============

export interface SSHSession {
  sessionId: string;
  rentalId: string;
  user: string;
  connectedAt: number;
  lastActivity: number;
  clientIp: string;
}

export type ContainerStatus = 'creating' | 'running' | 'paused' | 'stopped' | 'error';

export interface PortMapping {
  containerPort: number;
  hostPort: number;
  protocol: 'tcp' | 'udp';
}

export interface HealthCheckResult {
  healthy: boolean;
  lastCheck: number;
  failureCount: number;
  output?: string;
}

export interface ContainerState {
  containerId: string;
  image: string;
  status: ContainerStatus;
  ports: PortMapping[];
  healthCheck?: HealthCheckResult;
  startedAt: number;
  logs?: string[];
}

export interface SessionMetrics {
  cpuUsage: number; // percentage
  memoryUsage: number; // bytes
  gpuUsage: number; // percentage
  gpuMemoryUsage: number; // bytes
  networkRx: number; // bytes
  networkTx: number; // bytes
  diskUsage?: number; // bytes
  uptime: number; // seconds
  lastUpdated: number;
}

export interface Provider {
  address: string;
  name: string;
  endpoint: string;
  attestationHash: string;
  stake: bigint;
  registeredAt: number;
  agentId: number; // ERC-8004 agent ID (0 if not linked)
  active: boolean;
}

export interface Capability {
  model: string;
  pricePerInputToken: bigint;
  pricePerOutputToken: bigint;
  maxContextLength: number;
  active: boolean; // Whether this capability is active
}

export interface Ledger {
  totalBalance: bigint;
  availableBalance: bigint;
  lockedBalance: bigint;
  createdAt: number;
}

export interface ProviderSubAccount {
  balance: bigint;
  pendingRefund: bigint;
  refundUnlockTime: number;
  acknowledged: boolean;
}

export interface Service {
  provider: string;
  model: string;
  endpoint: string;
  pricePerInputToken: bigint;
  pricePerOutputToken: bigint;
  active: boolean;
}

export interface Settlement {
  user: string;
  provider: string;
  requestHash: string;
  inputTokens: number;
  outputTokens: number;
  fee: bigint;
  timestamp: number;
}

export interface AuthHeaders {
  'x-jeju-address': string;
  'x-jeju-nonce': string;
  'x-jeju-signature': string;
  'x-jeju-timestamp': string;
}

export interface InferenceRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface InferenceResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /**
   * Settlement data for on-chain verification
   * Only present if the request was authenticated with settlement nonce
   */
  settlement?: {
    provider: string;
    requestHash: string;
    inputTokens: number;
    outputTokens: number;
    nonce: number;
    signature: string;
  };
}

// ============ Decentralized Inference Types ============

/**
 * Model source type - whether the model is closed-source (API-based) or open-source
 */
export const ModelSourceTypeEnum = {
  CLOSED_SOURCE: 0,  // API-based models (weights not public)
  OPEN_SOURCE: 1,    // Open weights models
  FINE_TUNED: 2,     // Fine-tuned versions of open models
} as const;

export type ModelSourceType = typeof ModelSourceTypeEnum[keyof typeof ModelSourceTypeEnum];

/**
 * Model hosting type - infrastructure characteristics
 */
export const ModelHostingTypeEnum = {
  CENTRALIZED: 0,    // Single provider
  DECENTRALIZED: 1,  // Multiple independent providers
  HYBRID: 2,         // Mix of centralized and decentralized
} as const;

export type ModelHostingType = typeof ModelHostingTypeEnum[keyof typeof ModelHostingTypeEnum];

/**
 * Model capability flags
 */
export const ModelCapabilityEnum = {
  // Text capabilities
  TEXT_GENERATION: 1,
  CODE_GENERATION: 2,
  FUNCTION_CALLING: 8,
  STREAMING: 16,
  EMBEDDINGS: 32,
  LONG_CONTEXT: 64,
  REASONING: 128,
  
  // Vision capabilities
  VISION: 4,              // Can process images as input
  IMAGE_GENERATION: 256,  // Can generate images (Stable Diffusion, DALL-E style)
  IMAGE_EDITING: 512,     // Can edit/modify images
  
  // Audio capabilities
  SPEECH_TO_TEXT: 1024,   // Transcription (Whisper style)
  TEXT_TO_SPEECH: 2048,   // Voice synthesis
  AUDIO_GENERATION: 4096, // Music/sound generation
  
  // Video capabilities
  VIDEO_GENERATION: 8192,  // Generate video (Sora, Runway style)
  VIDEO_ANALYSIS: 16384,   // Analyze/understand video
  
  // Multimodal
  MULTIMODAL: 32768,       // Combined input/output modalities
} as const;

export type ModelCapability = typeof ModelCapabilityEnum[keyof typeof ModelCapabilityEnum];

/**
 * Model type classification
 */
export const ModelTypeEnum = {
  LLM: 0,              // Large Language Model (text in, text out)
  IMAGE_GEN: 1,        // Image generation (text/image in, image out)
  VIDEO_GEN: 2,        // Video generation (text/image in, video out)
  AUDIO_GEN: 3,        // Audio/music generation
  SPEECH_TO_TEXT: 4,   // Transcription
  TEXT_TO_SPEECH: 5,   // Voice synthesis
  EMBEDDING: 6,        // Text/image embedding
  MULTIMODAL: 7,       // Any combination of modalities
} as const;

export type ModelType = typeof ModelTypeEnum[keyof typeof ModelTypeEnum];

/**
 * TEE (Trusted Execution Environment) type
 */
export const TEETypeEnum = {
  NONE: 0,
  INTEL_SGX: 1,
  INTEL_TDX: 2,
  AMD_SEV: 3,
  ARM_TRUSTZONE: 4,
  AWS_NITRO: 5,
  SIMULATED: 8,
} as const;

export type TEEType = typeof TEETypeEnum[keyof typeof TEETypeEnum];

/**
 * Hardware requirements for running a model
 */
export interface ModelHardwareRequirements {
  minGpuVram: number;        // Minimum GPU VRAM in GB
  recommendedGpuType: GPUType;
  minCpuCores: number;
  minMemory: number;         // GB
  teeRequired: boolean;
  teeType: TEEType;
}

/**
 * Model pricing information
 */
export interface ModelPricing {
  // Text/LLM pricing
  pricePerInputToken: bigint;     // wei per input token
  pricePerOutputToken: bigint;    // wei per output token
  
  // Image pricing
  pricePerImageInput: bigint;     // wei per input image (for vision)
  pricePerImageOutput: bigint;    // wei per generated image
  
  // Video pricing
  pricePerVideoSecond: bigint;    // wei per second of generated video
  
  // Audio pricing
  pricePerAudioSecond: bigint;    // wei per second of audio (generation or transcription)
  
  // Common
  minimumFee: bigint;             // minimum fee per request in wei
  currency: string;               // 'ETH' | 'USDC' | 'JEJU'
}

/**
 * Model creator organization info
 */
export interface ModelCreatorOrg {
  name: string;          // Creator/organization name
  website: string;
  verified: boolean;     // Whether verified on-chain
  trustScore: number;    // 0-100 trust score
}

/**
 * Registered model in the decentralized inference registry
 */
export interface RegisteredModel {
  modelId: string;                    // Unique identifier (format: "creator/model-name")
  name: string;                       // Human-readable name
  description: string;
  version: string;
  modelType: ModelType;               // LLM, IMAGE_GEN, VIDEO_GEN, etc.
  sourceType: ModelSourceType;        // Closed/open source
  hostingType: ModelHostingType;      // Centralized/decentralized
  creator: ModelCreatorOrg;           // Who created the model
  capabilities: number;               // Bitmask of ModelCapability
  contextWindow: number;              // Max tokens (0 for non-LLM)
  maxResolution?: string;             // For image/video: "1024x1024", "1920x1080"
  maxDuration?: number;               // For video/audio: max seconds
  pricing: ModelPricing;
  hardware: ModelHardwareRequirements;
  registeredAt: number;               // Unix timestamp
  updatedAt: number;
  active: boolean;
  totalRequests: bigint;              // Lifetime request count
  avgLatencyMs: number;               // Average response latency
  uptime: number;                     // Percentage (0-100)
}

/**
 * Model endpoint - where to send inference requests
 */
export interface ModelEndpoint {
  modelId: string;
  providerAddress: string;         // On-chain provider address
  endpoint: string;                // API endpoint URL
  region: string;                  // Geographic region
  teeType: TEEType;
  attestationHash: string;         // TEE attestation (if applicable)
  active: boolean;
  currentLoad: number;             // 0-100 load percentage
  maxConcurrent: number;           // Max concurrent requests
  pricing: ModelPricing;           // Provider-specific pricing
}

/**
 * Parameters for registering a new model
 */
export interface RegisterModelParams {
  modelId: string;
  name: string;
  description: string;
  version: string;
  modelType: ModelType;
  sourceType: ModelSourceType;
  hostingType: ModelHostingType;
  creatorName: string;
  creatorWebsite: string;
  capabilities: number;
  contextWindow: number;               // 0 for non-LLM models
  maxResolution?: string;              // For image/video models
  maxDuration?: number;                // For video/audio models (seconds)
  pricing: ModelPricing;
  hardware: ModelHardwareRequirements;
}

/**
 * Parameters for adding a model endpoint
 */
export interface AddEndpointParams {
  modelId: string;
  endpoint: string;
  region: string;
  teeType: TEEType;
  attestationHash?: string;
  maxConcurrent: number;
  pricing?: Partial<ModelPricing>;
}

/**
 * Model discovery filter options
 */
export interface ModelDiscoveryFilter {
  modelType?: ModelType;              // Filter by model type (LLM, IMAGE_GEN, etc.)
  sourceType?: ModelSourceType;
  hostingType?: ModelHostingType;
  capabilities?: number;              // Bitmask filter
  minContextWindow?: number;
  maxPricePerInputToken?: bigint;
  maxPricePerOutputToken?: bigint;
  maxPricePerImage?: bigint;          // For image generation
  maxPricePerSecond?: bigint;         // For video/audio
  requireTEE?: boolean;
  teeType?: TEEType;
  creatorName?: string;
  region?: string;
  minUptime?: number;
  active?: boolean;
}

/**
 * Model discovery result with endpoint info
 */
export interface ModelDiscoveryResult {
  model: RegisteredModel;
  endpoints: ModelEndpoint[];
  recommendedEndpoint: ModelEndpoint | null;
}

/**
 * External API model configuration (for models accessed via API)
 */
export interface ExternalModelConfig {
  modelId: string;
  apiKeyEnvVar: string;              // Environment variable name for API key
  baseUrl: string;                   // API base URL
  defaultPricing: ModelPricing;
  capabilities: number;
  contextWindow: number;
}

/**
 * Inference gateway configuration
 */
export interface InferenceGatewayConfig {
  rpcUrl: string;
  modelRegistryAddress: string;
  paymentMethod: 'x402' | 'credits' | 'paymaster' | 'direct';
  preferredToken?: string;           // Token address for paymaster
  maxRetries: number;
  timeoutMs: number;
  allowExternalEndpoints: boolean;   // Whether to route to external API endpoints
}

/**
 * Extended SDK config with model registry
 */
export interface ExtendedSDKConfig extends SDKConfig {
  contracts: SDKConfig['contracts'] & {
    modelRegistry?: string;          // ModelRegistry contract address
    inferenceGateway?: string;       // InferenceGateway contract address
  };
  gateway?: InferenceGatewayConfig;
}

/**
 * Simplified model selection params
 */
export interface ModelSelectionParams {
  capabilities?: number;
  maxBudgetPerRequest?: bigint;
  preferDecentralized?: boolean;
  requireTEE?: boolean;
  creatorName?: string;
}
