/**
 * @fileoverview Comprehensive tests for external-compute.ts
 *
 * Tests cover:
 * - ExternalProviderTypes constant
 * - ProviderStatus constant
 * - getGPUTypeName utility function
 * - HardwareRequirements interface
 * - ContainerConfig interface
 * - DeploymentConfig interface
 * - ExternalDeployment interface
 * - BridgeNodeConfig interface
 * - SlashingReasons constant
 * - ExternalComputeProvider interface
 */

import { describe, expect, test } from 'bun:test'
import { GPUType } from '../compute'
import {
  type BridgeNodeConfig,
  type ContainerConfig,
  type DeploymentConfig,
  type ExternalDeployment,
  type ExternalProviderPricing,
  ExternalProviderTypes,
  getGPUTypeName,
  type HardwareCapabilities,
  type HardwareRequirements,
  ProviderStatus,
  type SlashingConfig,
  type SlashingEvent,
  SlashingReasons,
} from '../external-compute'

const TEST_ADDRESS =
  '0x1234567890123456789012345678901234567890' as `0x${string}`
const TEST_HASH = ('0x' + 'a'.repeat(64)) as `0x${string}`

describe('ExternalProviderTypes', () => {
  test('has correct values', () => {
    expect(ExternalProviderTypes.AKASH).toBe('akash')
    expect(ExternalProviderTypes.NATIVE).toBe('native')
  })

  test('has all expected provider types', () => {
    const types = Object.values(ExternalProviderTypes)
    expect(types.length).toBe(2)
    expect(types).toContain('akash')
    expect(types).toContain('native')
  })
})

describe('ProviderStatus', () => {
  test('has correct values', () => {
    expect(ProviderStatus.COLD).toBe('cold')
    expect(ProviderStatus.STARTING).toBe('starting')
    expect(ProviderStatus.READY).toBe('ready')
    expect(ProviderStatus.ACTIVE).toBe('active')
    expect(ProviderStatus.DRAINING).toBe('draining')
    expect(ProviderStatus.ERROR).toBe('error')
    expect(ProviderStatus.TERMINATED).toBe('terminated')
  })

  test('has all expected statuses', () => {
    const statuses = Object.values(ProviderStatus)
    expect(statuses.length).toBe(7)
  })
})

describe('getGPUTypeName', () => {
  test('returns correct names for all GPU types', () => {
    expect(getGPUTypeName(GPUType.NONE)).toBe('None')
    expect(getGPUTypeName(GPUType.NVIDIA_RTX_4090)).toBe('NVIDIA RTX 4090')
    expect(getGPUTypeName(GPUType.NVIDIA_A100_40GB)).toBe('NVIDIA A100 40GB')
    expect(getGPUTypeName(GPUType.NVIDIA_A100_80GB)).toBe('NVIDIA A100 80GB')
    expect(getGPUTypeName(GPUType.NVIDIA_H100)).toBe('NVIDIA H100')
    expect(getGPUTypeName(GPUType.NVIDIA_H200)).toBe('NVIDIA H200')
    expect(getGPUTypeName(GPUType.AMD_MI300X)).toBe('AMD MI300X')
    expect(getGPUTypeName(GPUType.APPLE_M1_MAX)).toBe('Apple M1 Max')
    expect(getGPUTypeName(GPUType.APPLE_M2_ULTRA)).toBe('Apple M2 Ultra')
    expect(getGPUTypeName(GPUType.APPLE_M3_MAX)).toBe('Apple M3 Max')
  })

  test('throws for unknown GPU type', () => {
    expect(() => getGPUTypeName(999 as GPUType)).toThrow('Unknown GPUType: 999')
  })
})

describe('SlashingReasons', () => {
  test('has correct values', () => {
    expect(SlashingReasons.DEPLOYMENT_FAILURE).toBe('deployment_failure')
    expect(SlashingReasons.DOWNTIME).toBe('downtime')
    expect(SlashingReasons.SLA_VIOLATION).toBe('sla_violation')
    expect(SlashingReasons.INVALID_ATTESTATION).toBe('invalid_attestation')
    expect(SlashingReasons.PRICE_MANIPULATION).toBe('price_manipulation')
  })

  test('has all expected reasons', () => {
    const reasons = Object.values(SlashingReasons)
    expect(reasons.length).toBe(5)
  })
})

describe('HardwareRequirements interface', () => {
  test('has correct structure', () => {
    const requirements: HardwareRequirements = {
      cpuCores: 16,
      memoryGb: 64,
      storageGb: 500,
      gpuType: GPUType.NVIDIA_H100,
      gpuCount: 2,
      gpuMemoryGb: 80,
      bandwidthMbps: 10000,
      teeRequired: false,
    }

    expect(requirements.cpuCores).toBe(16)
    expect(requirements.gpuType).toBe(GPUType.NVIDIA_H100)
    expect(requirements.teeRequired).toBe(false)
  })

  test('accepts TEE configuration', () => {
    const requirements: HardwareRequirements = {
      cpuCores: 8,
      memoryGb: 32,
      storageGb: 100,
      gpuType: GPUType.NONE,
      gpuCount: 0,
      gpuMemoryGb: 0,
      bandwidthMbps: 1000,
      teeRequired: true,
      teeType: 'intel-tdx',
    }

    expect(requirements.teeRequired).toBe(true)
    expect(requirements.teeType).toBe('intel-tdx')
  })
})

