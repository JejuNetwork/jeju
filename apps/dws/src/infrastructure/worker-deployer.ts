/**
 * Decentralized Worker Deployer
 * 
 * Handles worker deployment across the decentralized network:
 * 1. User uploads code to IPFS
 * 2. User registers worker on-chain with requirements
 * 3. Qualified nodes discover worker and pull code
 * 4. Nodes start worker instances and report readiness
 * 5. Requests route to healthy instances
 * 6. Payment flows via x402 or prepaid vault
 */

import { keccak256, toHex, type Address, type Hex } from 'viem';
import type {
  WorkerConfig,
  DeployedWorker,
  WorkerInstance,
  NodeConfig,
  NetworkConfig,
  InfraEvent,
  InfraEventHandler,
} from './types';
import { DecentralizedNodeRegistry } from './node-registry';
import type { BackendManager } from '../storage/backends';
import type { WorkerdExecutor } from '../workers/workerd/executor';

// ============================================================================
// Worker Deployer
// ============================================================================

export class DecentralizedWorkerDeployer {
  private nodeRegistry: DecentralizedNodeRegistry;
  private backendManager: BackendManager;
  private workerdExecutor: WorkerdExecutor;
  private networkConfig: NetworkConfig;
  
  // Local state
  private deployedWorkers = new Map<string, DeployedWorker>();
  private eventHandlers: InfraEventHandler[] = [];
  
  // This node's ID (if registered)
  private selfAgentId: bigint | null = null;
  private selfEndpoint: string | null = null;

  constructor(
    nodeRegistry: DecentralizedNodeRegistry,
    backendManager: BackendManager,
    workerdExecutor: WorkerdExecutor,
    networkConfig: NetworkConfig
  ) {
    this.nodeRegistry = nodeRegistry;
    this.backendManager = backendManager;
    this.workerdExecutor = workerdExecutor;
    this.networkConfig = networkConfig;
  }

  /**
   * Set this node's identity (call after registering as a node)
   */
  setSelf(agentId: bigint, endpoint: string): void {
    this.selfAgentId = agentId;
    this.selfEndpoint = endpoint;
  }

  // ============================================================================
  // Worker Deployment (Client-side)
  // ============================================================================

  /**
   * Deploy a worker to the decentralized network
   */
  async deployWorker(config: WorkerConfig): Promise<DeployedWorker> {
    console.log(`[WorkerDeployer] Deploying worker: ${config.name}`);

    // 1. Upload code to IPFS if not already
    let codeCid = config.code.cid;
    let codeHash = config.code.hash;

    if (!codeCid) {
      throw new Error('Code CID is required - upload code to IPFS first');
    }

    // 2. Verify code hash
    const codeContent = await this.backendManager.download(codeCid);
    const computedHash = keccak256(codeContent.content) as Hex;
    
    if (codeHash && codeHash !== computedHash) {
      throw new Error('Code hash mismatch');
    }
    codeHash = computedHash;

    // 3. Find qualified nodes
    const nodes = await this.nodeRegistry.findNodes({
      capabilities: ['compute'],
      minReputation: config.requirements.minNodeReputation,
      minStake: config.requirements.minNodeStake,
      teeRequired: config.requirements.teeRequired,
      teePlatform: config.requirements.teePlatform,
      maxPricePerRequest: config.payment.maxPricePerRequest,
      limit: 10,
    });

    if (nodes.length === 0) {
      throw new Error('No qualified nodes found');
    }

    // 4. Create deployed worker record
    const worker: DeployedWorker = {
      ...config,
      code: {
        ...config.code,
        cid: codeCid,
        hash: codeHash,
      },
      status: 'deploying',
      deployedAt: Date.now(),
      updatedAt: Date.now(),
      instances: [],
      metrics: {
        totalInvocations: 0,
        totalErrors: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        coldStarts: 0,
        totalCostWei: 0n,
      },
    };

    this.deployedWorkers.set(config.id, worker);

    // 5. Request deployment from nodes
    const deploymentPromises = nodes.slice(0, config.scaling.minInstances || 1).map(
      node => this.requestNodeDeployment(node, worker)
    );

    const results = await Promise.allSettled(deploymentPromises);
    const successfulDeployments = results.filter(r => r.status === 'fulfilled');

    if (successfulDeployments.length === 0) {
      worker.status = 'failed';
      throw new Error('Failed to deploy to any node');
    }

    worker.status = 'active';
    worker.updatedAt = Date.now();

    // Emit event
    this.emit({
      type: 'worker:deployed',
      workerId: config.id,
      owner: config.owner,
      codeCid,
    });

    return worker;
  }

