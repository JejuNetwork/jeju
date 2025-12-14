/**
 * Unified Compute Service
 *
 * Provides a unified interface for both native network compute and external
 * compute providers (Akash). Users interact with a single API while the
 * service handles routing, payment, and lifecycle management.
 */

import type { Address, Hex } from 'viem';
import { keccak256, toHex, formatEther } from 'viem';
import type {
  ExternalProviderType,
  DeploymentConfig,
  ExternalDeployment,
  HardwareRequirements,
  HardwareCapabilities,
  ExternalProviderPricing,
  BridgeNodeConfig,
  ProviderStatusType,
} from '@jejunetwork/types';
import { ExternalProviderTypes, ProviderStatus, GPUTypes } from '@jejunetwork/types';
import { getAkashProvider, type AkashProvider } from './akash';
import { getBridgeNodeService, type BridgeNodeService } from './bridge-node';
import { getPaymentBridge, type PaymentBridge } from './payment-bridge';
import { getContainerRegistry, type ContainerRegistryClient } from './container-registry';

// ============================================================================
// Configuration
// ============================================================================

export interface UnifiedComputeConfig {
  /** Default provider preference */
  defaultProvider: 'native' | 'akash' | 'auto';
  /** Enable external providers */
  enableExternalProviders: boolean;
  /** Fallback to external if native unavailable */
  fallbackToExternal: boolean;
  /** Maximum price tolerance (multiplier over best quote) */
  maxPriceTolerance: number;
  /** Preferred regions */
  preferredRegions?: string[];
  /** Require TEE */
  requireTee?: boolean;
  /** Enable logging */
  enableLogging: boolean;
}

const DEFAULT_CONFIG: UnifiedComputeConfig = {
  defaultProvider: 'auto',
  enableExternalProviders: true,
  fallbackToExternal: true,
  maxPriceTolerance: 1.2, // Accept prices up to 20% higher than best
  enableLogging: true,
};

// ============================================================================
// Unified Compute Offerings
// ============================================================================

export interface ComputeOffering {
  id: string;
  provider: 'native' | 'akash';
  providerAddress?: Address;
  hardware: HardwareCapabilities;
  pricing: {
    pricePerHourWei: bigint;
    pricePerHourFormatted: string;
    currency: string;
    markupBps: number;
    originalProvider?: string;
  };
  availability: {
    available: boolean;
    slots: number;
    estimatedReadyTimeSec: number;
    region: string;
  };
  features: {
    ssh: boolean;
    docker: boolean;
    tee: boolean;
    gpuType?: string;
  };
}

export interface UnifiedDeployment {
  /** Deployment ID */
  id: string;
  /** Provider type */
  provider: 'native' | 'akash';
  /** External deployment details (if external) */
  external?: ExternalDeployment;
  /** Status */
  status: ProviderStatusType;
  /** User address */
  user: Address;
  /** Container info */
  container: {
    image: string;
    resolvedImage: string;
    isChainRegistry: boolean;
  };
  /** Access endpoints */
  endpoints: {
    http?: string;
    ssh?: { host: string; port: number; username: string };
    logs?: string;
  };
  /** Timing */
  timing: {
    createdAt: number;
    startedAt?: number;
    expiresAt: number;
  };
  /** Cost */
  cost: {
    totalPaid: bigint;
    totalPaidFormatted: string;
    pricePerHour: bigint;
    pricePerHourFormatted: string;
  };
}

export interface DeploymentRequest {
  /** Container image (supports JNS, IPFS, Arweave, Docker Hub) */
  image: string;
  /** Hardware requirements */
  hardware: Partial<HardwareRequirements>;
  /** Duration in hours */
  durationHours: number;
  /** SSH public key for access */
  sshPublicKey?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Exposed ports */
  ports?: Array<{ port: number; protocol: 'tcp' | 'udp' }>;
  /** Provider preference */
  provider?: 'native' | 'akash' | 'auto';
  /** Auto-renew */
  autoRenew?: boolean;
  /** Max budget (wei) */
  maxBudget?: bigint;
  /** Preferred region */
  region?: string;
}

// ============================================================================
// Unified Compute Service
// ============================================================================

export class UnifiedComputeService {
  private config: UnifiedComputeConfig;
  private akashProvider: AkashProvider | null = null;
  private bridgeNodeService: BridgeNodeService | null = null;
  private paymentBridge: PaymentBridge | null = null;
  private containerRegistry: ContainerRegistryClient;
  private deployments = new Map<string, UnifiedDeployment>();

  constructor(config?: Partial<UnifiedComputeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.containerRegistry = getContainerRegistry();

    if (this.config.enableExternalProviders) {
      this.akashProvider = getAkashProvider();
      this.bridgeNodeService = getBridgeNodeService();
      this.paymentBridge = getPaymentBridge();
    }
  }

