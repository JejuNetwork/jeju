/**
 * DWS (Decentralized Web Services) Client
 * 
 * Fully decentralized integration with DWS:
 * - Node discovery via ERC-8004 IdentityRegistry
 * - Automatic failover to healthy nodes
 * - Wallet-authenticated requests
 * - Content-addressed storage
 * - CDN deployment for frontend
 */

import { createPublicClient, http, type Address } from 'viem';
import type { Account } from 'viem/accounts';
import type { Model, Repository as BaseRepository, Package as BasePackage, ContainerImage as BaseContainerImage } from '@/types';

const DWS_TAG = 'dws';
const FALLBACK_DWS_URL = process.env.NEXT_PUBLIC_DWS_URL || 'http://localhost:4030';

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'getAgentsByTag',
    type: 'function',
    inputs: [{ name: 'tag', type: 'string' }],
    outputs: [{ name: 'agentIds', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getA2AEndpoint',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'endpoint', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'getAgent',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'tier', type: 'uint8' },
          { name: 'stakedToken', type: 'address' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastActivityAt', type: 'uint256' },
          { name: 'isBanned', type: 'bool' },
          { name: 'isSlashed', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

export interface DWSNode {
  agentId: bigint;
  endpoint: string;
  stake: bigint;
  isBanned: boolean;
  latency?: number;
  capabilities: string[];
}

export type Repository = BaseRepository;

export type Package = BasePackage;

export interface DWSContainerImage extends Omit<BaseContainerImage, 'id' | 'downloads'> {
  architecture: string;
  os: string;
  pushedAt: number;
  manifestUri: string;
}

export interface ComputeJob {
  id: string;
  type: 'training' | 'inference' | 'build';
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: Record<string, string>;
  output?: Record<string, string>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  cost?: bigint;
}

export interface InferenceResult {
  jobId: string;
  result?: Record<string, string>;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface DWSHealth {
  status: 'ok' | 'degraded' | 'error';
  decentralized: {
    registeredNodes: number;
    connectedPeers: number;
    frontendCid: string | null;
  };
  services: {
    git: boolean;
    pkg: boolean;
    container: boolean;
    compute: boolean;
    ipfs: boolean;
    cdn: boolean;
    ci: boolean;
  };
}

export interface CDNDeployResult {
  siteId: string;
  domain: string;
  cdnUrl: string;
  contentHash: string;
  filesUploaded: number;
  totalBytes: number;
}

export interface CIWorkflow {
  id: string;
  name: string;
  repoId: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  steps: {
    name: string;
    status: string;
    duration?: number;
  }[];
  triggeredAt: number;
  completedAt?: number;
}

// ============================================================================
// Decentralized DWS Client
// ============================================================================

class DecentralizedDWSClient {
  private publicClient: ReturnType<typeof createPublicClient> | null = null;
  private registryAddress: Address | null = null;
  private nodes: Map<string, DWSNode> = new Map();
  private lastNodeRefresh = 0;
  private nodeRefreshInterval = 60000; // 1 minute
  private account: Account | null = null;
  private initialized = false;

  /**
   * Initialize the decentralized client with blockchain connection
   */
  async initialize(config?: {
    rpcUrl?: string;
    identityRegistryAddress?: Address;
    account?: Account;
  }): Promise<void> {
    const rpcUrl = config?.rpcUrl || process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:6546';
    this.registryAddress = (config?.identityRegistryAddress || 
      process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS || 
      '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9') as Address;
    this.account = config?.account || null;

    this.publicClient = createPublicClient({
      transport: http(rpcUrl),
    });

    // Initial node discovery
    await this.discoverNodes();
    this.initialized = true;
  }

  /**
   * Discover DWS nodes from the on-chain registry
   */
  async discoverNodes(): Promise<void> {
    if (!this.publicClient || !this.registryAddress) {
      return;
    }

    const agentIds = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: [DWS_TAG],
    }).catch(() => [] as bigint[]);

    this.nodes.clear();

    for (const agentId of agentIds) {
      const [agent, endpoint] = await Promise.all([
        this.publicClient.readContract({
          address: this.registryAddress,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getAgent',
          args: [agentId],
        }).catch(() => null),
        this.publicClient.readContract({
          address: this.registryAddress,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getA2AEndpoint',
          args: [agentId],
        }).catch(() => ''),
      ]) as [{ agentId: bigint; stakedAmount: bigint; isBanned: boolean } | null, string];

      if (agent && endpoint && !agent.isBanned) {
        // Ping to check latency
        const start = Date.now();
        const healthy = await this.pingNode(endpoint);
        
        if (healthy) {
          this.nodes.set(agentId.toString(), {
            agentId,
            endpoint,
            stake: agent.stakedAmount,
            isBanned: agent.isBanned,
            latency: Date.now() - start,
            capabilities: [DWS_TAG], // Could expand to check specific capabilities
          });
        }
      }
    }

    this.lastNodeRefresh = Date.now();
  }

  private async pingNode(endpoint: string): Promise<boolean> {
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    return response?.ok ?? false;
  }

  /**
   * Get the best (lowest latency, highest stake) DWS node
   */
  async getBestNode(): Promise<string> {
    // Refresh nodes if stale
    if (Date.now() - this.lastNodeRefresh > this.nodeRefreshInterval) {
      await this.discoverNodes();
    }

    if (this.nodes.size === 0) {
      return FALLBACK_DWS_URL;
    }

    // Sort by latency, then by stake (higher stake = more trustworthy)
    const sorted = Array.from(this.nodes.values())
      .sort((a, b) => {
        const latencyDiff = (a.latency ?? Infinity) - (b.latency ?? Infinity);
        if (Math.abs(latencyDiff) < 50) {
          // Similar latency, prefer higher stake
          return Number(b.stake - a.stake);
        }
        return latencyDiff;
      });

    return sorted[0]?.endpoint ?? FALLBACK_DWS_URL;
  }

  /**
   * Generate wallet-authenticated headers for DWS requests
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const account = this.account;
    if (!account || !account.signMessage) {
      return {};
    }

    const timestamp = Date.now().toString();
    const nonce = Math.random().toString(36).slice(2);
    
    // Sign the auth message
    const message = `DWS Auth\nTimestamp: ${timestamp}\nNonce: ${nonce}`;
    
    // Use account's signMessage method directly
    const signature = await account.signMessage({ message });

    return {
      'x-jeju-address': account.address,
      'x-jeju-timestamp': timestamp,
      'x-jeju-nonce': nonce,
      'x-jeju-signature': signature,
    };
  }

  /**
   * Make an authenticated request to DWS with automatic failover
   */
  private async request<T>(
    path: string, 
    options: RequestInit = {},
    requireAuth = false
  ): Promise<T> {
    const baseUrl = await this.getBestNode();
    const url = `${baseUrl}${path}`;
    
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };

    if (requireAuth) {
      Object.assign(headers, await this.getAuthHeaders());
    }

    // First attempt
    let response = await fetch(url, { ...options, headers }).catch(() => null);
    
    // Failover to another node if failed
    if (!response?.ok && this.nodes.size > 1) {
      // Mark current node as bad and try another
      const nodes = Array.from(this.nodes.values());
      for (const node of nodes) {
        if (node.endpoint === baseUrl) continue;
        
        const failoverUrl = `${node.endpoint}${path}`;
        response = await fetch(failoverUrl, { ...options, headers }).catch(() => null);
        
        if (response?.ok) {
          break;
        }
      }
    }

    if (!response?.ok) {
      throw new Error(`DWS request failed: ${path}`);
    }

    return response.json();
  }

  // ===========================================================================
  // Health Check
  // ===========================================================================

  async healthCheck(): Promise<DWSHealth> {
    const baseUrl = await this.getBestNode();
    const response = await fetch(`${baseUrl}/health`).catch(() => null);
    
    if (!response?.ok) {
      return {
        status: 'error',
        decentralized: {
          registeredNodes: this.nodes.size,
          connectedPeers: 0,
          frontendCid: null,
        },
        services: {
          git: false,
          pkg: false,
          container: false,
          compute: false,
          ipfs: false,
          cdn: false,
          ci: false,
        },
      };
    }

    const health = await response.json() as DWSHealth;
    return {
      ...health,
      decentralized: {
        ...health.decentralized,
        registeredNodes: this.nodes.size,
      },
    };
  }

  // ===========================================================================
  // Git Operations
  // ===========================================================================

  async listRepositories(owner?: string): Promise<Repository[]> {
    const params = owner ? `?owner=${owner}` : '';
    return this.request<Repository[]>(`/git/repos${params}`);
  }

  async getRepository(owner: string, name: string): Promise<Repository> {
    return this.request<Repository>(`/git/repos/${owner}/${name}`);
  }

  async createRepository(params: {
    name: string;
    description?: string;
    isPrivate?: boolean;
  }): Promise<Repository> {
    return this.request<Repository>('/git/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }, true);
  }

  async getRepoFiles(owner: string, name: string, path = '', ref = 'main'): Promise<{
    path: string;
    type: 'file' | 'dir';
    size?: number;
    sha: string;
  }[]> {
    return this.request(`/git/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${ref}`);
  }

  async getFileContent(owner: string, name: string, path: string, ref = 'main'): Promise<string> {
    const baseUrl = await this.getBestNode();
    const response = await fetch(
      `${baseUrl}/git/repos/${owner}/${name}/raw/${encodeURIComponent(path)}?ref=${ref}`
    );
    if (!response.ok) throw new Error('Failed to fetch file content');
    return response.text();
  }

  async cloneFromGitHub(githubUrl: string, params: {
    name?: string;
    isPrivate?: boolean;
  }): Promise<Repository> {
    return this.request<Repository>('/git/repos/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'github',
        sourceUrl: githubUrl,
        ...params,
      }),
    }, true);
  }

  // ===========================================================================
  // Package Operations
  // ===========================================================================

  async searchPackages(query: string): Promise<Package[]> {
    return this.request<Package[]>(`/pkg/search?q=${encodeURIComponent(query)}`);
  }

  async getPackage(name: string, version?: string): Promise<Package> {
    const versionPart = version ? `/${version}` : '';
    return this.request<Package>(`/pkg/${encodeURIComponent(name)}${versionPart}`);
  }

  async publishPackage(tarball: Blob, metadata: {
    name: string;
    version: string;
    description?: string;
  }): Promise<Package> {
    const baseUrl = await this.getBestNode();
    const formData = new FormData();
    formData.append('tarball', tarball);
    formData.append('metadata', JSON.stringify(metadata));
    
    const headers = await this.getAuthHeaders();
    
    const response = await fetch(`${baseUrl}/pkg`, {
      method: 'POST',
      headers,
      body: formData,
    });
    
    if (!response.ok) throw new Error('Failed to publish package');
    return response.json();
  }

  async mirrorFromNpm(packageName: string, version?: string): Promise<Package> {
    return this.request<Package>('/pkg/mirror', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'npm', packageName, version }),
    }, true);
  }

  // ===========================================================================
  // Container Operations
  // ===========================================================================

  async listImages(repository?: string): Promise<DWSContainerImage[]> {
    const params = repository ? `?repository=${repository}` : '';
    return this.request<DWSContainerImage[]>(`/containers/images${params}`);
  }

  async getImageManifest(name: string, tag: string): Promise<{
    schemaVersion: number;
    mediaType: string;
    config: { digest: string };
    layers: { digest: string; size: number }[];
  }> {
    return this.request(`/containers/${name}/manifests/${tag}`);
  }

  async pushImage(name: string, tag: string, layers: Blob[]): Promise<DWSContainerImage> {
    const baseUrl = await this.getBestNode();
    const formData = new FormData();
    layers.forEach((layer, i) => formData.append(`layer_${i}`, layer));
    formData.append('name', name);
    formData.append('tag', tag);

    const headers = await this.getAuthHeaders();
    
    const response = await fetch(`${baseUrl}/containers/push`, {
      method: 'POST',
      headers,
      body: formData,
    });
    
    if (!response.ok) throw new Error('Failed to push image');
    return response.json();
  }

  // ===========================================================================
  // Compute Operations
  // ===========================================================================

  async createTrainingJob(params: {
    modelName: string;
    baseModel?: string;
    datasetUri: string;
    config: Record<string, unknown>;
    paymentToken?: string;
    paymentAmount?: string;
  }): Promise<ComputeJob> {
    return this.request<ComputeJob>('/compute/training', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }, true);
  }

  async createInferenceJob(params: {
    modelId: string;
    input: Record<string, unknown>;
    paymentToken?: string;
    paymentAmount?: string;
  }): Promise<ComputeJob> {
    return this.request<ComputeJob>('/compute/inference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }, true);
  }

  async getJob(jobId: string): Promise<ComputeJob> {
    return this.request<ComputeJob>(`/compute/jobs/${jobId}`);
  }

  async listJobs(status?: string): Promise<ComputeJob[]> {
    const params = status ? `?status=${status}` : '';
    return this.request<ComputeJob[]>(`/compute/jobs${params}`);
  }

  // ===========================================================================
  // Model Hub Operations
  // ===========================================================================

  async listModels(params?: {
    type?: string;
    organization?: string;
    search?: string;
  }): Promise<Model[]> {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set('type', params.type);
    if (params?.organization) searchParams.set('org', params.organization);
    if (params?.search) searchParams.set('q', params.search);
    
    const query = searchParams.toString();
    return this.request<Model[]>(`/models${query ? '?' + query : ''}`);
  }

  async getModel(organization: string, name: string): Promise<Model> {
    return this.request<Model>(`/models/${organization}/${name}`);
  }

  async uploadModel(params: {
    name: string;
    organization: string;
    description: string;
    type: string;
    file: Blob;
    config?: Blob;
  }): Promise<Model> {
    const baseUrl = await this.getBestNode();
    const formData = new FormData();
    formData.append('name', params.name);
    formData.append('organization', params.organization);
    formData.append('description', params.description);
    formData.append('type', params.type);
    formData.append('model', params.file);
    if (params.config) {
      formData.append('config', params.config);
    }
    
    const headers = await this.getAuthHeaders();
    
    const response = await fetch(`${baseUrl}/models`, {
      method: 'POST',
      headers,
      body: formData,
    });
    
    if (!response.ok) throw new Error('Failed to upload model');
    return response.json();
  }

  async runInference(modelId: string, input: Record<string, unknown>): Promise<InferenceResult> {
    return this.request<InferenceResult>(`/models/${modelId}/inference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    }, true);
  }

  // ===========================================================================
  // Storage Operations (IPFS)
  // ===========================================================================

  async uploadToIpfs(file: Blob | string, filename?: string): Promise<string> {
    const baseUrl = await this.getBestNode();
    const formData = new FormData();
    
    if (typeof file === 'string') {
      formData.append('file', new Blob([file], { type: 'text/plain' }), filename || 'file.txt');
    } else {
      formData.append('file', file, filename);
    }

    const headers = await this.getAuthHeaders();
    
    const response = await fetch(`${baseUrl}/storage/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });
    
    if (!response.ok) throw new Error('Failed to upload to IPFS');
    const data = await response.json() as { cid: string };
    return data.cid;
  }

  async downloadFromIpfs(cid: string): Promise<Blob> {
    const baseUrl = await this.getBestNode();
    const response = await fetch(`${baseUrl}/storage/download/${cid}`);
    if (!response.ok) throw new Error('Failed to download from IPFS');
    return response.blob();
  }

  async uploadPermanent(file: Blob | string, filename?: string): Promise<{
    cid: string;
    arweaveId?: string;
  }> {
    const baseUrl = await this.getBestNode();
    const formData = new FormData();
    
    if (typeof file === 'string') {
      formData.append('file', new Blob([file], { type: 'text/plain' }), filename || 'file.txt');
    } else {
      formData.append('file', file, filename);
    }
    formData.append('permanent', 'true');

    const headers = await this.getAuthHeaders();
    
    const response = await fetch(`${baseUrl}/storage/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });
    
    if (!response.ok) throw new Error('Failed to upload permanently');
    return response.json();
  }

  // ===========================================================================
  // CDN Operations
  // ===========================================================================

  async deployCDN(params: {
    domain: string;
    buildDir: string;
    jnsName?: string;
    framework?: 'next' | 'vite' | 'astro' | 'static';
  }): Promise<CDNDeployResult> {
    const baseUrl = await this.getBestNode();
    const headers = await this.getAuthHeaders();
    
    const response = await fetch(`${baseUrl}/cdn/deploy`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    
    if (!response.ok) throw new Error('Failed to deploy to CDN');
    return response.json();
  }

  async invalidateCDN(siteId: string, paths: string[]): Promise<void> {
    const baseUrl = await this.getBestNode();
    const headers = await this.getAuthHeaders();
    
    const response = await fetch(`${baseUrl}/cdn/invalidate`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId, paths }),
    });
    
    if (!response.ok) throw new Error('Failed to invalidate CDN cache');
  }

  async resolveJNS(name: string): Promise<{ name: string; contentHash: string | null }> {
    return this.request(`/cdn/resolve/${name}`);
  }

  // ===========================================================================
  // CI/CD Operations
  // ===========================================================================

  async triggerWorkflow(params: {
    repoId: string;
    workflowName: string;
    ref?: string;
    inputs?: Record<string, string>;
  }): Promise<CIWorkflow> {
    return this.request<CIWorkflow>('/ci/workflows/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }, true);
  }

  async getWorkflow(workflowId: string): Promise<CIWorkflow> {
    return this.request<CIWorkflow>(`/ci/workflows/${workflowId}`);
  }

  async listWorkflows(repoId?: string): Promise<CIWorkflow[]> {
    const params = repoId ? `?repoId=${repoId}` : '';
    return this.request<CIWorkflow[]>(`/ci/workflows${params}`);
  }

  async getWorkflowLogs(workflowId: string): Promise<string> {
    const baseUrl = await this.getBestNode();
    const response = await fetch(`${baseUrl}/ci/workflows/${workflowId}/logs`);
    if (!response.ok) throw new Error('Failed to fetch workflow logs');
    return response.text();
  }

  // ===========================================================================
  // Node Information
  // ===========================================================================

  getConnectedNodes(): DWSNode[] {
    return Array.from(this.nodes.values());
  }

  getNodeCount(): number {
    return this.nodes.size;
  }

  async refreshNodes(): Promise<void> {
    await this.discoverNodes();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  setAccount(account: Account): void {
    this.account = account;
  }
}

// ============================================================================
// Export singleton instance
// ============================================================================

export const dwsClient = new DecentralizedDWSClient();

