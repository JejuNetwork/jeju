/**
 * Phala Cloud Provider
 *
 * Integrates with Phala's CVM (Confidential Virtual Machine) for:
 * - Backend serving (no GPU) - ideal for game servers, APIs
 * - GPU workloads - training, inference
 * - TEE attestation - secure enclaves
 *
 * Phala provides Intel TDX-based confidential VMs that can run:
 * - Docker containers with full isolation
 * - Node.js/Python backends
 * - Static site serving
 * 
 * NOTE: This is the core Phala provider with generic configuration.
 * For vendor-specific configurations (e.g., Babylon game servers),
 * see vendor/phala/src/phala-provider.ts
 */

import type {
  TEEProvider,
  TEENode,
  TEEDeploymentConfig,
  TEEProvisionRequest,
  TEEProvisionResult,
  TEEHardwareInfo,
} from './tee-interface';
import { TEEProviderType, TEEHardwareType } from './tee-interface';
import type { Hex } from 'viem';

// ============================================================================
// Types
// ============================================================================

export interface PhalaConfig {
  endpoint: string;
  apiKey?: string;
  clusterId?: string;
  defaultImage?: string;
}

export interface PhalaCVMSpec {
  /** CPU cores (1-64) */
  cpuCores: number;
  /** Memory in GB (1-128) */
  memoryGb: number;
  /** Disk size in GB (10-1000) */
  diskGb: number;
  /** Requires GPU */
  requireGpu: boolean;
  /** GPU type if required */
  gpuType?: 'A100' | 'H100';
  /** GPU count (0-8) */
  gpuCount?: number;
}

export interface PhalaCVMStatus {
  cvmId: string;
  status: 'creating' | 'running' | 'stopped' | 'failed';
  endpoint?: string;
  sshHost?: string;
  sshPort?: number;
  attestation?: {
    quote: Hex;
    timestamp: number;
  };
  createdAt: number;
  lastHealthCheck?: number;
}

// ============================================================================
// Phala Provider Implementation
// ============================================================================

export class PhalaProvider implements TEEProvider {
  private config: PhalaConfig;
  private cvms: Map<string, PhalaCVMStatus> = new Map();
  private available = false;

  constructor(config: PhalaConfig) {
    this.config = config;
    this.checkAvailability();
  }

