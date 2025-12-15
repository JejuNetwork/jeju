/**
 * Bridge Node Service
 *
 * Manages external compute provider credentials and orchestrates deployments.
 * Bridge nodes are staked operators that provide API access to external providers
 * like Akash, earning fees for their service.
 */

import type { Address, Hex } from 'viem';
import { keccak256, toHex, parseEther } from 'viem';
import type {
  ExternalProviderType,
  ExternalComputeProvider,
  DeploymentConfig,
  ExternalDeployment,
  BridgeNodeConfig,
  BridgeNodeCredential,
  SlashingEvent,
  SlashingReason,
  SlashingConfig,
} from '@jejunetwork/types';
import { SlashingReasons } from '@jejunetwork/types';
import { getSecretVault, type SecretVault, type SecretPolicy } from '@jeju/kms';
import { getAkashProvider, type AkashProvider, type AkashCredential } from './akash';

// ============================================================================
// Configuration
// ============================================================================

export interface BridgeNodeServiceConfig {
  /** Wallet address of this bridge node */
  walletAddress: Address;
  /** ERC-8004 agent ID */
  agentId: bigint;
  /** Supported providers */
  supportedProviders: ExternalProviderType[];
  /** Default markup in basis points */
  defaultMarkupBps: number;
  /** Slashing configuration */
  slashingConfig: SlashingConfig;
  /** RPC URL for contract interactions */
  rpcUrl: string;
  /** Private key for signing */
  privateKey: string;
}

const DEFAULT_SLASHING_CONFIG: SlashingConfig = {
  revenueSlashBps: 1000, // 10% of revenue slashed on failure
  minReputationForStakeProtection: 50, // Below 50 reputation, stake can be slashed
  stakeSlashBps: 100, // 1% of stake for repeat offenders
  slashingCooldownSec: 3600, // 1 hour cooldown between slashing events
  governanceAddress: '0x0000000000000000000000000000000000000000' as Address,
};

// ============================================================================
// Bridge Node Service
// ============================================================================

export class BridgeNodeService {
  private config: BridgeNodeServiceConfig;
  private vault: SecretVault;
  private providers = new Map<ExternalProviderType, ExternalComputeProvider>();
  private credentials = new Map<string, BridgeNodeCredential>();
  private activeDeployments = new Map<string, ExternalDeployment>();
  private revenueEarned = 0n;
  private slashingEvents: SlashingEvent[] = [];

  constructor(config: BridgeNodeServiceConfig) {
    this.config = {
      ...config,
      slashingConfig: { ...DEFAULT_SLASHING_CONFIG, ...config.slashingConfig },
    };
    this.vault = getSecretVault();
    this.initializeProviders();
  }

  /**
   * Initialize supported providers
   */
  private initializeProviders(): void {
    for (const providerType of this.config.supportedProviders) {
      if (providerType === 'akash') {
        this.providers.set('akash', getAkashProvider());
      }
    }
    console.log('[BridgeNode] Initialized providers:', this.config.supportedProviders);
  }

  /**
   * Register a credential for an external provider
   */
  async registerCredential(
    providerType: ExternalProviderType,
    credential: AkashCredential,
    description: string
  ): Promise<BridgeNodeCredential> {
    // Store credential in SecretVault with access policy
    const policy: SecretPolicy = {
      allowedAddresses: [this.config.walletAddress],
      rotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
    };

    const secret = await this.vault.storeSecret(
      `akash-credential-${Date.now()}`,
      JSON.stringify(credential),
      this.config.walletAddress,
      policy,
      ['akash', 'compute', 'credential'],
      {
        providerType,
        network: credential.network,
      }
    );

    const bridgeCredential: BridgeNodeCredential = {
      secretId: secret.id,
      providerType,
      owner: this.config.walletAddress,
      description,
      verified: false,
      lastVerifiedAt: 0,
    };

    // Verify credential works
    const verified = await this.verifyCredential(bridgeCredential);
    bridgeCredential.verified = verified;
    bridgeCredential.lastVerifiedAt = Date.now();

    this.credentials.set(secret.id, bridgeCredential);

    console.log('[BridgeNode] Credential registered', {
      secretId: secret.id,
      providerType,
      verified,
    });

    return bridgeCredential;
  }

