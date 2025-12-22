/**
 * CDN Service - Edge node integration for the desktop app
 * 
 * Allows node operators to run CDN edge nodes from the desktop app,
 * serving cached content and earning from the CDN marketplace.
 */

import { z } from 'zod';
import { type Address } from 'viem';
import { type NodeClient, getChain } from '../contracts';
import { CDN_REGISTRY_ABI } from '../abis';
import type { CDNRegion } from '@jejunetwork/types';

// ============================================================================
// Types & Validation
// ============================================================================

// Use the actual CDNRegion type from @jejunetwork/types
const CDNRegionSchema = z.string(); // Will validate against actual CDNRegion values

const CDNServiceConfigSchema = z.object({
  endpoint: z.string().url(),
  region: CDNRegionSchema,
  maxCacheSizeMB: z.number().int().positive(),
  stakeAmount: z.bigint(),
  supportedOrigins: z.array(z.string().url()),
});

export interface CDNServiceConfig {
  endpoint: string;
  region: CDNRegion;
  maxCacheSizeMB: number;
  stakeAmount: bigint;
  supportedOrigins: string[];
}

const CDNNodeMetricsSchema = z.object({
  requestsTotal: z.number().int().nonnegative(),
  bytesServed: z.number().int().nonnegative(),
  cacheHitRate: z.number().min(0).max(100),
  avgLatencyMs: z.number().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
  cacheEntries: z.number().int().nonnegative(),
  cacheSizeBytes: z.number().int().nonnegative(),
});

export interface CDNNodeMetrics {
  requestsTotal: number;
  bytesServed: number;
  cacheHitRate: number;
  avgLatencyMs: number;
  activeConnections: number;
  cacheEntries: number;
  cacheSizeBytes: number;
}

const CDNServiceStateSchema = z.object({
  isRegistered: z.boolean(),
  nodeId: z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((val) => val as `0x${string}`),
  endpoint: z.string().url(),
  region: CDNRegionSchema.transform((val) => val as CDNRegion),
  stake: z.bigint(),
  status: z.enum(['healthy', 'degraded', 'unhealthy', 'maintenance', 'offline']),
  metrics: CDNNodeMetricsSchema,
});

export interface CDNServiceState {
  isRegistered: boolean;
  nodeId: `0x${string}`;
  endpoint: string;
  region: CDNRegion;
  stake: bigint;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'maintenance' | 'offline';
  metrics: CDNNodeMetrics;
}

const CDNEarningsSchema = z.object({
  pending: z.bigint(),
  total: z.bigint(),
  lastSettlement: z.number().int().positive(),
});

export interface CDNEarnings {
  pending: bigint;
  total: bigint;
  lastSettlement: number;
}

export function validateCDNServiceConfig(data: unknown): CDNServiceConfig {
  const parsed = CDNServiceConfigSchema.parse(data);
  return {
    ...parsed,
    region: parsed.region as CDNRegion,
  };
}

export function validateCDNServiceState(data: unknown): CDNServiceState {
  return CDNServiceStateSchema.parse(data);
}

export function validateCDNNodeMetrics(data: unknown): CDNNodeMetrics {
  return CDNNodeMetricsSchema.parse(data);
}

export function validateCDNEarnings(data: unknown): CDNEarnings {
  return CDNEarningsSchema.parse(data);
}

// ============================================================================
// CDN Service
// ============================================================================

export class CDNService {
  private client: NodeClient;
  private edgeNodeProcess: ChildProcess | null = null;

  constructor(client: NodeClient) {
    this.client = client;
  }

