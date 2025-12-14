/**
 * Akash Compute Provider
 *
 * Implements ExternalComputeProvider for Akash Network.
 * Integrates with network's KMS for credential storage and EIL for payments.
 */

import type { Address, Hex } from 'viem';
import { keccak256, toHex } from 'viem';
import type {
  ExternalComputeProvider,
  ExternalProviderType,
  HardwareRequirements,
  HardwareCapabilities,
  ExternalProviderPricing,
  DeploymentConfig,
  ExternalDeployment,
  BridgeNodeCredential,
} from '@jejunetwork/types';
import { ExternalProviderTypes, ProviderStatus } from '@jejunetwork/types';
import { getSecretVault, type SecretVault } from '@jeju/kms';
import { AkashClient, createAkashClient } from './client';
import type {
  AkashCredential,
  AkashDeployment,
  AkashNetworkType,
  AkashLeaseStatus,
} from './types';
import { AKASH_NETWORKS, AkashDeploymentStatus } from './types';

// ============================================================================
// Configuration
// ============================================================================

export interface AkashProviderConfig {
  network: AkashNetworkType;
  defaultMarkupBps: number;
  priceStalenessToleranceSec: number;
  maxConcurrentDeployments: number;
  enableLogging: boolean;
}

const DEFAULT_CONFIG: AkashProviderConfig = {
  network: 'mainnet',
  defaultMarkupBps: 1000, // 10% default markup
  priceStalenessToleranceSec: 300, // 5 minutes
  maxConcurrentDeployments: 100,
  enableLogging: true,
};

// ============================================================================
// Price Cache
// ============================================================================

interface PriceCacheEntry {
  hardware: HardwareCapabilities;
  pricing: ExternalProviderPricing;
  availableCount: number;
  cachedAt: number;
}

// ============================================================================
// Akash Provider Implementation
// ============================================================================

export class AkashProvider implements ExternalComputeProvider {
  readonly type: ExternalProviderType = ExternalProviderTypes.AKASH;
  readonly name = 'Akash Network';

  private config: AkashProviderConfig;
  private vault: SecretVault;
  private priceCache: PriceCacheEntry[] = [];
  private priceCacheUpdatedAt = 0;
  private deployments = new Map<string, AkashDeployment>();
  private clients = new Map<string, AkashClient>();

  constructor(config?: Partial<AkashProviderConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.vault = getSecretVault();
  }

  /**
   * Check if Akash network is available
   */
  async isAvailable(): Promise<boolean> {
    const networkConfig = AKASH_NETWORKS[this.config.network];

    const response = await fetch(
      `${networkConfig.restEndpoint}/cosmos/base/tendermint/v1beta1/syncing`,
      { signal: AbortSignal.timeout(5000) }
    ).catch(() => null);

    if (!response?.ok) return false;

    const data = (await response.json()) as { syncing: boolean };
    return !data.syncing;
  }

  /**
   * List available hardware offerings with pricing
   */
  async listOfferings(
    filter?: Partial<HardwareRequirements>
  ): Promise<Array<{
    hardware: HardwareCapabilities;
    pricing: ExternalProviderPricing;
    availableCount: number;
  }>> {
    // Check cache
    const cacheAge = Date.now() - this.priceCacheUpdatedAt;
    if (cacheAge < this.config.priceStalenessToleranceSec * 1000 && this.priceCache.length > 0) {
      return this.filterOfferings(this.priceCache, filter);
    }

    // Fetch fresh offerings from Akash network
    await this.refreshPriceCache();
    return this.filterOfferings(this.priceCache, filter);
  }