  /**
   * List available compute offerings from all providers
   */
  async listOfferings(
    filter?: Partial<HardwareRequirements>
  ): Promise<ComputeOffering[]> {
    const offerings: ComputeOffering[] = [];

    // Get native offerings (from compute registry)
    const nativeOfferings = await this.getNativeOfferings(filter);
    offerings.push(...nativeOfferings);

    // Get Akash offerings
    if (this.config.enableExternalProviders && this.akashProvider) {
      const akashOfferings = await this.getAkashOfferings(filter);
      offerings.push(...akashOfferings);
    }

    // Sort by price
    offerings.sort((a, b) => {
      const priceA = Number(a.pricing.pricePerHourWei);
      const priceB = Number(b.pricing.pricePerHourWei);
      return priceA - priceB;
    });

    return offerings;
  }

  /**
   * Get quote for a deployment request
   */
  async getQuote(
    request: DeploymentRequest
  ): Promise<{
    offerings: ComputeOffering[];
    bestOffering: ComputeOffering;
    totalCost: bigint;
    totalCostFormatted: string;
    warnings: string[];
  }> {
    const hardware: Partial<HardwareRequirements> = {
      cpuCores: request.hardware.cpuCores ?? 2,
      memoryGb: request.hardware.memoryGb ?? 4,
      storageGb: request.hardware.storageGb ?? 20,
      gpuType: request.hardware.gpuType ?? GPUTypes.NONE,
      gpuCount: request.hardware.gpuCount ?? 0,
    };

    const offerings = await this.listOfferings(hardware);
    const warnings: string[] = [];

    if (offerings.length === 0) {
      throw new Error('No compute offerings available for requested resources');
    }

    // Filter by provider preference
    let filteredOfferings = offerings;
    if (request.provider && request.provider !== 'auto') {
      filteredOfferings = offerings.filter((o) => o.provider === request.provider);
      if (filteredOfferings.length === 0) {
        warnings.push(`No ${request.provider} offerings available, showing alternatives`);
        filteredOfferings = offerings;
      }
    }

    // Filter by region
    if (request.region) {
      const regionFiltered = filteredOfferings.filter(
        (o) => o.availability.region.toLowerCase() === request.region?.toLowerCase()
      );
      if (regionFiltered.length > 0) {
        filteredOfferings = regionFiltered;
      } else {
        warnings.push(`No offerings in region ${request.region}, showing global`);
      }
    }

    // Filter by budget
    if (request.maxBudget) {
      const budgetFiltered = filteredOfferings.filter((o) => {
        const totalCost = o.pricing.pricePerHourWei * BigInt(request.durationHours);
        return totalCost <= request.maxBudget!;
      });
      if (budgetFiltered.length === 0) {
        warnings.push('No offerings within budget');
      } else {
        filteredOfferings = budgetFiltered;
      }
    }

    const bestOffering = filteredOfferings[0];
    const totalCost = bestOffering.pricing.pricePerHourWei * BigInt(request.durationHours);

    // Add warnings for external providers
    if (bestOffering.provider === 'akash') {
      warnings.push('Deployment will be provisioned on Akash Network');
    }

    return {
      offerings: filteredOfferings,
      bestOffering,
      totalCost,
      totalCostFormatted: formatEther(totalCost),
      warnings,
    };
  }

  /**
   * Create a deployment
   */
  async deploy(
    request: DeploymentRequest,
    userAddress: Address,
    paymentToken: Address = '0x0000000000000000000000000000000000000000' as Address
  ): Promise<UnifiedDeployment> {
    this.log('Creating deployment', { image: request.image, user: userAddress });

    // Get quote
    const quote = await this.getQuote(request);
    const offering = quote.bestOffering;

    // Resolve container image
    const containerRef = await this.containerRegistry.resolve(request.image);
    const resolvedImage = await this.containerRegistry.toExternalFormat(
      request.image,
      offering.provider
    );

    // Generate deployment ID
    const deploymentId = keccak256(
      toHex(`${userAddress}-${Date.now()}-${Math.random()}`)
    ).slice(0, 18);

    // Create deployment config
    const deploymentConfig: DeploymentConfig = {
      deploymentId,
      container: {
        image: resolvedImage,
        isChainRegistry: containerRef.jnsResolved || containerRef.backend === 'jeju-registry',
        cid: containerRef.cid,
        env: request.env,
        ports: request.ports?.map((p) => ({
          containerPort: p.port,
          protocol: p.protocol,
          expose: true,
        })),
        resources: {
          cpuCores: request.hardware.cpuCores ?? 2,
          memoryGb: request.hardware.memoryGb ?? 4,
          storageGb: request.hardware.storageGb ?? 20,
          gpuType: request.hardware.gpuType ?? GPUTypes.NONE,
          gpuCount: request.hardware.gpuCount ?? 0,
          gpuMemoryGb: request.hardware.gpuMemoryGb ?? 0,
          bandwidthMbps: request.hardware.bandwidthMbps ?? 100,
          teeRequired: request.hardware.teeRequired ?? false,
        },
      },
      durationHours: request.durationHours,
      autoRenew: request.autoRenew ?? false,
      maxAutoRenewBudget: request.maxBudget,
      userAddress,
      sshPublicKey: request.sshPublicKey,
    };

    let deployment: UnifiedDeployment;

    if (offering.provider === 'akash' && this.bridgeNodeService) {
      // Deploy via Akash bridge node
      const externalDeployment = await this.bridgeNodeService.createDeployment(
        deploymentConfig,
        'akash'
      );

      deployment = this.externalToUnified(
        externalDeployment,
        request.image,
        resolvedImage,
        containerRef.jnsResolved || containerRef.backend === 'jeju-registry',
        quote.totalCost,
        offering.pricing.pricePerHourWei
      );
    } else {
      // Deploy via native compute
      deployment = await this.createNativeDeployment(
        deploymentConfig,
        request.image,
        resolvedImage,
        containerRef.jnsResolved || containerRef.backend === 'jeju-registry',
        quote.totalCost,
        offering.pricing.pricePerHourWei
      );
    }

    this.deployments.set(deployment.id, deployment);

    this.log('Deployment created', {
      id: deployment.id,
      provider: deployment.provider,
      status: deployment.status,
    });

    return deployment;
  }

