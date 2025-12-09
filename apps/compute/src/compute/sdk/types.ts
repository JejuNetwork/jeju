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