describe('HardwareCapabilities interface', () => {
  test('extends HardwareRequirements', () => {
    const capabilities: HardwareCapabilities = {
      cpuCores: 16,
      memoryGb: 64,
      storageGb: 500,
      gpuType: GPUType.NVIDIA_H100,
      gpuCount: 2,
      gpuMemoryGb: 80,
      bandwidthMbps: 10000,
      teeRequired: false,
      cpuModel: 'AMD EPYC 7763',
      region: 'us-east-1',
      availableSlots: 5,
      maxConcurrentDeployments: 10,
    }

    expect(capabilities.cpuModel).toBe('AMD EPYC 7763')
    expect(capabilities.region).toBe('us-east-1')
    expect(capabilities.availableSlots).toBe(5)
  })
})

describe('ExternalProviderPricing interface', () => {
  test('has correct structure', () => {
    const pricing: ExternalProviderPricing = {
      pricePerHourWei: 100000000000000000n,
      minimumHours: 1,
      maximumHours: 720,
      markupBps: 500,
      originalPricePerHour: 80000000000000000n,
      originalCurrency: 'AKT',
      priceUpdatedAt: Date.now(),
      priceStalenessToleranceSec: 3600,
    }

    expect(pricing.pricePerHourWei).toBe(100000000000000000n)
    expect(pricing.markupBps).toBe(500)
    expect(pricing.originalCurrency).toBe('AKT')
  })
})

describe('ContainerConfig interface', () => {
  test('has correct structure', () => {
    const config: ContainerConfig = {
      image: 'nvidia/cuda:12.2-base',
      isChainRegistry: false,
      command: ['/bin/bash'],
      args: ['-c', 'echo hello'],
      env: { DEBUG: 'true' },
      ports: [{ containerPort: 8080, protocol: 'tcp', expose: true }],
      resources: {
        cpuCores: 8,
        memoryGb: 32,
        storageGb: 100,
        gpuType: GPUType.NVIDIA_RTX_4090,
        gpuCount: 1,
        gpuMemoryGb: 24,
        bandwidthMbps: 1000,
        teeRequired: false,
      },
    }

    expect(config.image).toBe('nvidia/cuda:12.2-base')
    expect(config.isChainRegistry).toBe(false)
    expect(config.ports?.length).toBe(1)
  })

  test('accepts decentralized registry config', () => {
    const config: ContainerConfig = {
      image: 'Qm...',
      isChainRegistry: true,
      cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
      resources: {
        cpuCores: 4,
        memoryGb: 16,
        storageGb: 50,
        gpuType: GPUType.NONE,
        gpuCount: 0,
        gpuMemoryGb: 0,
        bandwidthMbps: 500,
        teeRequired: false,
      },
    }

    expect(config.isChainRegistry).toBe(true)
    expect(config.cid).toBeDefined()
  })
})

describe('DeploymentConfig interface', () => {
  test('has correct structure', () => {
    const config: DeploymentConfig = {
      deploymentId: 'deploy-123',
      container: {
        image: 'nvidia/cuda:12.2-base',
        isChainRegistry: false,
        resources: {
          cpuCores: 8,
          memoryGb: 32,
          storageGb: 100,
          gpuType: GPUType.NVIDIA_H100,
          gpuCount: 1,
          gpuMemoryGb: 80,
          bandwidthMbps: 1000,
          teeRequired: false,
        },
      },
      durationHours: 24,
      autoRenew: false,
      userAddress: TEST_ADDRESS,
      sshPublicKey: 'ssh-rsa AAAA...',
    }

    expect(config.deploymentId).toBe('deploy-123')
    expect(config.durationHours).toBe(24)
  })

  test('accepts health check configuration', () => {
    const config: DeploymentConfig = {
      deploymentId: 'deploy-456',
      container: {
        image: 'nginx:latest',
        isChainRegistry: false,
        resources: {
          cpuCores: 2,
          memoryGb: 4,
          storageGb: 20,
          gpuType: GPUType.NONE,
          gpuCount: 0,
          gpuMemoryGb: 0,
          bandwidthMbps: 100,
          teeRequired: false,
        },
      },
      durationHours: 1,
      autoRenew: true,
      maxAutoRenewBudget: 1000000000000000000n,
      userAddress: TEST_ADDRESS,
      healthCheck: {
        path: '/health',
        port: 8080,
        intervalSeconds: 30,
        timeoutSeconds: 5,
        initialDelaySeconds: 10,
      },
    }

    expect(config.healthCheck?.path).toBe('/health')
  })
})