  /**
   * Get quote for a deployment configuration
   */
  async getQuote(
    config: DeploymentConfig
  ): Promise<{
    totalCost: bigint;
    pricePerHour: bigint;
    estimatedReadyTime: number;
    warnings: string[];
  }> {
    const offerings = await this.listOfferings(config.container.resources);
    const warnings: string[] = [];

    if (offerings.length === 0) {
      throw new Error('No Akash providers available for requested resources');
    }

    // Find best matching offering
    const bestOffering = offerings.reduce((best, current) => {
      if (current.pricing.pricePerHourWei < best.pricing.pricePerHourWei) {
        return current;
      }
      return best;
    }, offerings[0]);

    const pricePerHour = bestOffering.pricing.pricePerHourWei;
    const totalCost = pricePerHour * BigInt(config.durationHours);

    // Add warnings
    if (config.container.resources.gpuCount > 0) {
      if (offerings.length < 5) {
        warnings.push('Limited GPU availability on Akash - prices may vary');
      }
    }

    if (config.durationHours > 720) {
      warnings.push('Long deployments may require periodic escrow refills');
    }

    const priceAge = Date.now() - bestOffering.pricing.priceUpdatedAt;
    if (priceAge > this.config.priceStalenessToleranceSec * 1000 / 2) {
      warnings.push('Price data is somewhat stale - actual cost may differ');
    }

    return {
      totalCost,
      pricePerHour,
      estimatedReadyTime: 120000, // ~2 minutes for Akash deployment
      warnings,
    };
  }

  /**
   * Create a deployment on Akash
   */
  async deploy(
    config: DeploymentConfig,
    credential: BridgeNodeCredential
  ): Promise<ExternalDeployment> {
    this.log('Creating deployment', { deploymentId: config.deploymentId });

    // Retrieve Akash credential from vault
    const akashCredential = await this.getAkashCredential(credential);

    // Get or create Akash client
    const client = this.getOrCreateClient(akashCredential);

    // Create deployment
    const akashDeployment = await client.createDeployment(
      config,
      akashCredential,
      { network: this.config.network }
    );

    // Store deployment mapping
    this.deployments.set(config.deploymentId, akashDeployment);

    // Convert to external deployment format
    return this.toExternalDeployment(akashDeployment, credential.owner);
  }

  /**
   * Get deployment status
   */
  async getDeployment(deploymentId: string): Promise<ExternalDeployment | null> {
    const akashDeployment = this.deployments.get(deploymentId);
    if (!akashDeployment) return null;

    // Get fresh status from Akash
    const client = this.clients.get(akashDeployment.akashOwner);
    if (client) {
      const status = await client.getDeployment(
        akashDeployment.akashDseq,
        akashDeployment.akashOwner
      );

      if (status) {
        akashDeployment.status = status.state;
      }
    }

    return this.toExternalDeployment(akashDeployment, akashDeployment.bridgeNode);
  }

