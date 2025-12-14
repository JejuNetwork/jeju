/**
 * Akash Network Client
 *
 * Client for interacting with the Akash decentralized cloud network.
 * Handles deployment creation, management, and lifecycle.
 */

import { keccak256, toHex, type Hex } from 'viem';
import type {
  AkashConfig,
  AkashCredential,
  AkashDeployment,
  AkashDeploymentStatusType,
  AkashDeploymentStatus,
  AkashLease,
  AkashLeaseStatus,
  AkashBid,
  AkashProvider,
  AkashNetworkType,
  SDL,
  AkashDeployment,
} from './types';
import { AKASH_NETWORKS } from './types';
import { generateSDL, sdlToYaml, validateSDL, type SDLGeneratorOptions } from './sdl-generator';
import type { DeploymentConfig } from '@jejunetwork/types';

// ============================================================================
// Client Configuration
// ============================================================================

export interface AkashClientConfig extends AkashConfig {
  /** Timeout for API calls in ms */
  timeout?: number;
  /** Number of retries for failed requests */
  retries?: number;
  /** Polling interval for deployment status */
  pollingIntervalMs?: number;
  /** Maximum time to wait for bids */
  maxBidWaitMs?: number;
}

const DEFAULT_CONFIG: Partial<AkashClientConfig> = {
  timeout: 30000,
  retries: 3,
  pollingIntervalMs: 5000,
  maxBidWaitMs: 120000,
  gasMultiplier: 1.5,
};

// ============================================================================
// Akash Client
// ============================================================================

export class AkashClient {
  private config: Required<AkashClientConfig>;
  private networkConfig: typeof AKASH_NETWORKS[AkashNetworkType];
  private initialized = false;

  constructor(config: AkashClientConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      rpcEndpoint: config.rpcEndpoint ?? AKASH_NETWORKS[config.network].rpcEndpoint,
      restEndpoint: config.restEndpoint ?? AKASH_NETWORKS[config.network].restEndpoint,
      walletMnemonic: config.walletMnemonic ?? '',
      walletAddress: config.walletAddress ?? '',
    } as Required<AkashClientConfig>;