describe('ExternalDeployment interface', () => {
  test('has correct structure', () => {
    const deployment: ExternalDeployment = {
      deploymentId: 'deploy-123',
      providerType: 'akash',
      externalDeploymentId: 'akash-123',
      status: 'active',
      httpEndpoint: 'https://deploy.akash.network/...',
      ssh: {
        host: '192.168.1.100',
        port: 22,
        username: 'root',
      },
      startedAt: Date.now() - 3600000,
      expiresAt: Date.now() + 82800000,
      totalCostPaid: 100000000000000000n,
      hardware: {
        cpuCores: 8,
        memoryGb: 32,
        storageGb: 100,
        gpuType: GPUType.NVIDIA_RTX_4090,
        gpuCount: 1,
        gpuMemoryGb: 24,
        bandwidthMbps: 1000,
        teeRequired: false,
        cpuModel: 'Intel Xeon',
        region: 'us-west',
        availableSlots: 0,
        maxConcurrentDeployments: 1,
      },
      pricing: {
        pricePerHourWei: 100000000000000000n,
        minimumHours: 1,
        maximumHours: 720,
        markupBps: 500,
        originalPricePerHour: 80000000000000000n,
        originalCurrency: 'AKT',
        priceUpdatedAt: Date.now(),
        priceStalenessToleranceSec: 3600,
      },
      bridgeNodeAddress: TEST_ADDRESS,
    }

    expect(deployment.status).toBe('active')
    expect(deployment.ssh?.host).toBe('192.168.1.100')
  })

  test('accepts attestation info', () => {
    const deployment: ExternalDeployment = {
      deploymentId: 'deploy-456',
      providerType: 'native',
      externalDeploymentId: 'native-456',
      status: 'ready',
      startedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      totalCostPaid: 50000000000000000n,
      hardware: {
        cpuCores: 4,
        memoryGb: 16,
        storageGb: 50,
        gpuType: GPUType.NONE,
        gpuCount: 0,
        gpuMemoryGb: 0,
        bandwidthMbps: 500,
        teeRequired: true,
        cpuModel: 'Intel Xeon',
        region: 'eu-west',
        availableSlots: 0,
        maxConcurrentDeployments: 1,
      },
      pricing: {
        pricePerHourWei: 50000000000000000n,
        minimumHours: 1,
        maximumHours: 168,
        markupBps: 300,
        originalPricePerHour: 40000000000000000n,
        originalCurrency: 'ETH',
        priceUpdatedAt: Date.now(),
        priceStalenessToleranceSec: 300,
      },
      bridgeNodeAddress: TEST_ADDRESS,
      attestation: {
        hash: TEST_HASH,
        timestamp: Date.now(),
        verified: true,
      },
    }

    expect(deployment.attestation?.verified).toBe(true)
  })
})

describe('BridgeNodeConfig interface', () => {
  test('has correct structure', () => {
    const config: BridgeNodeConfig = {
      address: TEST_ADDRESS,
      agentId: 123n,
      supportedProviders: ['akash', 'native'],
      stake: 10000000000000000000n,
      minStakeRequired: 1000000000000000000n,
      markupBps: 200,
      regions: ['us-east', 'us-west', 'eu-west'],
      maxConcurrentDeployments: 50,
      activeDeployments: 25,
      totalDeploymentsCompleted: 1000n,
      totalRevenueEarned: 5000000000000000000000n,
      totalSlashed: 0n,
      reputationScore: 95,
      active: true,
      registeredAt: Date.now() - 86400000 * 30,
    }

    expect(config.agentId).toBe(123n)
    expect(config.supportedProviders).toContain('akash')
    expect(config.reputationScore).toBe(95)
  })
})

describe('SlashingConfig interface', () => {
  test('has correct structure', () => {
    const config: SlashingConfig = {
      revenueSlashBps: 1000,
      minReputationForStakeProtection: 80,
      stakeSlashBps: 500,
      slashingCooldownSec: 86400,
      governanceAddress: TEST_ADDRESS,
    }

    expect(config.revenueSlashBps).toBe(1000)
    expect(config.slashingCooldownSec).toBe(86400)
  })
})

describe('SlashingEvent interface', () => {
  test('has correct structure', () => {
    const event: SlashingEvent = {
      eventId: TEST_HASH,
      bridgeNode: TEST_ADDRESS,
      reason: 'deployment_failure',
      amountSlashed: 100000000000000000n,
      stakeSlashed: false,
      deploymentId: 'deploy-123',
      timestamp: Date.now(),
      evidenceHash: TEST_HASH,
      disputed: false,
    }

    expect(event.reason).toBe('deployment_failure')
    expect(event.stakeSlashed).toBe(false)
  })

  test('accepts disputed event with resolution', () => {
    const event: SlashingEvent = {
      eventId: TEST_HASH,
      bridgeNode: TEST_ADDRESS,
      reason: 'sla_violation',
      amountSlashed: 50000000000000000n,
      stakeSlashed: false,
      deploymentId: 'deploy-456',
      timestamp: Date.now() - 86400000,
      evidenceHash: TEST_HASH,
      disputed: true,
      resolution: 'reversed',
    }

    expect(event.disputed).toBe(true)
    expect(event.resolution).toBe('reversed')
  })
})