  /**
   * Verify a credential works with the external provider
   */
  async verifyCredential(credential: BridgeNodeCredential): Promise<boolean> {
    const provider = this.providers.get(credential.providerType);
    if (!provider) return false;

    // Check provider availability
    const available = await provider.isAvailable();
    if (!available) return false;

    // For Akash, verify we can query the balance
    if (credential.providerType === 'akash') {
      const akashProvider = provider as AkashProvider;
      const secretValue = await this.vault.getSecret(
        credential.secretId,
        credential.owner
      );
      const akashCredential = JSON.parse(secretValue) as AkashCredential;

      // Try to list offerings (lightweight check)
      const offerings = await akashProvider.listOfferings();
      return offerings.length > 0;
    }

    return true;
  }

  /**
   * Get a credential for a provider type
   */
  getCredential(providerType: ExternalProviderType): BridgeNodeCredential | null {
    for (const credential of this.credentials.values()) {
      if (credential.providerType === providerType && credential.verified) {
        return credential;
      }
    }
    return null;
  }

  /**
   * Create a deployment on an external provider
   */
  async createDeployment(
    config: DeploymentConfig,
    providerType: ExternalProviderType
  ): Promise<ExternalDeployment> {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Provider ${providerType} not supported`);
    }

    const credential = this.getCredential(providerType);
    if (!credential) {
      throw new Error(`No verified credential for ${providerType}`);
    }

    console.log('[BridgeNode] Creating deployment', {
      deploymentId: config.deploymentId,
      providerType,
      user: config.userAddress,
    });

    const deployment = await provider.deploy(config, credential);

    // Track deployment
    this.activeDeployments.set(config.deploymentId, deployment);

    // Calculate and track revenue
    const quote = await provider.getQuote(config);
    const markup = (quote.totalCost * BigInt(this.config.defaultMarkupBps)) / 10000n;
    this.revenueEarned += markup;

    console.log('[BridgeNode] Deployment created', {
      deploymentId: deployment.deploymentId,
      status: deployment.status,
      revenue: markup.toString(),
    });

    return deployment;
  }

  /**
   * Get deployment status
   */
  async getDeployment(deploymentId: string): Promise<ExternalDeployment | null> {
    const cached = this.activeDeployments.get(deploymentId);
    if (!cached) return null;

    const provider = this.providers.get(cached.providerType);
    if (!provider) return cached;

    const fresh = await provider.getDeployment(deploymentId);
    if (fresh) {
      this.activeDeployments.set(deploymentId, fresh);
      return fresh;
    }

    return cached;
  }

  /**
   * Terminate a deployment
   */
  async terminateDeployment(
    deploymentId: string,
    reason: 'user_cancelled' | 'expired' | 'error'
  ): Promise<void> {
    const deployment = this.activeDeployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    const provider = this.providers.get(deployment.providerType);
    const credential = this.getCredential(deployment.providerType);

    if (provider && credential) {
      await provider.terminate(deploymentId, credential);
    }

    this.activeDeployments.delete(deploymentId);

    console.log('[BridgeNode] Deployment terminated', { deploymentId, reason });
  }

  /**
   * Handle slashing event (called by contract or governance)
   */
  async handleSlashing(
    reason: SlashingReason,
    deploymentId: string,
    evidenceHash: Hex
  ): Promise<SlashingEvent> {
    const config = this.config.slashingConfig;

    // Calculate slash amount from revenue, not stake
    const slashAmount = (this.revenueEarned * BigInt(config.revenueSlashBps)) / 10000n;

    const event: SlashingEvent = {
      eventId: keccak256(toHex(`${deploymentId}-${reason}-${Date.now()}`)),
      bridgeNode: this.config.walletAddress,
      reason,
      amountSlashed: slashAmount,
      stakeSlashed: false,
      deploymentId,
      timestamp: Date.now(),
      evidenceHash,
      disputed: false,
    };

    // Check if stake should be slashed (repeat offenders)
    const recentSlashes = this.slashingEvents.filter(
      (e) => Date.now() - e.timestamp < 7 * 24 * 60 * 60 * 1000 // Last 7 days
    );

    if (recentSlashes.length >= 3) {
      event.stakeSlashed = true;
      console.warn('[BridgeNode] Stake slashing triggered due to repeat offenses');
    }

    this.slashingEvents.push(event);
    this.revenueEarned -= slashAmount;

    console.log('[BridgeNode] Slashing event', {
      eventId: event.eventId,
      reason,
      amount: slashAmount.toString(),
      stakeSlashed: event.stakeSlashed,
    });

    return event;
  }

  /**
   * Get bridge node status
   */
  getStatus(): BridgeNodeConfig {
    return {
      address: this.config.walletAddress,
      agentId: this.config.agentId,
      supportedProviders: this.config.supportedProviders,
      stake: parseEther('0.1'), // Would be fetched from contract
      minStakeRequired: parseEther('0.01'),
      markupBps: this.config.defaultMarkupBps,
      regions: ['global'],
      maxConcurrentDeployments: 100,
      activeDeployments: this.activeDeployments.size,
      totalDeploymentsCompleted: 0n,
      totalRevenueEarned: this.revenueEarned,
      totalSlashed: this.slashingEvents.reduce((acc, e) => acc + e.amountSlashed, 0n),
      reputationScore: this.calculateReputationScore(),
      active: true,
      registeredAt: Date.now(),
    };
  }

  /**
   * Calculate reputation score (0-100)
   */
  private calculateReputationScore(): number {
    const baseScore = 80;

    // Deduct for recent slashing events
    const recentSlashes = this.slashingEvents.filter(
      (e) => Date.now() - e.timestamp < 30 * 24 * 60 * 60 * 1000
    );
    const slashPenalty = recentSlashes.length * 10;

    // Add for successful deployments
    const successBonus = Math.min(20, this.activeDeployments.size * 2);

    return Math.max(0, Math.min(100, baseScore - slashPenalty + successBonus));
  }

  /**
   * List all active deployments
   */
  listActiveDeployments(): ExternalDeployment[] {
    return Array.from(this.activeDeployments.values());
  }

  /**
   * Get slashing events for this bridge node
   */
  getSlashingEvents(): SlashingEvent[] {
    return this.slashingEvents;
  }

  /**
   * Refresh all provider pricing
   */
  async refreshPricing(): Promise<void> {
    for (const [providerType, provider] of this.providers) {
      await provider.listOfferings();
      console.log('[BridgeNode] Pricing refreshed for', providerType);
    }
  }

  /**
   * Health check all active deployments
   */
  async healthCheckAll(): Promise<Array<{
    deploymentId: string;
    healthy: boolean;
    latencyMs: number;
  }>> {
    const results: Array<{
      deploymentId: string;
      healthy: boolean;
      latencyMs: number;
    }> = [];

    for (const [deploymentId, deployment] of this.activeDeployments) {
      const provider = this.providers.get(deployment.providerType);
      if (!provider) continue;

      const health = await provider.healthCheck(deploymentId);
      results.push({
        deploymentId,
        healthy: health.healthy,
        latencyMs: health.latencyMs,
      });

      // Handle unhealthy deployments
      if (!health.healthy && deployment.status === 'active') {
        console.warn('[BridgeNode] Unhealthy deployment detected', { deploymentId });
        // Could trigger slashing or remediation here
      }
    }

    return results;
  }
}

/**
 * Create bridge node service from environment
 */
export function createBridgeNodeFromEnv(): BridgeNodeService {
  const walletAddress = process.env.BRIDGE_NODE_ADDRESS as Address;
  const agentId = BigInt(process.env.BRIDGE_NODE_AGENT_ID ?? '0');
  const privateKey = process.env.PRIVATE_KEY ?? '';
  const rpcUrl = process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:9545';

  if (!walletAddress) {
    throw new Error('BRIDGE_NODE_ADDRESS environment variable required');
  }

  const supportedProviders: ExternalProviderType[] = [];
  if (process.env.ENABLE_AKASH === 'true') {
    supportedProviders.push('akash');
  }

  if (supportedProviders.length === 0) {
    console.warn('[BridgeNode] No providers enabled, defaulting to Akash');
    supportedProviders.push('akash');
  }

  const governanceAddress = (process.env.GOVERNANCE_ADDRESS ?? '0x0000000000000000000000000000000000000000') as Address;

  return new BridgeNodeService({
    walletAddress,
    agentId,
    supportedProviders,
    defaultMarkupBps: parseInt(process.env.BRIDGE_NODE_MARKUP_BPS ?? '1000', 10),
    slashingConfig: {
      revenueSlashBps: parseInt(process.env.SLASHING_REVENUE_BPS ?? '1000', 10),
      minReputationForStakeProtection: parseInt(process.env.SLASHING_MIN_REPUTATION ?? '50', 10),
      stakeSlashBps: parseInt(process.env.SLASHING_STAKE_BPS ?? '100', 10),
      slashingCooldownSec: parseInt(process.env.SLASHING_COOLDOWN_SEC ?? '3600', 10),
      governanceAddress,
    },
    rpcUrl,
    privateKey,
  });
}

// Singleton instance
let bridgeNodeInstance: BridgeNodeService | null = null;

export function getBridgeNodeService(): BridgeNodeService {
  if (!bridgeNodeInstance) {
    bridgeNodeInstance = createBridgeNodeFromEnv();
  }
  return bridgeNodeInstance;
}

export function resetBridgeNodeService(): void {
  bridgeNodeInstance = null;
}

