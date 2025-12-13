import { createPublicClient, createWalletClient, http, type Address, type Hex, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unfunded' | 'unknown';
type ResourceType = 'ipfs_content' | 'compute_endpoint' | 'trigger' | 'storage' | 'agent' | 'custom';

interface HealthResponse {
  status: HealthStatus;
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
}

interface ResourceCheckResult {
  type: ResourceType;
  identifier: string;
  status: HealthStatus;
  latencyMs: number;
  error?: string;
  response?: HealthResponse;
}

interface HealthCheckResult {
  keepaliveId: string;
  status: HealthStatus;
  timestamp: number;
  balance: bigint;
  healthyResources: number;
  totalResources: number;
  failedResources: string[];
  resourceResults: ResourceCheckResult[];
}

const KEEPALIVE_REGISTRY_ABI = parseAbi([
  'function getKeepalivesNeedingCheck(uint256 maxResults) view returns (bytes32[])',
  'function keepalives(bytes32 keepaliveId) view returns (bytes32, address, bytes32, uint256, address, uint256, uint256, uint256, bool, bool, uint256, uint256, uint8)',
  'function keepaliveResources(bytes32 keepaliveId, uint256 index) view returns (uint8 resourceType, string identifier, string healthEndpoint, uint256 minBalance, bool required)',
  'function recordHealthCheck(bytes32 keepaliveId, uint8 status, uint256 balance, uint8 healthyResources, uint8 totalResources, string[] failedResources) external',
]);

export interface KeepaliveExecutorConfig {
  rpcUrl: string;
  privateKey: Hex;
  keepaliveRegistryAddress: Address;
  checkIntervalMs: number;
  maxConcurrentChecks: number;
  healthCheckTimeoutMs: number;
}

const StatusToNumber: Record<HealthStatus, number> = {
  unknown: 0,
  healthy: 1,
  degraded: 2,
  unhealthy: 3,
  unfunded: 4,
};

export class KeepaliveExecutor {
  private config: KeepaliveExecutorConfig;
  private publicClient;
  private walletClient;
  private running = false;
  private checkInterval?: Timer;

  constructor(config: KeepaliveExecutorConfig) {
    this.config = config;

    const account = privateKeyToAccount(config.privateKey);

    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account,
      transport: http(config.rpcUrl),
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('[Keepalive Executor] Starting...');

    await this.executeChecks();

    this.checkInterval = setInterval(
      () => this.executeChecks(),
      this.config.checkIntervalMs
    );
  }

  stop(): void {
    this.running = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    console.log('[Keepalive Executor] Stopped');
  }

  async executeChecks(): Promise<void> {
    try {
      const keepaliveIds = await this.publicClient.readContract({
        address: this.config.keepaliveRegistryAddress,
        abi: KEEPALIVE_REGISTRY_ABI,
        functionName: 'getKeepalivesNeedingCheck',
        args: [BigInt(this.config.maxConcurrentChecks)],
      }) as Hex[];

      console.log(`[Keepalive Executor] Checking ${keepaliveIds.length} keepalives`);

      const results = await Promise.allSettled(
        keepaliveIds.map(id => this.checkKeepalive(id))
      );

      const success = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      console.log(`[Keepalive Executor] Completed: ${success} success, ${failed} failed`);
    } catch (error) {
      console.error('[Keepalive Executor] Check cycle failed:', error);
    }
  }

  async checkKeepalive(keepaliveId: Hex): Promise<HealthCheckResult> {
    console.log(`[Keepalive Executor] Checking ${keepaliveId.slice(0, 10)}...`);

    const keepalive = await this.publicClient.readContract({
      address: this.config.keepaliveRegistryAddress,
      abi: KEEPALIVE_REGISTRY_ABI,
      functionName: 'keepalives',
      args: [keepaliveId],
    }) as [Hex, Address, Hex, bigint, Address, bigint, bigint, bigint, boolean, boolean, bigint, bigint, number];

    const vaultAddress = keepalive[4];
    const minBalance = keepalive[5];

    const balance = await this.publicClient.getBalance({ address: vaultAddress });
    const funded = balance >= minBalance;

    const resources: Array<{
      resourceType: number;
      identifier: string;
      healthEndpoint: string;
      minBalance: bigint;
      required: boolean;
    }> = [];

    for (let i = 0; i < 10; i++) {
      try {
        const resource = await this.publicClient.readContract({
          address: this.config.keepaliveRegistryAddress,
          abi: KEEPALIVE_REGISTRY_ABI,
          functionName: 'keepaliveResources',
          args: [keepaliveId, BigInt(i)],
        }) as [number, string, string, bigint, boolean];

        // Empty identifier means no resource at this index
        if (!resource[1]) break;

        resources.push({
          resourceType: resource[0],
          identifier: resource[1],
          healthEndpoint: resource[2],
          minBalance: resource[3],
          required: resource[4],
        });
      } catch (error) {
        // Check if this is an out-of-bounds revert (expected when no more resources)
        const errorStr = String(error);
        if (errorStr.includes('revert') || errorStr.includes('out of bounds')) {
          break;
        }
        // Re-throw unexpected errors
        throw new Error(`Failed to fetch resource ${i} for keepalive ${keepaliveId}: ${errorStr}`);
      }
    }

    const resourceResults: ResourceCheckResult[] = [];
    const failedResources: string[] = [];

    for (const resource of resources) {
      const result = await this.checkResource(resource);
      resourceResults.push(result);

      if (result.status !== 'healthy' && resource.required) {
        failedResources.push(resource.identifier);
      }
    }

    let status: HealthStatus;
    if (!funded) {
      status = 'unfunded';
    } else if (failedResources.length > 0) {
      status = 'unhealthy';
    } else if (resourceResults.some(r => r.status === 'degraded')) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    const healthyCount = resourceResults.filter(r => r.status === 'healthy').length;

    await this.recordResult(keepaliveId, status, balance, healthyCount, resources.length, failedResources);

    return {
      keepaliveId,
      status,
      timestamp: Date.now(),
      balance,
      healthyResources: healthyCount,
      totalResources: resources.length,
      failedResources,
      resourceResults,
    };
  }

  async checkResource(resource: {
    resourceType: number;
    identifier: string;
    healthEndpoint: string;
    minBalance: bigint;
    required: boolean;
  }): Promise<ResourceCheckResult> {
    const type = this.resourceTypeFromNumber(resource.resourceType);
    const start = Date.now();

    try {
      if (!resource.healthEndpoint) {
        return {
          type,
          identifier: resource.identifier,
          status: 'unknown',
          latencyMs: 0,
          error: 'No health endpoint configured',
        };
      }

      const response = await fetch(resource.healthEndpoint, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.healthCheckTimeoutMs),
        headers: { Accept: 'application/json' },
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return {
          type,
          identifier: resource.identifier,
          status: 'unhealthy',
          latencyMs,
          error: `HTTP ${response.status}`,
        };
      }

      const data = await response.json() as HealthResponse;
      const status: HealthStatus = data.status || 'healthy';

      return {
        type,
        identifier: resource.identifier,
        status,
        latencyMs,
        response: data,
      };
    } catch (error) {
      return {
        type,
        identifier: resource.identifier,
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async recordResult(
    keepaliveId: Hex,
    status: HealthStatus,
    balance: bigint,
    healthyResources: number,
    totalResources: number,
    failedResources: string[]
  ): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { request } = await this.publicClient.simulateContract({
          address: this.config.keepaliveRegistryAddress,
          abi: KEEPALIVE_REGISTRY_ABI,
          functionName: 'recordHealthCheck',
          args: [
            keepaliveId,
            StatusToNumber[status],
            balance,
            healthyResources,
            totalResources,
            failedResources,
          ],
          account: this.walletClient.account,
        });

        await this.walletClient.writeContract(request);
        console.log(`[Keepalive Executor] Recorded: ${keepaliveId.slice(0, 10)} = ${status}`);
        return;
      } catch (error) {
        const isLastAttempt = attempt === MAX_RETRIES;
        console.error(
          `[Keepalive Executor] Failed to record ${keepaliveId} (attempt ${attempt}/${MAX_RETRIES}):`,
          error
        );

        if (isLastAttempt) {
          throw new Error(`Failed to record health check for ${keepaliveId} after ${MAX_RETRIES} attempts: ${error}`);
        }

        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }
    }
  }

  private resourceTypeFromNumber(num: number): ResourceType {
    const types: ResourceType[] = [
      'ipfs_content',
      'compute_endpoint',
      'trigger',
      'storage',
      'agent',
      'custom',
    ];
    return types[num] ?? 'custom';
  }
}

export function createKeepaliveExecutor(config: Partial<KeepaliveExecutorConfig>): KeepaliveExecutor {
  return new KeepaliveExecutor({
    rpcUrl: config.rpcUrl ?? process.env.RPC_URL ?? 'http://127.0.0.1:8545',
    privateKey: (config.privateKey ?? process.env.EXECUTOR_PRIVATE_KEY ?? '0x0') as Hex,
    keepaliveRegistryAddress: (config.keepaliveRegistryAddress ?? process.env.KEEPALIVE_REGISTRY_ADDRESS ?? '0x0') as Address,
    checkIntervalMs: config.checkIntervalMs ?? 60000,
    maxConcurrentChecks: config.maxConcurrentChecks ?? 10,
    healthCheckTimeoutMs: config.healthCheckTimeoutMs ?? 10000,
  });
}

if (import.meta.main) {
  const executor = createKeepaliveExecutor({});
  
  process.on('SIGINT', () => {
    executor.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    executor.stop();
    process.exit(0);
  });
  
  executor.start();
}
