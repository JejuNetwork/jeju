/**
 * Generic TEE (Trusted Execution Environment) Interface
 * 
 * Vendor-agnostic abstraction for TEE compute providers.
 * Any vendor-specific implementation (Phala, AMD SEV, AWS Nitro, etc.)
 * should implement these interfaces.
 */

import type { Address, Hex } from 'viem';

/**
 * TEE Provider Types
 */
export enum TEEProviderType {
  UNKNOWN = 0,
  PHALA = 1,
  AWS_NITRO = 2,
  AZURE_CONFIDENTIAL = 3,
  GOOGLE_CONFIDENTIAL = 4,
  CLOUDFLARE_WORKERS = 5, // Non-TEE
}

/**
 * TEE Hardware Types
 */
export enum TEEHardwareType {
  NONE = 0,
  INTEL_TDX = 1,
  INTEL_SGX = 2,
  AMD_SEV = 3,
  ARM_TRUSTZONE = 4,
  SIMULATED = 5,
}

/**
 * TEE Node Status
 */
export type TEENodeStatus = 'cold' | 'starting' | 'warm' | 'hot' | 'draining' | 'stopped' | 'error';

/**
 * TEE Node Warmth Level
 */
export type TEENodeWarmth = 'cold' | 'warm' | 'hot';

/**
 * TEE Hardware Information
 */
export interface TEEHardwareInfo {
  providerType: TEEProviderType;
  hardwareType: TEEHardwareType;
  isSecure: boolean; // True for real TEE, false for simulated/non-TEE
  gpuType: string | null;
  gpuVram: number | null; // GB
  cpuCores: number | null;
  memory: number | null; // GB
  attestationHash: Hex | null;
}

/**
 * TEE Node Information
 */
export interface TEENode {
  id: string;
  providerType: TEEProviderType;
  endpoint: string;
  status: TEENodeStatus;
  warmth: TEENodeWarmth;
  
  // Identity
  walletAddress: Address | null;
  agentId: bigint | null;
  
  // Hardware
  hardware: TEEHardwareInfo;
  
  // Capabilities
  models: string[]; // Model IDs this node can serve
  supportsDocker: boolean;
  supportsScripts: boolean;
  
  // Timing
  lastHealthCheck: number;
  lastActivity: number;
  startedAt: number | null;
  coldStartTime: number | null; // ms
  
  // Metrics
  totalRequests: number;
  averageLatency: number | null; // ms
  errorCount: number;
  
  // Warnings for non-TEE nodes
  warning?: string;
}

/**
 * Deployment Configuration
 */
export interface TEEDeploymentConfig {
  // Container-based deployment
  dockerImage?: string;
  dockerArgs?: string[];
  dockerfile?: string;
  
  // Script-based deployment
  startupScript?: string;
  
  // Git-based deployment
  gitRepo?: string;
  gitBranch?: string;
  gitCommit?: string;
  
  // Environment variables
  env?: Record<string, string>;
  
  // Resource requirements
  memoryGb?: number;
  cpuCores?: number;
  gpuRequired?: boolean;
  gpuType?: string;
  
  // Volumes for persistent storage
  volumes?: Array<{
    name: string;
    path: string;
    sizeGb: number;
  }>;
  
  // Health check configuration
  healthCheck?: {
    path: string;
    interval: number; // seconds
    timeout: number; // seconds
  };
}

/**
 * Provision Request
 */
export interface TEEProvisionRequest {
  modelId?: string; // Optional: prefer nodes with this model
  preferWarm?: boolean;
  maxColdStartMs?: number;
  requireSecure?: boolean; // Require real TEE (no simulated)
  providerType?: TEEProviderType; // Prefer specific provider
  deployment?: TEEDeploymentConfig;
}

/**
 * Provision Result
 */
export interface TEEProvisionResult {
  node: TEENode;
  endpoint: string;
  coldStart: boolean;
  estimatedColdStartMs: number | null;
}

/**
 * TEE Provider Interface
 * 
 * All TEE providers must implement this interface.
 */
export interface TEEProvider {
  /**
   * Get provider type
   */
  getProviderType(): TEEProviderType;
  
  /**
   * Check if provider is available/configured
   */
  isAvailable(): boolean;
  
  /**
   * Get provider name
   */
  getName(): string;
  
  /**
   * Provision a new TEE node
   */
  provision(config: TEEDeploymentConfig): Promise<TEENode>;
  
  /**
   * Get an endpoint for a request (may provision on-demand)
   */
  getEndpoint(request: TEEProvisionRequest): Promise<TEEProvisionResult>;
  
  /**
   * Deprovision a node
   */
  deprovision(nodeId: string): Promise<void>;
  
  /**
   * Get node status
   */
  getNode(nodeId: string): Promise<TEENode | null>;
  
  /**
   * List all nodes
   */
  listNodes(): Promise<TEENode[]>;
  
  /**
   * Get provider capabilities
   */
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
  
  /**
   * Get pricing information
   */
  getPricing(): {
    basePricePerHour: bigint; // wei
    pricePerGpuHour?: bigint;
    pricePerMemoryGbHour?: bigint;
    coldStartFee?: bigint;
    currency: string;
  };
}

/**
 * TEE Gateway Interface
 * 
 * Orchestrates multiple TEE providers and provides unified access.
 */
export interface TEEGateway {
  /**
   * Register a TEE provider
   */
  registerProvider(provider: TEEProvider): void;
  
  /**
   * Get endpoint for a request (tries all providers)
   */
  getEndpoint(request: TEEProvisionRequest): Promise<TEEProvisionResult>;
  
  /**
   * List all available nodes across providers
   */
  listNodes(providerType?: TEEProviderType): Promise<TEENode[]>;
  
  /**
   * Get node by ID
   */
  getNode(nodeId: string): Promise<TEENode | null>;
  
  /**
   * Deprovision a node
   */
  deprovision(nodeId: string): Promise<void>;
  
  /**
   * Get gateway statistics
   */
  getStats(): {
    totalNodes: number;
    nodesByProvider: Record<TEEProviderType, number>;
    nodesByStatus: Record<TEENodeStatus, number>;
    averageColdStartMs: number;
  };
}

/**
 * TEE Enclave Interface
 * 
 * For code running inside a TEE - provides hardware-derived keys and attestation.
 */
export interface TEEEnclaveClient {
  /**
   * Derive a deterministic key from hardware root
   */
  deriveKey(path: string, subject: string): Promise<Uint8Array>;
  
  /**
   * Get Ethereum wallet derived from hardware
   */
  getWallet(): Promise<{ address: Address; privateKey: Hex }>;
  
  /**
   * Generate attestation quote
   */
  generateAttestation(reportData: Hex): Promise<{
    quote: Hex;
    eventLog: string;
  }>;
  
  /**
   * Seal data (encrypt with hardware key)
   */
  seal(data: Uint8Array): Promise<Uint8Array>;
  
  /**
   * Unseal data (decrypt with hardware key)
   */
  unseal(sealed: Uint8Array): Promise<Uint8Array>;
  
  /**
   * Check if running in real TEE
   */
  isInRealTEE(): boolean;
}

