/**
 * Test Type Definitions
 *
 * Local type definitions for tests to avoid workspace resolution issues.
 */

import type { Address } from 'viem';

export const GPUTypes = {
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

export type GPUType = (typeof GPUTypes)[keyof typeof GPUTypes];

export interface HardwareRequirements {
  cpuCores: number;
  memoryGb: number;
  storageGb: number;
  gpuType: GPUType;
  gpuCount: number;
  gpuMemoryGb: number;
  bandwidthMbps: number;
  teeRequired: boolean;
}

export interface ContainerConfig {
  image: string;
  isChainRegistry: boolean;
  cid?: string;
  command?: string[];
  args?: string[];
  env?: Record<string, string>;
  secretRefs?: string[];
  ports?: Array<{
    containerPort: number;
    protocol: 'tcp' | 'udp';
    expose: boolean;
  }>;
  resources: HardwareRequirements;
}

export interface DeploymentConfig {
  deploymentId: string;
  container: ContainerConfig;
  durationHours: number;
  autoRenew: boolean;
  maxAutoRenewBudget?: bigint;
  userAddress: Address;
  sshPublicKey?: string;
  healthCheck?: {
    path: string;
    port: number;
    intervalSeconds: number;
    timeoutSeconds: number;
    initialDelaySeconds: number;
  };
}

