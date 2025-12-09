/**
 * Phala Gateway - Manages TEE compute node provisioning and routing
 * 
 * Features:
 * - Node discovery and health monitoring
 * - Cold start management with warmth tracking
 * - ERC-8004 agent integration for identity
 * - Load balancing and failover
 * - Container/script deployment
 */

import { Hono } from 'hono';
import type { Hex } from 'viem';
// Node warmth thresholds (milliseconds)
const COLD_THRESHOLD = 60_000; // 60s without inference = cold
const WARM_THRESHOLD = 10_000; // 10s without inference = warm
// Below 10s = hot

export interface PhalaNode {
  id: string;
  endpoint: string;
  agentId: bigint | null;
  walletAddress: Hex;
  
  // State
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
  warmth: 'cold' | 'warm' | 'hot';
  
  // Timing
  lastHealthCheck: number;
  lastInference: number | null;
  coldStartTime: number | null;
  
  // Capabilities
  models: string[];
  hardware: {
    gpuType: string | null;
    gpuVram: number | null;
    teeType: 'intel-tdx' | 'amd-sev' | 'simulated';
  };
  
  // Metrics
  totalInferences: number;
  averageLatency: number | null;
  errorCount: number;
}

export interface DeploymentConfig {
  // Container-based deployment
  dockerImage?: string;
  dockerArgs?: string[];
  
  // Script-based deployment
  startupScript?: string;
  
  // Git-based deployment  
  gitRepo?: string;
  gitBranch?: string;
  
  // Environment
  env?: Record<string, string>;
  
  // Resource limits
  maxMemoryMb?: number;
  maxCpus?: number;
  gpuRequired?: boolean;
}

export interface ProvisionRequest {
  model: string;
  preferWarm?: boolean;
  maxColdStartMs?: number;
  deployment?: DeploymentConfig;
}

export interface GatewayConfig {
  rpcUrl: string;
  registryAddress: Hex;
  agentRegistryAddress: Hex;
  healthCheckIntervalMs?: number;
  maxNodes?: number;
}

/**
 * Phala Gateway for managing TEE compute nodes
 */
export class PhalaGateway {
  private nodes: Map<string, PhalaNode> = new Map();
  private config: GatewayConfig;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  // Reserved for future ERC-8004 integration
  // private publicClient;
  
  constructor(config: GatewayConfig) {
    this.config = {
      healthCheckIntervalMs: 30_000,
      maxNodes: 100,
      ...config,
    };
    
    // ERC-8004 integration will use publicClient
    // const chain = config.rpcUrl.includes('sepolia') ? sepolia : mainnet;
    // createPublicClient({ chain, transport: http(config.rpcUrl) });
  }
  
  /**
   * Start the gateway and begin health checks
   */
  start(): void {
    this.healthCheckInterval = setInterval(
      () => this.runHealthChecks(),
      this.config.healthCheckIntervalMs!
    );
    console.log('[PhalaGateway] Started');
  }
  
  /**
   * Stop the gateway
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    console.log('[PhalaGateway] Stopped');
  }
  
  /**
   * Register a node with the gateway
   */
  registerNode(node: Omit<PhalaNode, 'warmth' | 'lastHealthCheck' | 'totalInferences' | 'averageLatency' | 'errorCount'>): void {
    const fullNode: PhalaNode = {
      ...node,
      warmth: 'cold',
      lastHealthCheck: Date.now(),
      totalInferences: 0,
      averageLatency: null,
      errorCount: 0,
    };
    
    this.nodes.set(node.id, fullNode);
    console.log(`[PhalaGateway] Registered node: ${node.id}`);
  }
  