  /**
   * Terminate a deployment
   */
  async terminate(
    deploymentId: string,
    credential: BridgeNodeCredential
  ): Promise<void> {
    this.log('Terminating deployment', { deploymentId });

    const akashDeployment = this.deployments.get(deploymentId);
    if (!akashDeployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    const akashCredential = await this.getAkashCredential(credential);
    const client = this.getOrCreateClient(akashCredential);

    await client.closeDeployment(akashDeployment.akashDseq, akashCredential);

    akashDeployment.status = AkashDeploymentStatus.CLOSED;
    this.log('Deployment terminated', { deploymentId });
  }

  /**
   * Extend a deployment
   */
  async extend(
    deploymentId: string,
    additionalHours: number,
    credential: BridgeNodeCredential
  ): Promise<ExternalDeployment> {
    this.log('Extending deployment', { deploymentId, additionalHours });

    const akashDeployment = this.deployments.get(deploymentId);
    if (!akashDeployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    const akashCredential = await this.getAkashCredential(credential);
    const client = this.getOrCreateClient(akashCredential);

    // Calculate additional deposit needed
    const pricePerBlock = parseInt(akashDeployment.lease?.price.amount ?? '0', 10);
    const blocksPerHour = 600;
    const additionalBlocks = blocksPerHour * additionalHours;
    const additionalDeposit = String(pricePerBlock * additionalBlocks);

    await client.depositToDeployment(
      akashDeployment.akashDseq,
      additionalDeposit,
      akashCredential
    );

    // Update expiration
    akashDeployment.expiresAt += additionalHours * 60 * 60 * 1000;

    this.log('Deployment extended', {
      deploymentId,
      newExpiresAt: new Date(akashDeployment.expiresAt).toISOString(),
    });

    return this.toExternalDeployment(akashDeployment, credential.owner);
  }

  /**
   * Get deployment logs
   */
  async getLogs(
    deploymentId: string,
    credential: BridgeNodeCredential,
    tail = 100
  ): Promise<string> {
    const akashDeployment = this.deployments.get(deploymentId);
    if (!akashDeployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    if (!akashDeployment.akashProvider) {
      throw new Error('Deployment has no provider assigned');
    }

    const akashCredential = await this.getAkashCredential(credential);
    const client = this.getOrCreateClient(akashCredential);

    return client.getLogs(
      akashDeployment.akashDseq,
      akashDeployment.akashProvider,
      akashCredential,
      tail
    );
  }

  /**
   * Health check for a deployment
   */
  async healthCheck(
    deploymentId: string
  ): Promise<{ healthy: boolean; latencyMs: number; lastCheck: number }> {
    const startTime = Date.now();
    const deployment = await this.getDeployment(deploymentId);

    if (!deployment) {
      return { healthy: false, latencyMs: Date.now() - startTime, lastCheck: Date.now() };
    }

    // Try to reach the HTTP endpoint
    if (deployment.httpEndpoint) {
      const response = await fetch(deployment.httpEndpoint, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);

      return {
        healthy: response?.ok ?? false,
        latencyMs: Date.now() - startTime,
        lastCheck: Date.now(),
      };
    }

    // Check if deployment is active
    return {
      healthy: deployment.status === ProviderStatus.ACTIVE,
      latencyMs: Date.now() - startTime,
      lastCheck: Date.now(),
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Retrieve Akash credential from SecretVault
   */
  private async getAkashCredential(
    bridgeCredential: BridgeNodeCredential
  ): Promise<AkashCredential> {
    const secretValue = await this.vault.getSecret(
      bridgeCredential.secretId,
      bridgeCredential.owner
    );

    const parsed = JSON.parse(secretValue) as AkashCredential;
    return parsed;
  }

  /**
   * Get or create Akash client for a wallet
   */
  private getOrCreateClient(credential: AkashCredential): AkashClient {
    let client = this.clients.get(credential.walletAddress);
    if (!client) {
      client = createAkashClient(credential);
      this.clients.set(credential.walletAddress, client);
    }
    return client;
  }

  /**
   * Refresh the price cache from Akash network
   */
  private async refreshPriceCache(): Promise<void> {
    const networkConfig = AKASH_NETWORKS[this.config.network];
    const offerings: PriceCacheEntry[] = [];

    // Define standard hardware tiers we support
    const standardTiers: Array<{
      name: string;
      hardware: HardwareCapabilities;
      basePriceUaktPerHour: number;
    }> = [
      {
        name: 'cpu-small',
        hardware: {
          cpuCores: 2,
          memoryGb: 4,
          storageGb: 20,
          gpuType: 0,
          gpuCount: 0,
          gpuMemoryGb: 0,
          bandwidthMbps: 100,
          teeRequired: false,
          cpuModel: 'Generic x86_64',
          region: 'global',
          availableSlots: 100,
          maxConcurrentDeployments: 100,
        },
        basePriceUaktPerHour: 50000, // ~0.05 AKT/hour
      },
      {
        name: 'cpu-medium',
        hardware: {
          cpuCores: 4,
          memoryGb: 8,
          storageGb: 50,
          gpuType: 0,
          gpuCount: 0,
          gpuMemoryGb: 0,
          bandwidthMbps: 200,
          teeRequired: false,
          cpuModel: 'Generic x86_64',
          region: 'global',
          availableSlots: 80,
          maxConcurrentDeployments: 80,
        },
        basePriceUaktPerHour: 100000, // ~0.1 AKT/hour
      },
      {
        name: 'cpu-large',
        hardware: {
          cpuCores: 8,
          memoryGb: 16,
          storageGb: 100,
          gpuType: 0,
          gpuCount: 0,
          gpuMemoryGb: 0,
          bandwidthMbps: 500,
          teeRequired: false,
          cpuModel: 'Generic x86_64',
          region: 'global',
          availableSlots: 50,
          maxConcurrentDeployments: 50,
        },
        basePriceUaktPerHour: 200000, // ~0.2 AKT/hour
      },
      {
        name: 'gpu-rtx4090',
        hardware: {
          cpuCores: 8,
          memoryGb: 32,
          storageGb: 100,
          gpuType: 1, // NVIDIA_RTX_4090
          gpuCount: 1,
          gpuMemoryGb: 24,
          bandwidthMbps: 1000,
          teeRequired: false,
          cpuModel: 'Generic x86_64',
          region: 'global',
          availableSlots: 20,
          maxConcurrentDeployments: 20,
        },
        basePriceUaktPerHour: 1000000, // ~1 AKT/hour
      },
      {
        name: 'gpu-a100',
        hardware: {
          cpuCores: 16,
          memoryGb: 64,
          storageGb: 200,
          gpuType: 2, // NVIDIA_A100_40GB
          gpuCount: 1,
          gpuMemoryGb: 40,
          bandwidthMbps: 2000,
          teeRequired: false,
          cpuModel: 'AMD EPYC',
          region: 'global',
          availableSlots: 10,
          maxConcurrentDeployments: 10,
        },
        basePriceUaktPerHour: 2000000, // ~2 AKT/hour
      },
      {
        name: 'gpu-h100',
        hardware: {
          cpuCores: 24,
          memoryGb: 128,
          storageGb: 500,
          gpuType: 4, // NVIDIA_H100
          gpuCount: 1,
          gpuMemoryGb: 80,
          bandwidthMbps: 5000,
          teeRequired: false,
          cpuModel: 'AMD EPYC',
          region: 'global',
          availableSlots: 5,
          maxConcurrentDeployments: 5,
        },
        basePriceUaktPerHour: 5000000, // ~5 AKT/hour
      },
    ];

    // Convert to pricing format with markup
    const aktPriceUsd = await this.getAktPrice();
    const ethPriceUsd = await this.getEthPrice();

    for (const tier of standardTiers) {
      // Convert AKT price to Wei
      const priceUsd = (tier.basePriceUaktPerHour / 1_000_000) * aktPriceUsd;
      const priceEth = priceUsd / ethPriceUsd;
      const priceWei = BigInt(Math.floor(priceEth * 1e18));

      // Add markup
      const priceWithMarkup = priceWei + (priceWei * BigInt(this.config.defaultMarkupBps)) / 10000n;

      offerings.push({
        hardware: tier.hardware,
        pricing: {
          pricePerHourWei: priceWithMarkup,
          minimumHours: 1,
          maximumHours: 720, // 30 days
          markupBps: this.config.defaultMarkupBps,
          originalPricePerHour: BigInt(tier.basePriceUaktPerHour),
          originalCurrency: 'uAKT',
          priceUpdatedAt: Date.now(),
          priceStalenessToleranceSec: this.config.priceStalenessToleranceSec,
        },
        availableCount: tier.hardware.availableSlots,
        cachedAt: Date.now(),
      });
    }

    this.priceCache = offerings;
    this.priceCacheUpdatedAt = Date.now();
    this.log('Price cache refreshed', { offeringCount: offerings.length });
  }

  /**
   * Filter offerings based on requirements
   */
  private filterOfferings(
    offerings: PriceCacheEntry[],
    filter?: Partial<HardwareRequirements>
  ): PriceCacheEntry[] {
    if (!filter) return offerings;

    return offerings.filter((o) => {
      if (filter.cpuCores && o.hardware.cpuCores < filter.cpuCores) return false;
      if (filter.memoryGb && o.hardware.memoryGb < filter.memoryGb) return false;
      if (filter.storageGb && o.hardware.storageGb < filter.storageGb) return false;
      if (filter.gpuCount && o.hardware.gpuCount < filter.gpuCount) return false;
      if (filter.gpuType && filter.gpuType !== 0 && o.hardware.gpuType !== filter.gpuType) return false;
      if (filter.teeRequired && !o.hardware.teeRequired) return false;
      return true;
    });
  }

  /**
   * Convert AkashDeployment to ExternalDeployment
   */
  private toExternalDeployment(
    akash: AkashDeployment,
    bridgeNode: Address
  ): ExternalDeployment {
    const statusMap: Record<string, typeof ProviderStatus[keyof typeof ProviderStatus]> = {
      [AkashDeploymentStatus.PENDING]: ProviderStatus.STARTING,
      [AkashDeploymentStatus.OPEN]: ProviderStatus.STARTING,
      [AkashDeploymentStatus.ACTIVE]: ProviderStatus.ACTIVE,
      [AkashDeploymentStatus.CLOSED]: ProviderStatus.TERMINATED,
      [AkashDeploymentStatus.UNKNOWN]: ProviderStatus.ERROR,
    };

    // Extract endpoints from Akash lease status
    let httpEndpoint: string | undefined;
    let ssh: ExternalDeployment['ssh'];

    if (akash.endpoints) {
      const services = Object.values(akash.endpoints.services);
      for (const service of services) {
        if (service.uris && service.uris.length > 0) {
          httpEndpoint = `https://${service.uris[0]}`;
        }
        if (service.ips) {
          for (const ip of service.ips) {
            if (ip.port === 22) {
              ssh = {
                host: ip.ip,
                port: ip.externalPort,
                username: 'root',
              };
            }
          }
        }
      }
    }

    // Get hardware from SDL
    const profileName = Object.keys(akash.sdl.profiles.compute)[0];
    const resources = akash.sdl.profiles.compute[profileName].resources;

    return {
      deploymentId: akash.jejuDeploymentId,
      providerType: ExternalProviderTypes.AKASH,
      externalDeploymentId: akash.akashDseq,
      status: statusMap[akash.status] ?? ProviderStatus.ERROR,
      httpEndpoint,
      ssh,
      startedAt: akash.createdAt,
      expiresAt: akash.expiresAt,
      totalCostPaid: akash.totalCostWei,
      hardware: {
        cpuCores: resources.cpu.units / 1000,
        memoryGb: parseFloat(resources.memory.size.replace(/Gi$/, '')),
        storageGb: resources.storage.reduce(
          (acc, s) => acc + parseFloat(s.size.replace(/Gi$/, '')),
          0
        ),
        gpuType: resources.gpu?.units ? 1 : 0,
        gpuCount: resources.gpu?.units ?? 0,
        gpuMemoryGb: 0,
        bandwidthMbps: 1000,
        teeRequired: false,
        cpuModel: 'Generic x86_64',
        region: 'global',
        availableSlots: 1,
        maxConcurrentDeployments: 1,
      },
      pricing: {
        pricePerHourWei: akash.totalCostWei / BigInt(Math.max(1, Math.ceil((akash.expiresAt - akash.createdAt) / 3600000))),
        minimumHours: 1,
        maximumHours: 720,
        markupBps: this.config.defaultMarkupBps,
        originalPricePerHour: BigInt(akash.totalCostUakt) / BigInt(Math.max(1, Math.ceil((akash.expiresAt - akash.createdAt) / 3600000))),
        originalCurrency: 'uAKT',
        priceUpdatedAt: akash.createdAt,
        priceStalenessToleranceSec: this.config.priceStalenessToleranceSec,
      },
      bridgeNodeAddress: bridgeNode,
      error: akash.error,
    };
  }

  /**
   * Get current AKT price in USD
   */
  private async getAktPrice(): Promise<number> {
    // In production, fetch from oracle or price feed
    // For now, use approximate market price
    return 3.5; // ~$3.50 per AKT
  }

  /**
   * Get current ETH price in USD
   */
  private async getEthPrice(): Promise<number> {
    const ethPriceStr = process.env.ETH_PRICE_USD;
    if (ethPriceStr) {
      return parseFloat(ethPriceStr);
    }
    return 3000; // Default $3000 per ETH
  }

  /**
   * Log message if logging is enabled
   */
  private log(message: string, data?: Record<string, unknown>): void {
    if (this.config.enableLogging) {
      console.log(`[AkashProvider] ${message}`, data ?? '');
    }
  }
}

/**
 * Create Akash provider instance
 */
export function createAkashProvider(
  config?: Partial<AkashProviderConfig>
): AkashProvider {
  return new AkashProvider(config);
}

/**
 * Get singleton Akash provider
 */
let akashProviderInstance: AkashProvider | null = null;

export function getAkashProvider(
  config?: Partial<AkashProviderConfig>
): AkashProvider {
  if (!akashProviderInstance) {
    akashProviderInstance = createAkashProvider(config);
  }
  return akashProviderInstance;
}

export function resetAkashProvider(): void {
  akashProviderInstance = null;
}