  /**
   * Get CDN service state
   */
  async getState(address: Address): Promise<CDNServiceState | null> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error(`Invalid address: ${address}`);
    }
    
    // Get operator's nodes
    const nodeIds = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'getOperatorNodes',
      args: [address],
    }) as readonly `0x${string}`[];

    if (nodeIds.length === 0) {
      return null;
    }

    // Get first node's details
    const nodeId = nodeIds[0];
    const nodeResult = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'getEdgeNode',
      args: [nodeId],
    });
    const node = {
      nodeId: nodeResult[0] as `0x${string}`,
      operator: nodeResult[1] as Address,
      endpoint: nodeResult[2] as string,
      region: nodeResult[3] as number,
      providerType: nodeResult[4] as number,
      status: nodeResult[5] as number,
      stake: nodeResult[6] as bigint,
      registeredAt: nodeResult[7] as bigint,
      lastSeen: nodeResult[8] as bigint,
      agentId: nodeResult[9] as bigint,
    };

    const metricsResult = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'getNodeMetrics',
      args: [nodeId],
    });
    const metrics = {
      currentLoad: metricsResult[0] as bigint,
      bandwidthUsage: metricsResult[1] as bigint,
      activeConnections: metricsResult[2] as bigint,
      requestsPerSecond: metricsResult[3] as bigint,
      bytesServedTotal: metricsResult[4] as bigint,
      requestsTotal: metricsResult[5] as bigint,
      cacheSize: metricsResult[6] as bigint,
      cacheEntries: metricsResult[7] as bigint,
      cacheHitRate: metricsResult[8] as bigint,
      avgResponseTime: metricsResult[9] as bigint,
      lastUpdated: metricsResult[10] as bigint,
    };

    const regionMap: CDNRegion[] = [
      'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'eu-west-1', 'eu-west-2', 'eu-central-1',
      'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1', 'ap-southeast-2',
      'ap-south-1', 'sa-east-1', 'af-south-1', 'me-south-1', 'global',
    ];

    const statusMap: CDNServiceState['status'][] = [
      'healthy', 'degraded', 'unhealthy', 'maintenance', 'offline',
    ];

    const rawState = {
      isRegistered: true,
      nodeId: node.nodeId,
      endpoint: node.endpoint,
      region: regionMap[node.region] ?? 'global',
      stake: node.stake,
      status: statusMap[node.status] ?? 'offline',
      metrics: {
        requestsTotal: Number(metrics.requestsTotal),
        bytesServed: Number(metrics.bytesServedTotal),
        cacheHitRate: Number(metrics.cacheHitRate) / 100, // Stored as basis points
        avgLatencyMs: Number(metrics.avgResponseTime),
        activeConnections: Number(metrics.activeConnections),
        cacheEntries: Number(metrics.cacheEntries),
        cacheSizeBytes: Number(metrics.cacheSize),
      },
    };
    
    return validateCDNServiceState(rawState);
  }

  /**
   * Register as CDN edge node
   */
  async register(config: CDNServiceConfig): Promise<string> {
    const validatedConfig = validateCDNServiceConfig(config);
    
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const regionIndex = this.getRegionIndex(validatedConfig.region);

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'registerEdgeNode',
      args: [validatedConfig.endpoint, regionIndex, 0], // 0 = decentralized type
      value: validatedConfig.stakeAmount,
    });

    return hash;
  }

  /**
   * Start the edge node process
   */
  async startEdgeNode(nodeId: string, config: {
    port: number;
    maxCacheSizeMB: number;
    origins: Array<{ name: string; type: string; endpoint: string }>;
  }): Promise<void> {
    if (this.edgeNodeProcess) {
      console.warn('[CDN] Edge node already running');
      return;
    }

    const privateKey = await this.getPrivateKey();

    // Start edge node as subprocess
    this.edgeNodeProcess = Bun.spawn({
      cmd: ['bun', 'run', '-w', '@jejunetwork/dws', 'cdn:edge'],
      env: {
        ...process.env,
        CDN_NODE_ID: nodeId,
        CDN_PORT: config.port.toString(),
        CDN_CACHE_SIZE_MB: config.maxCacheSizeMB.toString(),
        PRIVATE_KEY: privateKey,
        CDN_REGISTRY_ADDRESS: this.client.addresses.cdnRegistry,
        CDN_BILLING_ADDRESS: this.client.addresses.cdnBilling,
        RPC_URL: process.env.RPC_URL ?? 'http://localhost:9545',
      },
      stdio: ['inherit', 'inherit', 'inherit'],
    });

    console.log(`[CDN] Started edge node on port ${config.port}`);
  }

  /**
   * Stop the edge node process
   */
  async stopEdgeNode(): Promise<void> {
    if (this.edgeNodeProcess) {
      this.edgeNodeProcess.kill();
      this.edgeNodeProcess = null;
      console.log('[CDN] Stopped edge node');
    }
  }

  /**
   * Check if edge node is running
   */
  isRunning(): boolean {
    return this.edgeNodeProcess !== null;
  }

  /**
   * Get earnings with last settlement time
   */
  async getEarnings(address: Address): Promise<CDNEarnings> {
    const [pending, settled] = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnBilling,
      abi: [
        'function getProviderEarnings(address) view returns (uint256, uint256)',
      ],
      functionName: 'getProviderEarnings',
      args: [address],
    }) as [bigint, bigint];

    // Get billing records to find the most recent settlement
    const lastSettlement = await this.getLastSettlementTime(address);

    return {
      pending,
      total: settled,
      lastSettlement,
    };
  }

  /**
   * Get the timestamp of the provider's last settlement
   * Queries billing records and finds the most recent one
   */
  private async getLastSettlementTime(providerAddress: Address): Promise<number> {
    // Get provider's billing record IDs
    const billingRecordIds = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnBilling,
      abi: [
        'function getProviderBillingRecords(address) view returns (bytes32[])',
      ],
      functionName: 'getProviderBillingRecords',
      args: [providerAddress],
    }) as `0x${string}`[];

    if (billingRecordIds.length === 0) {
      return 0; // No settlements yet
    }

    // Get the most recent billing record (last in array is most recent)
    const latestRecordId = billingRecordIds[billingRecordIds.length - 1];
    
    const record = await this.client.publicClient.readContract({
      address: this.client.addresses.cdnBilling,
      abi: [
        'function getBillingRecord(bytes32) view returns ((bytes32 id, address user, address provider, uint256 amount, uint256 timestamp, uint8 status, uint256 periodStart, uint256 periodEnd))',
      ],
      functionName: 'getBillingRecord',
      args: [latestRecordId],
    }) as {
      id: `0x${string}`;
      user: Address;
      provider: Address;
      amount: bigint;
      timestamp: bigint;
      status: number;
      periodStart: bigint;
      periodEnd: bigint;
    };

    // Return timestamp in milliseconds
    return Number(record.timestamp) * 1000;
  }

  /**
   * Withdraw earnings
   */
  async withdrawEarnings(): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.cdnBilling,
      abi: ['function providerWithdraw() external'],
      functionName: 'providerWithdraw',
      args: [],
    });

    return hash;
  }

  /**
   * Add stake to node
   */
  async addStake(nodeId: `0x${string}`, amount: bigint): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'addNodeStake',
      args: [nodeId],
      value: amount,
    });

    return hash;
  }

  /**
   * Update node status
   */
  async updateStatus(nodeId: `0x${string}`, status: CDNServiceState['status']): Promise<string> {
    if (!this.client.walletClient?.account) {
      throw new Error('Wallet not connected');
    }

    const statusMap: Record<CDNServiceState['status'], number> = {
      healthy: 0,
      degraded: 1,
      unhealthy: 2,
      maintenance: 3,
      offline: 4,
    };

    const hash = await this.client.walletClient.writeContract({
      chain: getChain(this.client.chainId),
      account: this.client.walletClient.account,
      address: this.client.addresses.cdnRegistry,
      abi: CDN_REGISTRY_ABI,
      functionName: 'updateNodeStatus',
      args: [nodeId, statusMap[status]],
    });

    return hash;
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private getRegionIndex(region: CDNRegion): number {
    const regions: CDNRegion[] = [
      'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'eu-west-1', 'eu-west-2', 'eu-central-1',
      'ap-northeast-1', 'ap-northeast-2', 'ap-southeast-1', 'ap-southeast-2',
      'ap-south-1', 'sa-east-1', 'af-south-1', 'me-south-1', 'global',
    ];
    return regions.indexOf(region);
  }

  private async getPrivateKey(): Promise<string> {
    // In Tauri, this would come from secure storage
    // For now, use environment variable
    const key = process.env.PRIVATE_KEY;
    if (!key) {
      throw new Error('Private key not available');
    }
    return key;
  }
}

// ============================================================================
// Types for subprocess
// ============================================================================

interface ChildProcess {
  kill(): void;
}

// ============================================================================
// Factory
// ============================================================================

export function createCDNService(client: NodeClient): CDNService {
  return new CDNService(client);
}