  /**
   * Get deployment status
   */
  async getDeployment(deploymentId: string): Promise<UnifiedDeployment | null> {
    const cached = this.deployments.get(deploymentId);
    if (!cached) return null;

    // Refresh status
    if (cached.provider === 'akash' && this.bridgeNodeService) {
      const external = await this.bridgeNodeService.getDeployment(deploymentId);
      if (external) {
        cached.status = external.status;
        cached.endpoints = {
          http: external.httpEndpoint,
          ssh: external.ssh,
        };
      }
    }

    return cached;
  }

  /**
   * List user's deployments
   */
  async listDeployments(userAddress: Address): Promise<UnifiedDeployment[]> {
    return Array.from(this.deployments.values()).filter(
      (d) => d.user === userAddress
    );
  }

  /**
   * Terminate a deployment
   */
  async terminate(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    if (deployment.provider === 'akash' && this.bridgeNodeService) {
      await this.bridgeNodeService.terminateDeployment(deploymentId, 'user_cancelled');
    } else {
      // Native termination
      this.log('Native deployment termination', { deploymentId });
    }

    deployment.status = ProviderStatus.TERMINATED;
    this.deployments.delete(deploymentId);

    this.log('Deployment terminated', { deploymentId });
  }

  /**
   * Get deployment logs
   */
  async getLogs(deploymentId: string, tail = 100): Promise<string> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    if (deployment.provider === 'akash' && this.bridgeNodeService) {
      const credential = this.bridgeNodeService.getCredential('akash');
      if (!credential) throw new Error('No Akash credential available');

      const akash = getAkashProvider();
      return akash.getLogs(deploymentId, credential, tail);
    }

