/**
 * Compute Marketplace Types
 *
 * Types for the Jeju decentralized AI compute marketplace.
 */

// ============================================================================
// Provider Types
// ============================================================================

export interface ComputeProvider {
  address: string;
  name: string;
  endpoint: string;
  attestationHash: string;
  stake: bigint;
  registeredAt: number;
  agentId: number;
  active: boolean;
}

export interface ComputeCapability {
  model: string;
  pricePerInputToken: bigint;
  pricePerOutputToken: bigint;
  maxContextLength: number;
  active: boolean;
}

// ============================================================================
// Ledger Types
// ============================================================================

export interface ComputeLedger {
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

// ============================================================================
// Inference Types
// ============================================================================

export interface InferenceService {
  provider: string;
  model: string;
  endpoint: string;
  pricePerInputToken: bigint;
  pricePerOutputToken: bigint;
  active: boolean;
}

export interface InferenceSettlement {
  user: string;
  provider: string;
  requestHash: string;
  inputTokens: number;
  outputTokens: number;
  fee: bigint;
  timestamp: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  seed?: number;
}

export interface InferenceResponse {
  id: string;
  model: string;
  choices: Array<{
    message: ChatMessage;
    finish_reason: 'stop' | 'length' | 'content_filter' | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  settlement?: {
    provider: string;
    requestHash: string;
    inputTokens: number;
    outputTokens: number;
    nonce: number;
    signature: string;
  };
}

// ============================================================================
// Staking Types
// ============================================================================

export enum ComputeStakeType {
  NONE = 0,
  USER = 1,
  PROVIDER = 2,
  GUARDIAN = 3,
}

export interface ComputeStake {
  amount: bigint;
  stakeType: ComputeStakeType;
  stakedAt: number;
  lockedUntil: number;
  slashed: boolean;
}

// ============================================================================
// Hardware Types
// ============================================================================

export type Platform = 'darwin' | 'linux' | 'win32';
export type Architecture = 'arm64' | 'x64';

export interface HardwareInfo {
  platform: Platform;
  arch: Architecture;
  cpus: number;
  memory: number;
  gpuType: string | null;
  gpuVram: number | null;
  cudaVersion: string | null;
  mlxVersion: string | null;
}

export interface AttestationReport {
  signingAddress: string;
  hardware: HardwareInfo;
  timestamp: string;
  nonce: string;
  signature: string;
  simulated: boolean;
}

// ============================================================================
// SDK Configuration Types
// ============================================================================

export interface ComputeSDKConfig {
  rpcUrl: string;
  privateKey?: string;
  contracts: {
    registry: string;
    ledger: string;
    inference: string;
  };
}

export interface ModerationSDKConfig {
  rpcUrl: string;
  privateKey?: string;
  contracts: {
    staking: string;
    banManager: string;
  };
}

// ============================================================================
// Auth Types
// ============================================================================

export interface ComputeAuthHeaders {
  'x-jeju-address': string;
  'x-jeju-nonce': string;
  'x-jeju-signature': string;
  'x-jeju-timestamp': string;
}

// ============================================================================
// Node Configuration Types
// ============================================================================

export interface ComputeNodeConfig {
  privateKey: string;
  registryAddress: string;
  ledgerAddress: string;
  inferenceAddress: string;
  rpcUrl: string;
  port: number;
  models: ModelConfig[];
}

export interface ModelConfig {
  name: string;
  backend: 'ollama' | 'llamacpp' | 'mock';
  endpoint?: string;
  pricePerInputToken: bigint;
  pricePerOutputToken: bigint;
  maxContextLength: number;
}

// ============================================================================
// Network Types
// ============================================================================

export interface ComputeNetwork {
  name: string;
  chainId: number;
  rpcUrl: string;
  explorer: string;
}

export interface ComputeDeployment {
  network: string;
  chainId: number;
  deployer: string;
  contracts: {
    registry: string;
    ledger: string;
    inference: string;
    staking: string;
    banManager: string;
    rental?: string;
  };
  timestamp: string;
}

// ============================================================================
// Compute Resource Types (vast.ai-style)
// ============================================================================

export enum ResourceType {
  GPU = 0,
  CPU = 1,
  MEMORY = 2,
  STORAGE = 3,
}

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

export interface ComputeResources {
  gpuType: GPUType;
  gpuCount: number;
  gpuVram: number; // GB
  cpuCores: number;
  memory: number; // GB
  storage: number; // GB
  bandwidth: number; // Mbps
  teeCapable: boolean;
}

export interface ResourcePricing {
  pricePerHour: bigint; // wei per hour
  pricePerGpuHour: bigint; // additional per GPU
  minimumRentalHours: number;
  maximumRentalHours: number;
}

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

export interface ComputeRental {
  rentalId: string;
  user: string;
  provider: string;
  resources: ComputeResources;
  status: RentalStatus;
  startTime: number;
  endTime: number;
  totalCost: bigint;
  paidAmount: bigint;
  sshPublicKey: string;
  containerImage?: string;
  startupScript?: string;
  sshHost?: string;
  sshPort?: number;
}

export interface CreateRentalRequest {
  provider: string;
  durationHours: number;
  sshPublicKey: string;
  containerImage?: string;
  startupScript?: string;
  environmentVars?: Record<string, string>;
}

export interface RentalSession {
  rentalId: string;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  containerState: ContainerState;
  metrics: SessionMetrics;
}

export interface ContainerState {
  containerId: string;
  image: string;
  status: 'creating' | 'running' | 'paused' | 'stopped' | 'error';
  ports: PortMapping[];
  healthCheck?: HealthCheckResult;
}

export interface PortMapping {
  containerPort: number;
  hostPort: number;
  protocol: 'tcp' | 'udp';
}

export interface HealthCheckResult {
  healthy: boolean;
  lastCheck: number;
  message?: string;
}

export interface SessionMetrics {
  cpuUsage: number; // percentage
  memoryUsage: number; // bytes
  gpuUsage: number; // percentage
  gpuMemoryUsage: number; // bytes
  networkRx: number; // bytes
  networkTx: number; // bytes
  diskUsage: number; // bytes
  uptime?: number; // seconds
  lastUpdated?: number; // timestamp
}

// ============================================================================
// SSH Access Types
// ============================================================================

export interface SSHCredentials {
  host: string;
  port: number;
  username: string;
  publicKey: string;
}

export interface SSHSession {
  sessionId: string;
  rentalId: string;
  user: string;
  connectedAt: number;
  lastActivity: number;
  clientIp: string;
}

export interface SSHProxyConfig {
  listenPort: number;
  targetHost: string;
  targetPort: number;
  authMethod: 'publickey' | 'signature';
}

// ============================================================================
// Compute Node Extended Types
// ============================================================================

export interface ComputeNodeCapabilities {
  inference: boolean;
  ssh: boolean;
  docker: boolean;
  kubernetes: boolean;
  tee: boolean;
  resources: ComputeResources;
  pricing: ResourcePricing;
  supportedImages: string[];
}

export interface ExtendedProviderInfo extends ComputeProvider {
  capabilities: ComputeNodeCapabilities;
  activeRentals: number;
  maxRentals: number;
  uptime: number;
  reputation: number;
}

// ============================================================================
// Gateway Proxy Types
// ============================================================================

export interface GatewayRoute {
  routeId: string;
  rentalId: string;
  type: 'ssh' | 'http' | 'tcp';
  sourcePort: number;
  targetHost: string;
  targetPort: number;
  user: string;
  provider: string;
  createdAt: number;
  expiresAt: number;
}

export interface ProxySession {
  sessionId: string;
  route: GatewayRoute;
  bytesIn: number;
  bytesOut: number;
  connectedAt: number;
  lastActivity: number;
}

// ============================================================================
// Events
// ============================================================================

export interface RentalCreatedEvent {
  rentalId: string;
  user: string;
  provider: string;
  durationHours: number;
  totalCost: bigint;
  timestamp: number;
}

export interface RentalStartedEvent {
  rentalId: string;
  sshHost: string;
  sshPort: number;
  containerId: string;
  timestamp: number;
}

export interface RentalCompletedEvent {
  rentalId: string;
  actualDuration: number;
  refundAmount: bigint;
  timestamp: number;
}