  /**
   * Request a specific node to deploy a worker
   */
  private async requestNodeDeployment(
    node: NodeConfig,
    worker: DeployedWorker
  ): Promise<WorkerInstance> {
    const response = await fetch(`${node.endpoint}/workerd/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': worker.owner,
      },
      body: JSON.stringify({
        workerId: worker.id,
        name: worker.name,
        codeCid: worker.code.cid,
        codeHash: worker.code.hash,
        entrypoint: worker.code.entrypoint,
        runtime: worker.code.runtime,
        resources: worker.resources,
        env: worker.env,
        secrets: worker.secrets,
        requirements: worker.requirements,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Node ${node.agentId} deployment failed: ${error}`);
    }

    const result = await response.json() as { instanceId: string };

    const instance: WorkerInstance = {
      id: result.instanceId,
      workerId: worker.id,
      nodeAgentId: node.agentId,
      nodeEndpoint: node.endpoint,
      status: 'warm',
      startedAt: Date.now(),
      lastRequestAt: Date.now(),
      activeRequests: 0,
      totalRequests: 0,
      errors: 0,
    };

    worker.instances.push(instance);
    return instance;
  }

  /**
   * Scale a worker up or down
   */
  async scaleWorker(workerId: string, targetInstances: number): Promise<void> {
    const worker = this.deployedWorkers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }

    const currentInstances = worker.instances.filter(
      i => i.status === 'warm' || i.status === 'busy'
    ).length;

    if (targetInstances > currentInstances) {
      // Scale up
      const nodes = await this.nodeRegistry.findNodes({
        capabilities: ['compute'],
        minReputation: worker.requirements.minNodeReputation,
        minStake: worker.requirements.minNodeStake,
        teeRequired: worker.requirements.teeRequired,
        teePlatform: worker.requirements.teePlatform,
        limit: targetInstances - currentInstances,
      });

      for (const node of nodes) {
        try {
          await this.requestNodeDeployment(node, worker);
        } catch (err) {
          console.warn(`[WorkerDeployer] Failed to scale to node ${node.agentId}:`, err);
        }
      }
    } else if (targetInstances < currentInstances) {
      // Scale down
      const toStop = currentInstances - targetInstances;
      const instancesToStop = worker.instances
        .filter(i => i.status === 'warm')
        .slice(0, toStop);

      for (const instance of instancesToStop) {
        await this.stopInstance(worker, instance);
      }
    }

    this.emit({
      type: 'worker:scaled',
      workerId,
      newInstances: worker.instances.filter(i => i.status !== 'stopped').length,
    });
  }

  /**
   * Stop a worker instance
   */
  private async stopInstance(worker: DeployedWorker, instance: WorkerInstance): Promise<void> {
    try {
      await fetch(`${instance.nodeEndpoint}/workerd/${worker.id}/stop`, {
        method: 'POST',
        headers: { 'x-jeju-address': worker.owner },
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      console.warn(`[WorkerDeployer] Failed to stop instance ${instance.id}:`, err);
    }

    instance.status = 'stopped';
  }

  /**
   * Stop all instances and undeploy worker
   */
  async undeployWorker(workerId: string): Promise<void> {
    const worker = this.deployedWorkers.get(workerId);
    if (!worker) return;

    worker.status = 'draining';

    // Stop all instances
    await Promise.all(
      worker.instances.map(instance => this.stopInstance(worker, instance))
    );

    worker.status = 'stopped';
    this.emit({ type: 'worker:stopped', workerId });
  }

  // ============================================================================
  // Worker Hosting (Node-side)
  // ============================================================================

  /**
   * Handle deployment request from the network (as a node)
   */
  async handleDeploymentRequest(params: {
    workerId: string;
    name: string;
    codeCid: string;
    codeHash: Hex;
    entrypoint: string;
    runtime: 'workerd' | 'bun' | 'docker';
    resources: WorkerConfig['resources'];
    env: Record<string, string>;
    secrets: string[];
    requirements: WorkerConfig['requirements'];
    owner: Address;
  }): Promise<{ instanceId: string }> {
    console.log(`[WorkerDeployer] Handling deployment request for ${params.name}`);

    // 1. Check if we meet requirements
    if (params.requirements.teeRequired && !this.selfAgentId) {
      throw new Error('TEE required but node not registered');
    }

    // 2. Download code from IPFS
    const codeResult = await this.backendManager.download(params.codeCid);
    
    // 3. Verify hash
    const hash = keccak256(codeResult.content) as Hex;
    if (hash !== params.codeHash) {
      throw new Error('Code hash mismatch');
    }

    // 4. Deploy to workerd
    const instanceId = `${params.workerId}-${Date.now()}`;
    
    await this.workerdExecutor.deployWorker({
      id: params.workerId,
      name: params.name,
      mainModule: params.entrypoint,
      compatibilityDate: new Date().toISOString().split('T')[0],
      bindings: [
        ...Object.entries(params.env).map(([name, value]) => ({
          type: 'text' as const,
          name,
          value,
        })),
      ],
      limits: {
        cpuMs: params.resources.cpuMillis,
        memoryMb: params.resources.memoryMb,
      },
      code: codeResult.content,
    });

    console.log(`[WorkerDeployer] Deployed worker ${params.name} as ${instanceId}`);

    return { instanceId };
  }

  /**
   * Handle worker invocation request
   */
  async handleInvocation(params: {
    workerId: string;
    request: Request;
    x402Header?: string;
  }): Promise<Response> {
    // Invoke via workerd executor
    return this.workerdExecutor.invokeWorker(params.workerId, params.request);
  }

  // ============================================================================
  // Request Routing
  // ============================================================================

  /**
   * Route a request to the best available instance
   */
  async routeRequest(workerId: string, request: Request): Promise<Response> {
    const worker = this.deployedWorkers.get(workerId);
    if (!worker) {
      return new Response(JSON.stringify({ error: 'Worker not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Find healthy instances
    const healthyInstances = worker.instances.filter(
      i => i.status === 'warm' && i.activeRequests < worker.resources.maxConcurrency
    );

    if (healthyInstances.length === 0) {
      // Try to scale up
      if (worker.instances.length < worker.scaling.maxInstances) {
        try {
          await this.scaleWorker(workerId, worker.instances.length + 1);
          // Wait for instance to be ready
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (err) {
          console.warn(`[WorkerDeployer] Failed to scale up:`, err);
        }
      }

      return new Response(JSON.stringify({ error: 'No available instances' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Select instance with lowest active requests
    healthyInstances.sort((a, b) => a.activeRequests - b.activeRequests);
    const instance = healthyInstances[0];

    // Forward request
    instance.activeRequests++;
    const startTime = Date.now();

    try {
      const response = await fetch(`${instance.nodeEndpoint}/workerd/${workerId}/invoke`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(worker.resources.timeoutMs),
      });

      instance.totalRequests++;
      instance.lastRequestAt = Date.now();
      worker.metrics.totalInvocations++;
      
      const latency = Date.now() - startTime;
      worker.metrics.avgLatencyMs = 
        (worker.metrics.avgLatencyMs * 0.9) + (latency * 0.1);

      return response;
    } catch (err) {
      instance.errors++;
      worker.metrics.totalErrors++;
      
      return new Response(JSON.stringify({ 
        error: 'Request failed',
        message: err instanceof Error ? err.message : String(err),
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      instance.activeRequests--;
    }
  }

  // ============================================================================
  // Status & Metrics
  // ============================================================================

  getWorker(workerId: string): DeployedWorker | undefined {
    return this.deployedWorkers.get(workerId);
  }

  listWorkers(): DeployedWorker[] {
    return Array.from(this.deployedWorkers.values());
  }

  getWorkersByOwner(owner: Address): DeployedWorker[] {
    return Array.from(this.deployedWorkers.values())
      .filter(w => w.owner.toLowerCase() === owner.toLowerCase());
  }

  // ============================================================================
  // Events
  // ============================================================================

  onEvent(handler: InfraEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index >= 0) this.eventHandlers.splice(index, 1);
    };
  }

  private emit(event: InfraEvent): void {
    for (const handler of this.eventHandlers) {
      Promise.resolve(handler(event)).catch(console.error);
    }
  }
}

// ============================================================================
// Auto-scaling Logic
// ============================================================================

export class WorkerAutoScaler {
  private deployer: DecentralizedWorkerDeployer;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(deployer: DecentralizedWorkerDeployer) {
    this.deployer = deployer;
  }

  start(): void {
    // Check every 10 seconds
    this.checkInterval = setInterval(() => {
      this.evaluateScaling().catch(console.error);
    }, 10000);
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async evaluateScaling(): Promise<void> {
    for (const worker of this.deployer.listWorkers()) {
      if (worker.status !== 'active') continue;

      const activeInstances = worker.instances.filter(
        i => i.status === 'warm' || i.status === 'busy'
      );

      // Calculate average load
      const totalActiveRequests = activeInstances.reduce(
        (sum, i) => sum + i.activeRequests, 0
      );
      const avgLoad = activeInstances.length > 0 
        ? totalActiveRequests / activeInstances.length 
        : 0;

      // Scale up if average load > target concurrency * 0.8
      if (avgLoad > worker.scaling.targetConcurrency * 0.8) {
        if (activeInstances.length < worker.scaling.maxInstances) {
          console.log(`[AutoScaler] Scaling up ${worker.name}: load=${avgLoad.toFixed(1)}`);
          await this.deployer.scaleWorker(worker.id, activeInstances.length + 1);
        }
      }

      // Scale down if average load < target concurrency * 0.3 and we have more than min
      if (avgLoad < worker.scaling.targetConcurrency * 0.3) {
        if (activeInstances.length > worker.scaling.minInstances) {
          // Check cooldown - don't scale down too quickly
          const oldestIdle = activeInstances
            .filter(i => i.activeRequests === 0)
            .sort((a, b) => a.lastRequestAt - b.lastRequestAt)[0];

          if (oldestIdle && Date.now() - oldestIdle.lastRequestAt > worker.scaling.cooldownMs) {
            console.log(`[AutoScaler] Scaling down ${worker.name}: load=${avgLoad.toFixed(1)}`);
            await this.deployer.scaleWorker(worker.id, activeInstances.length - 1);
          }
        }
      }

      // Scale to zero if configured and no requests
      if (worker.scaling.scaleToZero && activeInstances.length > 0) {
        const allIdle = activeInstances.every(i => i.activeRequests === 0);
        const lastRequest = Math.max(...activeInstances.map(i => i.lastRequestAt));
        
        if (allIdle && Date.now() - lastRequest > worker.scaling.cooldownMs * 2) {
          console.log(`[AutoScaler] Scaling to zero: ${worker.name}`);
          await this.deployer.scaleWorker(worker.id, 0);
        }
      }
    }
  }
}