    // Native logs
    return 'Native compute logs not yet implemented';
  }

  /**
   * Health check all active deployments
   */
  async healthCheckAll(): Promise<Array<{
    deploymentId: string;
    healthy: boolean;
    provider: 'native' | 'akash';
  }>> {
    const results: Array<{
      deploymentId: string;
      healthy: boolean;
      provider: 'native' | 'akash';
    }> = [];

    for (const [id, deployment] of this.deployments) {
      if (deployment.status !== ProviderStatus.ACTIVE) continue;

      let healthy = false;

      if (deployment.provider === 'akash' && this.akashProvider) {
        const health = await this.akashProvider.healthCheck(id);
        healthy = health.healthy;
      } else {
        // Native health check via HTTP endpoint
        if (deployment.endpoints.http) {
          const response = await fetch(deployment.endpoints.http, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
          }).catch(() => null);
          healthy = response?.ok ?? false;
        }
      }

      results.push({
        deploymentId: id,
        healthy,
        provider: deployment.provider,
      });
    }

    return results;
  }

  /**
   * Get available bridge nodes for external providers
   */
  async listBridgeNodes(
    providerType?: ExternalProviderType
  ): Promise<BridgeNodeConfig[]> {
    if (!this.bridgeNodeService) return [];
    return [this.bridgeNodeService.getStatus()];
  }

  /**
   * Get service statistics
   */
  getStats(): {
    totalDeployments: number;
    activeDeployments: number;
    nativeDeployments: number;
    akashDeployments: number;
  } {
    const deployments = Array.from(this.deployments.values());
    const active = deployments.filter((d) => d.status === ProviderStatus.ACTIVE);
    const native = deployments.filter((d) => d.provider === 'native');
    const akash = deployments.filter((d) => d.provider === 'akash');

    return {
      totalDeployments: deployments.length,
      activeDeployments: active.length,
      nativeDeployments: native.length,
      akashDeployments: akash.length,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async getNativeOfferings(
    _filter?: Partial<HardwareRequirements>
  ): Promise<ComputeOffering[]> {
    // In production, fetch from ComputeRegistry contract
    // For now, return empty (native providers registered separately)
    return [];
  }

  private async getAkashOfferings(
    filter?: Partial<HardwareRequirements>
  ): Promise<ComputeOffering[]> {
    if (!this.akashProvider) return [];

    const offerings = await this.akashProvider.listOfferings(filter);

    return offerings.map((o, i) => ({
      id: `akash-${i}`,
      provider: 'akash' as const,
      hardware: o.hardware,
      pricing: {
        pricePerHourWei: o.pricing.pricePerHourWei,
        pricePerHourFormatted: formatEther(o.pricing.pricePerHourWei),
        currency: 'ETH',
        markupBps: o.pricing.markupBps,
        originalProvider: 'Akash Network',
      },
      availability: {
        available: o.availableCount > 0,
        slots: o.availableCount,
        estimatedReadyTimeSec: 120,
        region: o.hardware.region,
      },
      features: {
        ssh: true,
        docker: true,
        tee: o.hardware.teeRequired,
        gpuType: o.hardware.gpuCount > 0 ? `GPU-${o.hardware.gpuType}` : undefined,
      },
    }));
  }

  private async createNativeDeployment(
    config: DeploymentConfig,
    originalImage: string,
    resolvedImage: string,
    isChainRegistry: boolean,
    totalCost: bigint,
    pricePerHour: bigint
  ): Promise<UnifiedDeployment> {
    // Native deployment logic would go here
    // For now, return a placeholder
    return {
      id: config.deploymentId,
      provider: 'native',
      status: ProviderStatus.STARTING,
      user: config.userAddress,
      container: {
        image: originalImage,
        resolvedImage,
        isChainRegistry,
      },
      endpoints: {},
      timing: {
        createdAt: Date.now(),
        expiresAt: Date.now() + config.durationHours * 60 * 60 * 1000,
      },
      cost: {
        totalPaid: totalCost,
        totalPaidFormatted: formatEther(totalCost),
        pricePerHour,
        pricePerHourFormatted: formatEther(pricePerHour),
      },
    };
  }

  private externalToUnified(
    external: ExternalDeployment,
    originalImage: string,
    resolvedImage: string,
    isChainRegistry: boolean,
    totalCost: bigint,
    pricePerHour: bigint
  ): UnifiedDeployment {
    return {
      id: external.deploymentId,
      provider: 'akash',
      external,
      status: external.status,
      user: external.bridgeNodeAddress, // Would be actual user in production
      container: {
        image: originalImage,
        resolvedImage,
        isChainRegistry,
      },
      endpoints: {
        http: external.httpEndpoint,
        ssh: external.ssh,
      },
      timing: {
        createdAt: external.startedAt,
        startedAt: external.startedAt,
        expiresAt: external.expiresAt,
      },
      cost: {
        totalPaid: totalCost,
        totalPaidFormatted: formatEther(totalCost),
        pricePerHour,
        pricePerHourFormatted: formatEther(pricePerHour),
      },
    };
  }

  private log(message: string, data?: Record<string, unknown>): void {
    if (this.config.enableLogging) {
      console.log(`[UnifiedCompute] ${message}`, data ?? '');
    }
  }
}

/**
 * Create unified compute service from environment
 */
export function createUnifiedComputeFromEnv(): UnifiedComputeService {
  return new UnifiedComputeService({
    defaultProvider: (process.env.DEFAULT_COMPUTE_PROVIDER ?? 'auto') as 'native' | 'akash' | 'auto',
    enableExternalProviders: process.env.ENABLE_EXTERNAL_PROVIDERS !== 'false',
    fallbackToExternal: process.env.FALLBACK_TO_EXTERNAL !== 'false',
    maxPriceTolerance: parseFloat(process.env.MAX_PRICE_TOLERANCE ?? '1.2'),
    preferredRegions: process.env.PREFERRED_REGIONS?.split(','),
    requireTee: process.env.REQUIRE_TEE === 'true',
    enableLogging: process.env.ENABLE_COMPUTE_LOGGING !== 'false',
  });
}

// Singleton
let unifiedComputeInstance: UnifiedComputeService | null = null;

export function getUnifiedCompute(): UnifiedComputeService {
  if (!unifiedComputeInstance) {
    unifiedComputeInstance = createUnifiedComputeFromEnv();
  }
  return unifiedComputeInstance;
}

export function resetUnifiedCompute(): void {
  unifiedComputeInstance = null;
}

