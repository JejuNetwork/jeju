/**
 * TEE (Trusted Execution Environment) Interface
 */

import type { Address, Hex } from 'viem';

export enum TEEProviderType {
  UNKNOWN = 0,
  PHALA = 1,
  MARLIN = 2,
  OASIS = 3,
  AWS_NITRO = 4,
  AZURE_CONFIDENTIAL = 5,
  GOOGLE_CONFIDENTIAL = 6,
  CLOUDFLARE_WORKERS = 7,
}

export enum TEEHardwareType {
  NONE = 0,
  INTEL_TDX = 1,
  INTEL_SGX = 2,
  AMD_SEV = 3,
  ARM_TRUSTZONE = 4,
  SIMULATED = 5,
}

export type TEENodeStatus = 'cold' | 'starting' | 'warm' | 'hot' | 'draining' | 'stopped' | 'error';

export type TEENodeWarmth = 'cold' | 'warm' | 'hot';

export interface TEEHardwareInfo {
  providerType: TEEProviderType;
  hardwareType: TEEHardwareType;
  isSecure: boolean;
  gpuType: string | null;
  gpuCount: number;
  gpuVram: number | null;
  cpuCores: number | null;
  memory: number | null;
  attestationHash: Hex | null;
}

export interface TEENode {
  id: string;
  providerType: TEEProviderType;
  endpoint: string;
  status: TEENodeStatus;
  warmth: TEENodeWarmth;
  walletAddress: Address | null;
  agentId: bigint | null;
  hardware: TEEHardwareInfo;
  models: string[];
  supportsDocker: boolean;
  supportsScripts: boolean;
  lastHealthCheck: number;
  lastActivity: number;
  startedAt: number | null;
  coldStartTime: number | null;
  totalRequests: number;
  averageLatency: number | null;
  errorCount: number;
  warning?: string;
}

export interface TEEDeploymentConfig {
  dockerImage?: string;
  dockerArgs?: string[];
  dockerfile?: string;
  startupScript?: string;
  gitRepo?: string;
  gitBranch?: string;
  gitCommit?: string;
  env?: Record<string, string>;
  memoryGb?: number;
  cpuCores?: number;
  gpuRequired?: boolean;
  gpuType?: string;
  gpuCount?: number;
  volumes?: Array<{
    name: string;
    path: string;
    sizeGb: number;
  }>;
  healthCheck?: {
    path: string;
    interval: number;
    timeout: number;
  };
}

export interface TEEProvisionRequest {
  modelId?: string;
  preferWarm?: boolean;
  maxColdStartMs?: number;
  requireSecure?: boolean;
  providerType?: TEEProviderType;
  deployment?: TEEDeploymentConfig;
}

export interface TEEProvisionResult {
  node: TEENode;
  endpoint: string;
  coldStart: boolean;
  estimatedColdStartMs: number | null;
}

export interface TEEProvider {
  getProviderType(): TEEProviderType;
  isAvailable(): boolean;
  getName(): string;
  provision(config: TEEDeploymentConfig): Promise<TEENode>;
  getEndpoint(request: TEEProvisionRequest): Promise<TEEProvisionResult>;
  deprovision(nodeId: string): Promise<void>;
  getNode(nodeId: string): Promise<TEENode | null>;
  listNodes(): Promise<TEENode[]>;
  getCapabilities(): {
    supportsDocker: boolean;
    supportsScripts: boolean;
    supportsGit: boolean;
    supportsGPU: boolean;
    availableGPUTypes: string[];
    minMemoryGb: number;
    maxMemoryGb: number;
    isSecure: boolean;
  };
  getPricing(): {
    basePricePerHour: bigint;
    pricePerGpuHour?: bigint;
    pricePerMemoryGbHour?: bigint;
    coldStartFee?: bigint;
    currency: string;
  };
}

export interface TEEGateway {
  registerProvider(provider: TEEProvider): void;
  getEndpoint(request: TEEProvisionRequest): Promise<TEEProvisionResult>;
  listNodes(providerType?: TEEProviderType): Promise<TEENode[]>;
  getNode(nodeId: string): Promise<TEENode | null>;
  deprovision(nodeId: string): Promise<void>;
  getStats(): {
    totalNodes: number;
    nodesByProvider: Record<TEEProviderType, number>;
    nodesByStatus: Record<TEENodeStatus, number>;
    averageColdStartMs: number;
  };
}

export interface TEEEnclaveClient {
  deriveKey(path: string, subject: string): Promise<Uint8Array>;
  getWallet(): Promise<{ address: Address; privateKey: Hex }>;
  generateAttestation(reportData: Hex): Promise<{
    quote: Hex;
    eventLog: string;
  }>;
  seal(data: Uint8Array): Promise<Uint8Array>;
  unseal(sealed: Uint8Array): Promise<Uint8Array>;
  isInRealTEE(): boolean;
}