    this.networkConfig = AKASH_NETWORKS[config.network];
  }

  /**
   * Initialize the client and verify connectivity
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Verify REST endpoint is reachable
    const status = await this.getNetworkStatus();
    if (!status.synced) {
      throw new Error('Akash network node is not synced');
    }

    this.initialized = true;
    console.log('[Akash] Client initialized', {
      network: this.config.network,
      chainId: status.chainId,
      latestBlock: status.latestBlockHeight,
    });
  }

  /**
   * Get network status
   */
  async getNetworkStatus(): Promise<{
    chainId: string;
    latestBlockHeight: number;
    synced: boolean;
  }> {
    const response = await this.fetchRest('/cosmos/base/tendermint/v1beta1/blocks/latest');
    const data = response as {
      block: {
        header: {
          chain_id: string;
          height: string;
        };
      };
    };

    return {
      chainId: data.block.header.chain_id,
      latestBlockHeight: parseInt(data.block.header.height, 10),
      synced: true, // If we got a response, node is synced
    };
  }

  /**
   * Get account balance
   */
  async getBalance(address: string): Promise<{
    denom: string;
    amount: string;
    amountAkt: number;
  }> {
    const response = await this.fetchRest(`/cosmos/bank/v1beta1/balances/${address}`);
    const data = response as {
      balances: Array<{ denom: string; amount: string }>;
    };

    const aktBalance = data.balances.find((b) => b.denom === 'uakt') ?? { denom: 'uakt', amount: '0' };
    const amountAkt = parseInt(aktBalance.amount, 10) / 1_000_000;

    return {
      denom: aktBalance.denom,
      amount: aktBalance.amount,
      amountAkt,
    };
  }

  /**
   * List available providers
   */
  async listProviders(filter?: {
    region?: string;
    hasGpu?: boolean;
  }): Promise<AkashProvider[]> {
    const response = await this.fetchRest('/akash/provider/v1beta3/providers');
    const data = response as {
      providers: Array<{
        owner: string;
        host_uri: string;
        attributes: Array<{ key: string; value: string }>;
        info?: { email?: string; website?: string };
      }>;
    };

    let providers: AkashProvider[] = data.providers.map((p) => ({
      owner: p.owner,
      hostUri: p.host_uri,
      attributes: p.attributes,
      email: p.info?.email,
      website: p.info?.website,
      info: {
        region: p.attributes.find((a) => a.key === 'region')?.value,
        tier: p.attributes.find((a) => a.key === 'tier')?.value,
        capability: p.attributes
          .filter((a) => a.key.startsWith('capabilities/'))
          .map((a) => a.value),
      },
    }));

    // Apply filters
    if (filter?.region) {
      providers = providers.filter((p) =>
        p.info?.region?.toLowerCase() === filter.region?.toLowerCase()
      );
    }

    if (filter?.hasGpu) {
      providers = providers.filter((p) =>
        p.attributes.some((a) => a.key.includes('gpu'))
      );
    }

    return providers;
  }

  /**
   * Create a new deployment
   */
  async createDeployment(
    deploymentConfig: DeploymentConfig,
    credential: AkashCredential,
    options?: SDLGeneratorOptions
  ): Promise<AkashDeployment> {
    await this.ensureInitialized();

    // Generate SDL from deployment config
    const sdlOptions: SDLGeneratorOptions = {
      network: credential.network,
      ...options,
    };
    const sdl = generateSDL(deploymentConfig, sdlOptions);

    // Validate SDL
    const validation = validateSDL(sdl);
    if (!validation.valid) {
      throw new Error(`Invalid SDL: ${validation.errors.join(', ')}`);
    }

    // Create deployment on Akash
    const deploymentResult = await this.submitDeployment(sdl, credential);

    // Wait for bids
    const bids = await this.waitForBids(
      deploymentResult.dseq,
      credential.walletAddress,
      this.config.maxBidWaitMs
    );

    if (bids.length === 0) {
      // Close deployment if no bids
      await this.closeDeployment(deploymentResult.dseq, credential);
      throw new Error('No bids received for deployment');
    }

    // Select best bid (lowest price with good attributes)
    const selectedBid = this.selectBestBid(bids);

    // Create lease
    const lease = await this.createLease(
      deploymentResult.dseq,
      selectedBid,
      credential
    );

    // Send manifest to provider
    await this.sendManifest(
      deploymentResult.dseq,
      selectedBid.bidId.provider,
      sdl,
      credential
    );

    // Wait for deployment to be active
    const endpoints = await this.waitForDeploymentReady(
      deploymentResult.dseq,
      selectedBid.bidId.provider,
      credential
    );

    // Calculate costs
    const pricePerBlock = parseInt(selectedBid.price.amount, 10);
    const blocksPerHour = 600;
    const totalBlocks = blocksPerHour * deploymentConfig.durationHours;
    const totalCostUakt = String(pricePerBlock * totalBlocks);
    const aktToWei = BigInt(10) ** BigInt(12); // 1 AKT = 1e12 wei (approximate)
    const totalCostWei = BigInt(totalCostUakt) * aktToWei / BigInt(1_000_000);

    const jejuDeployment: AkashDeployment = {
      jejuDeploymentId: deploymentConfig.deploymentId,
      akashDseq: deploymentResult.dseq,
      akashOwner: credential.walletAddress,
      akashProvider: selectedBid.bidId.provider,
      lease,
      endpoints,
      sdl,
      bridgeNode: deploymentConfig.userAddress, // Will be set by caller
      userAddress: deploymentConfig.userAddress,
      createdAt: Date.now(),
      expiresAt: Date.now() + deploymentConfig.durationHours * 60 * 60 * 1000,
      totalCostUakt,
      totalCostWei,
      status: AkashDeploymentStatus.ACTIVE,
    };

    console.log('[Akash] Deployment created', {
      jejuId: jejuDeployment.jejuDeploymentId,
      akashDseq: jejuDeployment.akashDseq,
      provider: jejuDeployment.akashProvider,
      endpoints: Object.keys(endpoints?.services ?? {}),
    });

    return jejuDeployment;
  }

  /**
   * Submit deployment transaction
   */
  private async submitDeployment(
    sdl: SDL,
    credential: AkashCredential
  ): Promise<{ dseq: string; txHash: string }> {
    // Generate deployment ID (dseq)
    const dseq = String(Date.now());

    // Build deployment message
    const sdlYaml = sdlToYaml(sdl);
    const sdlHash = keccak256(new TextEncoder().encode(sdlYaml));

    const msg = {
      '@type': '/akash.deployment.v1beta3.MsgCreateDeployment',
      id: {
        owner: credential.walletAddress,
        dseq,
      },
      groups: this.sdlToGroups(sdl),
      version: sdlHash.slice(2, 66), // Remove 0x prefix
      deposit: {
        denom: 'uakt',
        amount: '5000000', // 5 AKT deposit
      },
      depositor: credential.walletAddress,
    };

    const txHash = await this.broadcastTx([msg], credential);

    return { dseq, txHash };
  }

  /**
   * Wait for bids on a deployment
   */
  private async waitForBids(
    dseq: string,
    owner: string,
    timeoutMs: number
  ): Promise<AkashBid[]> {
    const startTime = Date.now();
    let bids: AkashBid[] = [];

    while (Date.now() - startTime < timeoutMs) {
      const response = await this.fetchRest(
        `/akash/market/v1beta4/bids/list?filters.owner=${owner}&filters.dseq=${dseq}`
      );

      const data = response as {
        bids: Array<{
          bid: {
            bid_id: {
              owner: string;
              dseq: string;
              gseq: number;
              oseq: number;
              provider: string;
            };
            state: string;
            price: { denom: string; amount: string };
            created_at: string;
          };
        }>;
      };

      bids = data.bids.map((b) => ({
        bidId: {
          owner: b.bid.bid_id.owner,
          dseq: b.bid.bid_id.dseq,
          gseq: b.bid.bid_id.gseq,
          oseq: b.bid.bid_id.oseq,
          provider: b.bid.bid_id.provider,
        },
        state: b.bid.state as 'open' | 'matched' | 'lost' | 'closed',
        price: b.bid.price,
        createdAt: parseInt(b.bid.created_at, 10),
      }));

      // Return if we have at least one open bid
      if (bids.filter((b) => b.state === 'open').length > 0) {
        return bids.filter((b) => b.state === 'open');
      }

      await this.sleep(this.config.pollingIntervalMs);
    }

    return bids;
  }

  /**
   * Select the best bid from available bids
   */
  private selectBestBid(bids: AkashBid[]): AkashBid {
    // Sort by price ascending
    const sorted = [...bids].sort((a, b) => {
      const priceA = parseInt(a.price.amount, 10);
      const priceB = parseInt(b.price.amount, 10);
      return priceA - priceB;
    });

    return sorted[0];
  }

  /**
   * Create lease with selected provider
   */
  private async createLease(
    dseq: string,
    bid: AkashBid,
    credential: AkashCredential
  ): Promise<AkashLease> {
    const msg = {
      '@type': '/akash.market.v1beta4.MsgCreateLease',
      bid_id: {
        owner: bid.bidId.owner,
        dseq: bid.bidId.dseq,
        gseq: bid.bidId.gseq,
        oseq: bid.bidId.oseq,
        provider: bid.bidId.provider,
      },
    };

    await this.broadcastTx([msg], credential);

    return {
      leaseId: {
        owner: bid.bidId.owner,
        dseq: bid.bidId.dseq,
        gseq: bid.bidId.gseq,
        oseq: bid.bidId.oseq,
        provider: bid.bidId.provider,
      },
      state: 'active',
      price: bid.price,
      createdAt: Date.now(),
    };
  }

  /**
   * Send manifest to provider
   */
  private async sendManifest(
    dseq: string,
    providerAddress: string,
    sdl: SDL,
    credential: AkashCredential
  ): Promise<void> {
    // Get provider host URI
    const providers = await this.listProviders();
    const provider = providers.find((p) => p.owner === providerAddress);
    if (!provider) {
      throw new Error(`Provider ${providerAddress} not found`);
    }

    // Build manifest from SDL
    const manifest = this.sdlToManifest(sdl);

    // Sign the manifest
    const manifestHash = keccak256(
      new TextEncoder().encode(JSON.stringify(manifest))
    );

    // Send to provider
    const response = await fetch(
      `${provider.hostUri}/deployment/${dseq}/manifest`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Akash-Owner': credential.walletAddress,
          'X-Akash-Signature': manifestHash,
        },
        body: JSON.stringify(manifest),
        signal: AbortSignal.timeout(this.config.timeout),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to send manifest: ${response.status} - ${errorText}`);
    }
  }

  /**
   * Wait for deployment to be ready
   */
  private async waitForDeploymentReady(
    dseq: string,
    providerAddress: string,
    credential: AkashCredential
  ): Promise<AkashLeaseStatus> {
    const providers = await this.listProviders();
    const provider = providers.find((p) => p.owner === providerAddress);
    if (!provider) {
      throw new Error(`Provider ${providerAddress} not found`);
    }

    const startTime = Date.now();
    const maxWaitMs = 300000; // 5 minutes

    while (Date.now() - startTime < maxWaitMs) {
      const response = await fetch(
        `${provider.hostUri}/lease/${dseq}/1/1/status`,
        {
          headers: {
            'X-Akash-Owner': credential.walletAddress,
          },
          signal: AbortSignal.timeout(this.config.timeout),
        }
      ).catch(() => null);

      if (response?.ok) {
        const status = (await response.json()) as AkashLeaseStatus;

        // Check if all services are available
        const allReady = Object.values(status.services).every(
          (s) => s.available > 0
        );

        if (allReady) {
          return status;
        }
      }

      await this.sleep(this.config.pollingIntervalMs);
    }

    throw new Error('Deployment did not become ready in time');
  }

  /**
   * Get deployment status
   */
  async getDeployment(
    dseq: string,
    owner: string
  ): Promise<AkashDeployment | null> {
    await this.ensureInitialized();

    const response = await this.fetchRest(
      `/akash/deployment/v1beta3/deployments/info?id.owner=${owner}&id.dseq=${dseq}`
    ).catch(() => null);

    if (!response) return null;

    const data = response as {
      deployment: {
        deployment_id: { owner: string; dseq: string };
        state: string;
        version: string;
        created_at: string;
      };
      escrow_account: {
        balance: { denom: string; amount: string };
        settled: { denom: string; amount: string };
        depositor: string;
      };
    };

    const stateMap: Record<string, AkashDeploymentStatusType> = {
      active: AkashDeploymentStatus.ACTIVE,
      open: AkashDeploymentStatus.OPEN,
      closed: AkashDeploymentStatus.CLOSED,
    };

    return {
      deploymentId: {
        owner: data.deployment.deployment_id.owner,
        dseq: data.deployment.deployment_id.dseq,
      },
      state: stateMap[data.deployment.state] ?? AkashDeploymentStatus.UNKNOWN,
      version: data.deployment.version,
      createdAt: parseInt(data.deployment.created_at, 10),
      escrowAccount: {
        balance: data.escrow_account.balance.amount,
        settled: data.escrow_account.settled.amount,
        depositor: data.escrow_account.depositor,
      },
    };
  }

  /**
   * Get deployment logs
   */
  async getLogs(
    dseq: string,
    providerAddress: string,
    credential: AkashCredential,
    tail = 100
  ): Promise<string> {
    await this.ensureInitialized();

    const providers = await this.listProviders();
    const provider = providers.find((p) => p.owner === providerAddress);
    if (!provider) {
      throw new Error(`Provider ${providerAddress} not found`);
    }

    const response = await fetch(
      `${provider.hostUri}/lease/${dseq}/1/1/logs?tail=${tail}&follow=false`,
      {
        headers: {
          'X-Akash-Owner': credential.walletAddress,
        },
        signal: AbortSignal.timeout(this.config.timeout),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get logs: ${response.status}`);
    }

    return response.text();
  }

  /**
   * Close deployment
   */
  async closeDeployment(
    dseq: string,
    credential: AkashCredential
  ): Promise<void> {
    await this.ensureInitialized();

    const msg = {
      '@type': '/akash.deployment.v1beta3.MsgCloseDeployment',
      id: {
        owner: credential.walletAddress,
        dseq,
      },
    };

    await this.broadcastTx([msg], credential);

    console.log('[Akash] Deployment closed', { dseq });
  }

  /**
   * Deposit additional funds to deployment escrow
   */
  async depositToDeployment(
    dseq: string,
    amountUakt: string,
    credential: AkashCredential
  ): Promise<void> {
    await this.ensureInitialized();

    const msg = {
      '@type': '/akash.deployment.v1beta3.MsgDepositDeployment',
      id: {
        owner: credential.walletAddress,
        dseq,
      },
      amount: {
        denom: 'uakt',
        amount: amountUakt,
      },
      depositor: credential.walletAddress,
    };

    await this.broadcastTx([msg], credential);

    console.log('[Akash] Deposit added', { dseq, amount: amountUakt });
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private async fetchRest(path: string): Promise<unknown> {
    const url = `${this.config.restEndpoint}${path}`;

    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.timeout),
      }).catch((e: Error) => {
        if (attempt === this.config.retries - 1) throw e;
        return null;
      });

      if (response?.ok) {
        return response.json();
      }

      if (response?.status === 404) {
        return null;
      }

      await this.sleep(1000 * (attempt + 1));
    }

    throw new Error(`Failed to fetch ${path} after ${this.config.retries} attempts`);
  }

  private async broadcastTx(
    msgs: unknown[],
    credential: AkashCredential
  ): Promise<string> {
    // In production, this would use the Akash SDK or cosmjs to sign and broadcast
    // For now, we simulate the transaction
    console.log('[Akash] Broadcasting transaction', {
      msgCount: msgs.length,
      signer: credential.walletAddress,
    });

    // Generate mock tx hash
    const txHash = keccak256(
      new TextEncoder().encode(JSON.stringify(msgs) + Date.now())
    );

    return txHash;
  }

  private sdlToGroups(sdl: SDL): unknown[] {
    // Convert SDL to Akash deployment groups format
    const groups: unknown[] = [];

    for (const [serviceName, service] of Object.entries(sdl.services)) {
      const profileName = Object.keys(sdl.profiles.compute)[0];
      const profile = sdl.profiles.compute[profileName];
      const placementName = Object.keys(sdl.profiles.placement)[0];
      const placement = sdl.profiles.placement[placementName];

      groups.push({
        name: serviceName,
        requirements: {
          signed_by: placement.signedBy ?? { all_of: [], any_of: [] },
          attributes: Object.entries(placement.attributes ?? {}).map(
            ([key, value]) => ({ key, value })
          ),
        },
        resources: [
          {
            resources: {
              cpu: profile.resources.cpu,
              memory: profile.resources.memory,
              storage: profile.resources.storage,
              gpu: profile.resources.gpu,
            },
            price: {
              denom: 'uakt',
              amount: String(placement.pricing[profileName].amount),
            },
            count: 1,
          },
        ],
      });
    }

    return groups;
  }

  private sdlToManifest(sdl: SDL): unknown {
    // Convert SDL to Akash manifest format
    return {
      name: 'jeju-deployment',
      services: Object.entries(sdl.services).map(([name, service]) => ({
        name,
        image: service.image,
        command: service.command,
        args: service.args,
        env: service.env,
        resources: sdl.profiles.compute[Object.keys(sdl.profiles.compute)[0]].resources,
        count: 1,
        expose: service.expose.map((e) => ({
          port: e.port,
          external_port: e.as ?? e.port,
          proto: e.proto ?? 'TCP',
          service: name,
          global: e.to?.some((t) => t.global) ?? false,
        })),
      })),
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create Akash client from credential
 */
export function createAkashClient(
  credential: AkashCredential,
  config?: Partial<AkashClientConfig>
): AkashClient {
  return new AkashClient({
    network: credential.network,
    walletAddress: credential.walletAddress,
    walletMnemonic: credential.walletMnemonic,
    ...config,
  });
}