  private async checkAvailability(): Promise<void> {
    try {
      const response = await fetch(`${this.config.endpoint}/api/v1/health`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      this.available = response.ok;
    } catch {
      this.available = false;
    }
  }

  getProviderType(): TEEProviderType {
    return TEEProviderType.PHALA;
  }

  isAvailable(): boolean {
    return this.available;
  }

  getName(): string {
    return 'Phala Cloud';
  }

  async provision(config: TEEDeploymentConfig): Promise<TEENode> {
    const cvmSpec = this.configToSpec(config);

    const response = await fetch(`${this.config.endpoint}/api/v1/cvms`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        clusterId: this.config.clusterId,
        spec: cvmSpec,
        dockerImage: config.dockerImage ?? this.config.defaultImage,
        env: config.env,
        healthCheck: config.healthCheck,
      }),
    });

    if (!response.ok) {
      throw new Error(`Phala CVM creation failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      cvmId: string;
      endpoint: string;
      sshHost: string;
      sshPort: number;
    };

    const status: PhalaCVMStatus = {
      cvmId: data.cvmId,
      status: 'creating',
      endpoint: data.endpoint,
      sshHost: data.sshHost,
      sshPort: data.sshPort,
      createdAt: Date.now(),
    };

    this.cvms.set(data.cvmId, status);

    return this.statusToNode(status, cvmSpec);
  }

  async getEndpoint(request: TEEProvisionRequest): Promise<TEEProvisionResult> {
    // Check for existing warm node
    for (const status of this.cvms.values()) {
      if (status.status === 'running' && status.endpoint) {
        const node = await this.getNode(status.cvmId);
        if (node && this.nodeMatchesRequest(node, request)) {
          return {
            node,
            endpoint: status.endpoint,
            coldStart: false,
            estimatedColdStartMs: null,
          };
        }
      }
    }

    // Provision new CVM
    const deployConfig: TEEDeploymentConfig = request.deployment ?? {
      dockerImage: this.config.defaultImage ?? 'ghcr.io/jeju-ai/generic-server:latest',
      memoryGb: 4,
      cpuCores: 2,
    };

    const node = await this.provision(deployConfig);

    return {
      node,
      endpoint: node.endpoint,
      coldStart: true,
      estimatedColdStartMs: 30000, // ~30s cold start for Phala CVM
    };
  }

  async deprovision(nodeId: string): Promise<void> {
    await fetch(`${this.config.endpoint}/api/v1/cvms/${nodeId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    this.cvms.delete(nodeId);
  }

  async getNode(nodeId: string): Promise<TEENode | null> {
    const local = this.cvms.get(nodeId);
    if (local) {
      const response = await fetch(`${this.config.endpoint}/api/v1/cvms/${nodeId}`, {
        headers: this.getHeaders(),
      }).catch(() => null);

      if (response?.ok) {
        const data = (await response.json()) as PhalaCVMStatus;
        this.cvms.set(nodeId, data);
        return this.statusToNode(data, { cpuCores: 2, memoryGb: 4, diskGb: 20, requireGpu: false });
      }
    }

    return null;
  }

  async listNodes(): Promise<TEENode[]> {
    const response = await fetch(`${this.config.endpoint}/api/v1/cvms`, {
      headers: this.getHeaders(),
    }).catch(() => null);

    if (!response?.ok) {
      return Array.from(this.cvms.values()).map((s) =>
        this.statusToNode(s, { cpuCores: 2, memoryGb: 4, diskGb: 20, requireGpu: false })
      );
    }

    const data = (await response.json()) as { cvms: PhalaCVMStatus[] };

    for (const cvm of data.cvms) {
      this.cvms.set(cvm.cvmId, cvm);
    }

    return data.cvms.map((s) =>
      this.statusToNode(s, { cpuCores: 2, memoryGb: 4, diskGb: 20, requireGpu: false })
    );
  }

  getCapabilities(): {
    supportsDocker: boolean;
    supportsScripts: boolean;
    supportsGit: boolean;
    supportsGPU: boolean;
    availableGPUTypes: string[];
    minMemoryGb: number;
    maxMemoryGb: number;
    isSecure: boolean;
  } {
    return {
      supportsDocker: true,
      supportsScripts: true,
      supportsGit: true,
      supportsGPU: true,
      availableGPUTypes: ['A100', 'H100'],
      minMemoryGb: 1,
      maxMemoryGb: 128,
      isSecure: true,
    };
  }

  getPricing(): {
    basePricePerHour: bigint;
    pricePerGpuHour?: bigint;
    pricePerMemoryGbHour?: bigint;
    coldStartFee?: bigint;
    currency: string;
  } {
    return {
      basePricePerHour: 10000000000000000n, // 0.01 ETH
      pricePerGpuHour: 500000000000000000n, // 0.5 ETH for GPU
      pricePerMemoryGbHour: 1000000000000000n, // 0.001 ETH per GB
      coldStartFee: 5000000000000000n, // 0.005 ETH
      currency: 'ETH',
    };
  }

  // ============================================================================
  // Backend Serving Helpers
  // ============================================================================

  /**
   * Provision a lightweight CVM for backend serving (no GPU)
   * Ideal for game servers, APIs, static sites
   */
  async provisionBackend(config: {
    dockerImage: string;
    memoryGb?: number;
    cpuCores?: number;
    env?: Record<string, string>;
    healthCheck?: { path: string; interval: number; timeout: number };
  }): Promise<TEENode> {
    return this.provision({
      dockerImage: config.dockerImage,
      memoryGb: config.memoryGb ?? 2,
      cpuCores: config.cpuCores ?? 1,
      env: config.env,
      healthCheck: config.healthCheck ?? PhalaProvider.DEFAULT_HEALTH_CHECK,
    });
  }

  /** Default health check configuration */
  private static readonly DEFAULT_HEALTH_CHECK = { path: '/health', interval: 30, timeout: 10 };

  /**
   * Provision a game server with configurable image
   */
  async provisionGameServer(config: {
    dockerImage: string;
    memoryGb?: number;
    cpuCores?: number;
    env?: Record<string, string>;
    healthCheck?: { path: string; interval: number; timeout: number };
  }): Promise<TEENode> {
    return this.provisionBackend({
      dockerImage: config.dockerImage,
      memoryGb: config.memoryGb ?? 4,
      cpuCores: config.cpuCores ?? 2,
      env: { NODE_ENV: 'production', ...config.env },
      healthCheck: config.healthCheck ?? PhalaProvider.DEFAULT_HEALTH_CHECK,
    });
  }

  /**
   * Provision for static frontend serving
   */
  async provisionStaticServer(config: {
    ipfsCid: string;
    dockerImage?: string;
    env?: Record<string, string>;
  }): Promise<TEENode> {
    return this.provisionBackend({
      dockerImage: config.dockerImage ?? 'ghcr.io/jeju-ai/static-server:latest',
      memoryGb: 1,
      cpuCores: 1,
      env: { IPFS_CID: config.ipfsCid, ...config.env },
    });
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }

  private configToSpec(config: TEEDeploymentConfig): PhalaCVMSpec {
    return {
      cpuCores: config.cpuCores ?? 2,
      memoryGb: config.memoryGb ?? 4,
      diskGb: 20,
      requireGpu: config.gpuRequired ?? false,
      gpuType: config.gpuType as 'A100' | 'H100' | undefined,
      gpuCount: config.gpuRequired ? 1 : 0,
    };
  }

  private statusToNode(status: PhalaCVMStatus, spec: PhalaCVMSpec): TEENode {
    const hardware: TEEHardwareInfo = {
      providerType: TEEProviderType.PHALA,
      hardwareType: TEEHardwareType.INTEL_TDX,
      isSecure: true,
      gpuType: spec.gpuType ?? null,
      gpuVram: spec.gpuType === 'H100' ? 80 : spec.gpuType === 'A100' ? 80 : null,
      cpuCores: spec.cpuCores,
      memory: spec.memoryGb * 1024, // Convert to MB
      attestationHash: status.attestation?.quote ?? null,
    };

    return {
      id: status.cvmId,
      providerType: TEEProviderType.PHALA,
      endpoint: status.endpoint ?? '',
      status: this.mapStatus(status.status),
      warmth: status.status === 'running' ? 'hot' : 'cold',
      walletAddress: null,
      agentId: null,
      hardware,
      models: [],
      supportsDocker: true,
      supportsScripts: true,
      lastHealthCheck: status.lastHealthCheck ?? 0,
      lastActivity: Date.now(),
      startedAt: status.createdAt,
      coldStartTime: null,
      totalRequests: 0,
      averageLatency: null,
      errorCount: 0,
    };
  }

  private mapStatus(status: PhalaCVMStatus['status']): TEENode['status'] {
    switch (status) {
      case 'creating':
        return 'starting';
      case 'running':
        return 'hot';
      case 'stopped':
        return 'stopped';
      case 'failed':
        return 'error';
      default:
        return 'cold';
    }
  }

  private nodeMatchesRequest(node: TEENode, request: TEEProvisionRequest): boolean {
    if (request.requireSecure && !node.hardware.isSecure) {
      return false;
    }
    if (request.deployment?.gpuRequired && !node.hardware.gpuType) {
      return false;
    }
    return true;
  }
}

// ============================================================================
// Factory
// ============================================================================

let phalaProvider: PhalaProvider | null = null;

export function getPhalaProvider(config?: Partial<PhalaConfig>): PhalaProvider {
  if (!phalaProvider) {
    phalaProvider = new PhalaProvider({
      endpoint: config?.endpoint ?? process.env.PHALA_ENDPOINT ?? 'https://cloud-api.phala.network',
      apiKey: config?.apiKey ?? process.env.PHALA_API_KEY,
      clusterId: config?.clusterId ?? process.env.PHALA_CLUSTER_ID,
      defaultImage: config?.defaultImage ?? process.env.PHALA_DEFAULT_IMAGE ?? 'ghcr.io/jeju-ai/generic-server:latest',
    });
  }
  return phalaProvider;
}

/**
 * Provision a game backend server on Phala CVM
 * @param gameConfig Game-specific configuration including docker image
 */
export async function provisionGameBackend(gameConfig: {
  dockerImage: string;
  memoryGb?: number;
  cpuCores?: number;
  env?: Record<string, string>;
  healthCheck?: { path: string; interval: number; timeout: number };
}): Promise<TEENode> {
  const provider = getPhalaProvider();
  return provider.provisionGameServer(gameConfig);
}