  /**
   * Deregister a node
   */
  deregisterNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    console.log(`[PhalaGateway] Deregistered node: ${nodeId}`);
  }
  
  /**
   * Get all registered nodes
   */
  getNodes(): PhalaNode[] {
    return Array.from(this.nodes.values());
  }
  
  /**
   * Get a specific node
   */
  getNode(nodeId: string): PhalaNode | null {
    return this.nodes.get(nodeId) ?? null;
  }
  
  /**
   * Find best node for a request
   */
  findBestNode(request: ProvisionRequest): PhalaNode | null {
    const candidates = Array.from(this.nodes.values())
      .filter(n => n.status === 'running')
      .filter(n => n.models.includes(request.model));
    
    if (candidates.length === 0) return null;
    
    // Prefer warm/hot nodes if specified
    if (request.preferWarm) {
      const warm = candidates.filter(n => n.warmth !== 'cold');
      if (warm.length > 0) {
        // Sort by warmth (hot > warm) then by lowest latency
        return warm.sort((a, b) => {
          if (a.warmth === 'hot' && b.warmth !== 'hot') return -1;
          if (b.warmth === 'hot' && a.warmth !== 'hot') return 1;
          return (a.averageLatency ?? Infinity) - (b.averageLatency ?? Infinity);
        })[0]!;
      }
    }
    
    // Filter by cold start time if specified
    if (request.maxColdStartMs) {
      const fast = candidates.filter(
        n => n.coldStartTime === null || n.coldStartTime <= request.maxColdStartMs!
      );
      if (fast.length > 0) {
        return fast[0]!;
      }
    }
    
    // Return node with lowest latency
    return candidates.sort(
      (a, b) => (a.averageLatency ?? Infinity) - (b.averageLatency ?? Infinity)
    )[0]!;
  }
  
  /**
   * Provision a new node with the specified deployment config
   */
  async provisionNode(deployment: DeploymentConfig): Promise<PhalaNode> {
    const nodeId = `phala-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    console.log(`[PhalaGateway] Provisioning node: ${nodeId}`);
    
    // Create placeholder node
    const node: PhalaNode = {
      id: nodeId,
      endpoint: '', // Will be set after startup
      agentId: null,
      walletAddress: '0x0' as Hex,
      status: 'starting',
      warmth: 'cold',
      lastHealthCheck: Date.now(),
      lastInference: null,
      coldStartTime: null,
      models: [],
      hardware: {
        gpuType: null,
        gpuVram: null,
        teeType: 'simulated',
      },
      totalInferences: 0,
      averageLatency: null,
      errorCount: 0,
    };
    
    this.nodes.set(nodeId, node);
    
    // Determine deployment method
    if (deployment.dockerImage) {
      await this.deployDocker(node, deployment);
    } else if (deployment.gitRepo) {
      await this.deployFromGit(node, deployment);
    } else if (deployment.startupScript) {
      await this.deployScript(node, deployment);
    } else {
      throw new Error('No deployment method specified');
    }
    
    return node;
  }
  
  /**
   * Deploy using Docker
   */
  private async deployDocker(node: PhalaNode, config: DeploymentConfig): Promise<void> {
    const { spawn } = await import('node:child_process');
    
    const args = [
      'run', '-d',
      '--name', node.id,
    ];
    
    // Add env vars
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }
    
    // Add resource limits
    if (config.maxMemoryMb) {
      args.push('--memory', `${config.maxMemoryMb}m`);
    }
    if (config.maxCpus) {
      args.push('--cpus', String(config.maxCpus));
    }
    if (config.gpuRequired) {
      args.push('--gpus', 'all');
    }
    
    // Add custom args
    if (config.dockerArgs) {
      args.push(...config.dockerArgs);
    }
    
    args.push(config.dockerImage!);
    
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', args);
      
      proc.on('close', (code) => {
        if (code === 0) {
          node.status = 'running';
          resolve();
        } else {
          node.status = 'error';
          reject(new Error(`Docker deploy failed with code ${code}`));
        }
      });
      
      proc.on('error', (err) => {
        node.status = 'error';
        reject(err);
      });
    });
  }
  
  /**
   * Deploy from Git repository
   */
  private async deployFromGit(node: PhalaNode, config: DeploymentConfig): Promise<void> {
    const { spawn } = await import('node:child_process');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    
    const tmpDir = await mkdtemp(join(tmpdir(), 'jeju-deploy-'));
    
    // Clone repo
    await new Promise<void>((resolve, reject) => {
      const args = ['clone', '--depth', '1'];
      if (config.gitBranch) {
        args.push('--branch', config.gitBranch);
      }
      args.push(config.gitRepo!, tmpDir);
      
      const proc = spawn('git', args);
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Git clone failed`)));
      proc.on('error', reject);
    });
    
    // Run startup script if specified, otherwise run npm start
    const startCmd = config.startupScript ?? 'npm start';
    
    await new Promise<void>((resolve) => {
      const proc = spawn('sh', ['-c', startCmd], {
        cwd: tmpDir,
        env: { ...process.env, ...config.env },
        detached: true,
      });
      
      proc.unref();
      node.status = 'running';
      resolve();
    });
  }
  
  /**
   * Deploy using a startup script
   */
  private async deployScript(node: PhalaNode, config: DeploymentConfig): Promise<void> {
    const { spawn } = await import('node:child_process');
    
    return new Promise((resolve) => {
      const proc = spawn('sh', ['-c', config.startupScript!], {
        env: { ...process.env, ...config.env },
        detached: true,
      });
      
      proc.unref();
      node.status = 'running';
      resolve();
    });
  }
  
  /**
   * Stop and remove a provisioned node
   */
  async deprovisionNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    
    node.status = 'stopping';
    
    // Try to stop Docker container if it exists
    const { spawn } = await import('node:child_process');
    await new Promise<void>((resolve) => {
      const proc = spawn('docker', ['stop', nodeId]);
      proc.on('close', () => resolve());
      proc.on('error', () => resolve());
    });
    
    await new Promise<void>((resolve) => {
      const proc = spawn('docker', ['rm', nodeId]);
      proc.on('close', () => resolve());
      proc.on('error', () => resolve());
    });
    
    node.status = 'stopped';
    this.nodes.delete(nodeId);
  }
  
  /**
   * Run health checks on all nodes
   */
  private async runHealthChecks(): Promise<void> {
    const now = Date.now();
    
    for (const node of this.nodes.values()) {
      if (node.status !== 'running') continue;
      
      // Check health endpoint
      try {
        const response = await fetch(`${node.endpoint}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        
        if (response.ok) {
          node.lastHealthCheck = now;
          
          // Update warmth based on last inference
          if (node.lastInference === null) {
            node.warmth = 'cold';
          } else {
            const timeSinceInference = now - node.lastInference;
            if (timeSinceInference < WARM_THRESHOLD) {
              node.warmth = 'hot';
            } else if (timeSinceInference < COLD_THRESHOLD) {
              node.warmth = 'warm';
            } else {
              node.warmth = 'cold';
            }
          }
        } else {
          node.errorCount++;
          if (node.errorCount > 3) {
            node.status = 'error';
          }
        }
      } catch {
        node.errorCount++;
        if (node.errorCount > 3) {
          node.status = 'error';
        }
      }
    }
  }
  
  /**
   * Record an inference request for metrics
   */
  recordInference(nodeId: string, latencyMs: number, coldStart: boolean): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    
    const now = Date.now();
    node.lastInference = now;
    node.totalInferences++;
    node.warmth = 'hot';
    node.errorCount = 0;
    
    // Update average latency
    if (node.averageLatency === null) {
      node.averageLatency = latencyMs;
    } else {
      node.averageLatency = (node.averageLatency * 0.9) + (latencyMs * 0.1);
    }
    
    // Record cold start time
    if (coldStart && (node.coldStartTime === null || latencyMs < node.coldStartTime)) {
      node.coldStartTime = latencyMs;
    }
  }
  
  /**
   * Create HTTP API router for the gateway
   */
  createRouter(): Hono {
    const app = new Hono();
    
    // List all nodes
    app.get('/nodes', (c) => {
      const nodes = this.getNodes().map(n => ({
        id: n.id,
        endpoint: n.endpoint,
        status: n.status,
        warmth: n.warmth,
        models: n.models,
        hardware: n.hardware,
        metrics: {
          totalInferences: n.totalInferences,
          averageLatency: n.averageLatency,
          coldStartTime: n.coldStartTime,
        },
      }));
      return c.json({ nodes });
    });
    
    // Get specific node
    app.get('/nodes/:id', (c) => {
      const node = this.getNode(c.req.param('id'));
      if (!node) {
        return c.json({ error: 'Node not found' }, 404);
      }
      return c.json(node);
    });
    
    // Find best node for model
    app.post('/provision', async (c) => {
      const body = await c.req.json<ProvisionRequest>();
      
      // Try to find existing node first
      let node = this.findBestNode(body);
      
      if (!node && body.deployment) {
        // Provision a new node
        node = await this.provisionNode(body.deployment);
      }
      
      if (!node) {
        return c.json({ error: 'No suitable node found and no deployment config provided' }, 404);
      }
      
      return c.json({
        nodeId: node.id,
        endpoint: node.endpoint,
        warmth: node.warmth,
        estimatedColdStartMs: node.coldStartTime,
      });
    });
    
    // Deprovision a node
    app.delete('/nodes/:id', async (c) => {
      await this.deprovisionNode(c.req.param('id'));
      return c.json({ success: true });
    });
    
    // Gateway health
    app.get('/health', (c) => {
      const running = this.getNodes().filter(n => n.status === 'running').length;
      const total = this.nodes.size;
      return c.json({
        status: 'ok',
        nodes: { running, total },
      });
    });
    
    return app;
  }
}

/**
 * Create and start a Phala gateway
 */
export function createPhalaGateway(config: GatewayConfig): PhalaGateway {
  const gateway = new PhalaGateway(config);
  gateway.start();
  return gateway;
}

