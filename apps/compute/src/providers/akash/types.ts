/**
 * Akash Network Types
 *
 * Type definitions for interacting with Akash decentralized cloud.
 * Akash uses SDL (Stack Definition Language) for deployment manifests.
 */

import type { Address, Hex } from 'viem';

// ============================================================================
// Akash Network Configuration
// ============================================================================

export const AKASH_NETWORKS = {
  mainnet: {
    chainId: 'akashnet-2',
    rpcEndpoint: 'https://rpc.akash.forbole.com:443',
    restEndpoint: 'https://api.akash.forbole.com:443',
    explorerUrl: 'https://www.mintscan.io/akash',
    denom: 'uakt',
    decimals: 6,
    gasPrice: '0.025uakt',
  },
  testnet: {
    chainId: 'sandbox-01',
    rpcEndpoint: 'https://rpc.sandbox-01.aksh.pw:443',
    restEndpoint: 'https://api.sandbox-01.aksh.pw:443',
    explorerUrl: 'https://sandbox.mintscan.io/akash-sandbox',
    denom: 'uakt',
    decimals: 6,
    gasPrice: '0.025uakt',
  },
} as const;

export type AkashNetworkType = keyof typeof AKASH_NETWORKS;

export interface AkashConfig {
  network: AkashNetworkType;
  rpcEndpoint?: string;
  restEndpoint?: string;
  walletMnemonic?: string;
  walletAddress?: string;
  gasMultiplier?: number;
}

// ============================================================================
// SDL (Stack Definition Language) Types
// ============================================================================

export interface SDLResource {
  cpu: {
    units: number; // millicpu (1000 = 1 core)
  };
  memory: {
    size: string; // e.g., "512Mi", "4Gi"
  };
  storage: Array<{
    name?: string;
    size: string; // e.g., "10Gi"
    class?: 'beta1' | 'beta2' | 'beta3' | 'default';
    persistent?: boolean;
  }>;
  gpu?: {
    units: number;
    attributes?: Array<{
      key: string;
      value: string;
    }>;
  };
}

export interface SDLService {
  image: string;
  command?: string[];
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  expose: Array<{
    port: number;
    as?: number;
    proto?: 'tcp' | 'udp';
    to?: Array<{
      global?: boolean;
      service?: string;
    }>;
    accept?: string[];
    ip?: string;
  }>;
  params?: {
    storage?: Record<string, { mount: string; readOnly?: boolean }>;
  };
}

export interface SDLProfile {
  compute: Record<string, {
    resources: SDLResource;
  }>;
  placement: Record<string, {
    attributes?: Record<string, string>;
    signedBy?: {
      anyOf?: string[];
      allOf?: string[];
    };
    pricing: Record<string, {
      denom: string;
      amount: number;
    }>;
  }>;
}

export interface SDLDeployment {
  [profileName: string]: Array<{
    profile: string;
    count: number;
  }>;
}

export interface SDL {
  version: '2.0';
  services: Record<string, SDLService>;
  profiles: SDLProfile;
  deployment: SDLDeployment;
}

// ============================================================================
// Akash Deployment Types
// ============================================================================

export const AkashDeploymentStatus = {
  PENDING: 'pending',
  OPEN: 'open',
  ACTIVE: 'active',
  CLOSED: 'closed',
  UNKNOWN: 'unknown',
} as const;

export type AkashDeploymentStatusType = (typeof AkashDeploymentStatus)[keyof typeof AkashDeploymentStatus];

export interface AkashDeployment {
  deploymentId: {
    owner: string;
    dseq: string;
  };
  state: AkashDeploymentStatusType;
  version: string;
  createdAt: number;
  escrowAccount: {
    balance: string;
    settled: string;
    depositor: string;
  };
}

export interface AkashLease {
  leaseId: {
    owner: string;
    dseq: string;
    gseq: number;
    oseq: number;
    provider: string;
  };
  state: 'active' | 'closed' | 'insufficient_funds';
  price: {
    denom: string;
    amount: string;
  };
  createdAt: number;
  closedOn?: number;
}

export interface AkashBid {
  bidId: {
    owner: string;
    dseq: string;
    gseq: number;
    oseq: number;
    provider: string;
  };
  state: 'open' | 'matched' | 'lost' | 'closed';
  price: {
    denom: string;
    amount: string;
  };
  createdAt: number;
}

export interface AkashProvider {
  owner: string;
  hostUri: string;
  attributes: Array<{ key: string; value: string }>;
  email?: string;
  website?: string;
  info?: {
    region?: string;
    tier?: string;
    capability?: string[];
  };
}

// ============================================================================
// Akash Service Status
// ============================================================================

export interface AkashServiceStatus {
  name: string;
  available: number;
  total: number;
  uris?: string[];
  ips?: Array<{
    port: number;
    externalPort: number;
    protocol: string;
    ip: string;
  }>;
}

export interface AkashLeaseStatus {
  services: Record<string, AkashServiceStatus>;
  forwarded_ports: Record<string, Array<{
    host: number;
    port: number;
    externalPort: number;
    proto: string;
    name: string;
  }>>;
}

// ============================================================================
// Network-Akash Bridge Types
// ============================================================================

export interface AkashCredential {
  /** Akash wallet mnemonic (encrypted in SecretVault) */
  walletMnemonic: string;
  /** Akash wallet address derived from mnemonic */
  walletAddress: string;
  /** Network to use */
  network: AkashNetworkType;
  /** Available AKT balance (cached) */
  cachedBalance?: string;
  /** Last balance check */
  lastBalanceCheck?: number;
}

export interface AkashDeployment {
  /** Network deployment ID */
  jejuDeploymentId: string;
  /** Akash deployment sequence */
  akashDseq: string;
  /** Akash owner address */
  akashOwner: string;
  /** Akash provider address */
  akashProvider?: string;
  /** Lease info */
  lease?: AkashLease;
  /** Service endpoints */
  endpoints?: AkashLeaseStatus;
  /** SDL used for deployment */
  sdl: SDL;
  /** Bridge node that created this */
  bridgeNode: Address;
  /** User wallet that requested this */
  userAddress: Address;
  /** Creation timestamp */
  createdAt: number;
  /** Expiration timestamp */
  expiresAt: number;
  /** Total cost in AKT (uakt) */
  totalCostUakt: string;
  /** Total cost in network tokens (wei) */
  totalCostWei: bigint;
  /** Current status */
  status: AkashDeploymentStatusType;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// GPU Mapping
// ============================================================================

export const AKASH_GPU_ATTRIBUTES: Record<string, Array<{ key: string; value: string }>> = {
  'nvidia-rtx-4090': [
    { key: 'vendor/nvidia/model', value: 'rtx4090' },
  ],
  'nvidia-a100-40gb': [
    { key: 'vendor/nvidia/model', value: 'a100' },
    { key: 'vendor/nvidia/ram', value: '40Gi' },
  ],
  'nvidia-a100-80gb': [
    { key: 'vendor/nvidia/model', value: 'a100' },
    { key: 'vendor/nvidia/ram', value: '80Gi' },
  ],
  'nvidia-h100': [
    { key: 'vendor/nvidia/model', value: 'h100' },
  ],
  'nvidia-h200': [
    { key: 'vendor/nvidia/model', value: 'h200' },
  ],
};

export function getAkashGPUAttributes(gpuType: string): Array<{ key: string; value: string }> {
  return AKASH_GPU_ATTRIBUTES[gpuType.toLowerCase()] ?? [];
}

