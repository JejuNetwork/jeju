/**
 * DWS Integration for Distributed Training
 * 
 * Provides on-demand node provisioning and job scheduling for
 * Psyche network training requests. Integrates training module
 * with DWS container deployment and API exposure.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { startAtroposServer } from './atropos-server';
import { createDistributedGRPOTrainer } from './grpo-trainer';
import { createPsycheClient, type RolloutBundle } from './psyche-client';
import { createCrossChainBridge } from './cross-chain-bridge';
import { Keypair } from '@solana/web3.js';
import type { Address, Hex } from 'viem';

// ============================================================================
// Types
// ============================================================================

export interface TrainingJobRequest {
  jobId: string;
  runId: string;
  modelName: string;
  trainingSteps: number;
  batchSize: number;
  learningRate: number;
  nodeCount: number;
  gpuType: string;
  memoryGb: number;
  priority: 'low' | 'normal' | 'high';
  environmentId?: string;
  datasetCid?: string;
}

export interface TrainingJobStatus {
  jobId: string;
  runId: string;
  status: 'pending' | 'provisioning' | 'training' | 'checkpointing' | 'completed' | 'failed';
  currentStep: number;
  totalSteps: number;
  nodeCount: number;
  startedAt: number;
  updatedAt: number;
  checkpointCid?: string;
  error?: string;
  metrics?: {
    loss: number;
    gradNorm: number;
    epochProgress: number;
  };
}

export interface NodeAllocation {
  nodeId: string;
  instanceId: string;
  gpuType: string;
  gpuCount: number;
  memoryGb: number;
  status: 'provisioning' | 'ready' | 'training' | 'released';
  allocatedAt: number;
  releasedAt?: number;
}

export interface PsycheJobConfig {
  solanaRpcUrl: string;
  solanaKeypair: Keypair;
  evmRpcUrl: string;
  evmPrivateKey: Hex;
  bridgeAddress: Address;
  pollingIntervalMs: number;
}

// ============================================================================
// Job Queue
// ============================================================================

class TrainingJobQueue {
  private jobs: Map<string, TrainingJobStatus> = new Map();
  private allocations: Map<string, NodeAllocation[]> = new Map();
  private pendingJobs: TrainingJobRequest[] = [];

  addJob(request: TrainingJobRequest): TrainingJobStatus {
    const status: TrainingJobStatus = {
      jobId: request.jobId,
      runId: request.runId,
      status: 'pending',
      currentStep: 0,
      totalSteps: request.trainingSteps,
      nodeCount: request.nodeCount,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.jobs.set(request.jobId, status);
    this.pendingJobs.push(request);

    return status;
  }

  getJob(jobId: string): TrainingJobStatus | null {
    return this.jobs.get(jobId) ?? null;
  }

  updateJob(jobId: string, update: Partial<TrainingJobStatus>): void {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, update, { updatedAt: Date.now() });
    }
  }

  getNextPendingJob(): TrainingJobRequest | null {
    // Sort by priority and age
    this.pendingJobs.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    return this.pendingJobs.shift() ?? null;
  }

  setAllocations(jobId: string, allocations: NodeAllocation[]): void {
    this.allocations.set(jobId, allocations);
  }

  getAllocations(jobId: string): NodeAllocation[] {
    return this.allocations.get(jobId) ?? [];
  }

  releaseAllocations(jobId: string): void {
    const allocations = this.allocations.get(jobId);
    if (allocations) {
      for (const alloc of allocations) {
        alloc.status = 'released';
        alloc.releasedAt = Date.now();
      }
    }
  }

  getAllJobs(): TrainingJobStatus[] {
    return Array.from(this.jobs.values());
  }
}

// ============================================================================
// Node Provisioner
// ============================================================================

class NodeProvisioner {
  private availableNodes: Map<string, NodeAllocation> = new Map();

  async provisionNodes(
    request: TrainingJobRequest
  ): Promise<NodeAllocation[]> {
    const allocations: NodeAllocation[] = [];

    for (let i = 0; i < request.nodeCount; i++) {
      const nodeId = `node-${request.jobId}-${i}`;
      const allocation: NodeAllocation = {
        nodeId,
        instanceId: `instance-${Date.now()}-${i}`,
        gpuType: request.gpuType,
        gpuCount: 1,
        memoryGb: request.memoryGb,
        status: 'provisioning',
        allocatedAt: Date.now(),
      };

      allocations.push(allocation);
      this.availableNodes.set(nodeId, allocation);

      // Simulate provisioning delay
      setTimeout(() => {
        allocation.status = 'ready';
      }, 2000);
    }

    return allocations;
  }

  async releaseNodes(allocations: NodeAllocation[]): Promise<void> {
    for (const alloc of allocations) {
      alloc.status = 'released';
      alloc.releasedAt = Date.now();
      this.availableNodes.delete(alloc.nodeId);
    }
  }

  getNodeStatus(nodeId: string): NodeAllocation | null {
    return this.availableNodes.get(nodeId) ?? null;
  }
}

// ============================================================================
// Psyche Network Listener
// ============================================================================

class PsycheJobListener {
  private config: PsycheJobConfig;
  private psycheClient: ReturnType<typeof createPsycheClient>;
  private bridge: ReturnType<typeof createCrossChainBridge>;
  private jobQueue: TrainingJobQueue;
  private provisioner: NodeProvisioner;
  private running = false;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(
    config: PsycheJobConfig,
    jobQueue: TrainingJobQueue,
    provisioner: NodeProvisioner
  ) {
    this.config = config;
    this.jobQueue = jobQueue;
    this.provisioner = provisioner;

    this.psycheClient = createPsycheClient({
      solanaRpcUrl: config.solanaRpcUrl,
      solanaKeypair: config.solanaKeypair,
      evmRpcUrl: config.evmRpcUrl,
      evmPrivateKey: config.evmPrivateKey,
    });

    this.bridge = createCrossChainBridge({
      evmRpcUrl: config.evmRpcUrl,
      evmPrivateKey: config.evmPrivateKey,
      bridgeContractAddress: config.bridgeAddress,
      solanaRpcUrl: config.solanaRpcUrl,
      solanaKeypair: config.solanaKeypair,
    });

    this.bridge.setPsycheClient(this.psycheClient);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('[PsycheListener] Starting job listener...');

    this.pollInterval = setInterval(async () => {
      await this.pollForJobs();
    }, this.config.pollingIntervalMs);

    // Initial poll
    await this.pollForJobs();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async pollForJobs(): Promise<void> {
    // Process pending jobs from queue
    let job = this.jobQueue.getNextPendingJob();
    while (job) {
      await this.processJob(job);
      job = this.jobQueue.getNextPendingJob();
    }
  }

  private async processJob(request: TrainingJobRequest): Promise<void> {
    console.log(`[PsycheListener] Processing job ${request.jobId}`);

    // Update status to provisioning
    this.jobQueue.updateJob(request.jobId, { status: 'provisioning' });

    // Provision nodes
    const allocations = await this.provisioner.provisionNodes(request);
    this.jobQueue.setAllocations(request.jobId, allocations);

    // Wait for nodes to be ready
    await this.waitForNodes(allocations);

    // Update status to training
    this.jobQueue.updateJob(request.jobId, { status: 'training' });

    // Start training
    await this.runTraining(request, allocations);
  }

  private async waitForNodes(allocations: NodeAllocation[]): Promise<void> {
    const timeout = 60000; // 60 seconds
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const allReady = allocations.every((a) => a.status === 'ready');
      if (allReady) return;
      await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error('Node provisioning timeout');
  }

  private async runTraining(
    request: TrainingJobRequest,
    allocations: NodeAllocation[]
  ): Promise<void> {
    const trainer = createDistributedGRPOTrainer({
      modelName: request.modelName,
      trainingSteps: request.trainingSteps,
      batchSize: request.batchSize,
      learningRate: request.learningRate,
      savePath: `./checkpoints/${request.jobId}`,
    });

    // Set up Psyche integration
    await trainer.setPsycheClient(this.psycheClient);
    await trainer.setBridge(this.bridge);

    // Create distributed run
    await trainer.createDistributedRun(request.runId);

    // Track progress
    trainer.onTrainingMetrics((metrics) => {
      this.jobQueue.updateJob(request.jobId, {
        currentStep: metrics.step,
        metrics: {
          loss: metrics.loss,
          gradNorm: metrics.gradNorm,
          epochProgress: metrics.step / request.trainingSteps,
        },
      });
    });

    // Start training
    await trainer.registerWithAtropos();
    await trainer.startTraining();

    // Training complete
    const checkpointPath = await trainer.getCheckpoint();
    this.jobQueue.updateJob(request.jobId, {
      status: 'completed',
      checkpointCid: checkpointPath ?? undefined,
    });

    // Release nodes
    this.provisioner.releaseNodes(allocations);
    this.jobQueue.releaseAllocations(request.jobId);
  }
}

// ============================================================================
// DWS Training API Routes
// ============================================================================

export function createTrainingRoutes(
  jobQueue: TrainingJobQueue,
  psycheListener?: PsycheJobListener
): Hono {
  const app = new Hono();

  app.use('*', cors());

  // Health check
  app.get('/health', (c) => {
    return c.json({ status: 'healthy', service: 'dws-training' });
  });

  // Submit training job
  app.post('/jobs', async (c) => {
    const body = await c.req.json() as Omit<TrainingJobRequest, 'jobId'>;
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const request: TrainingJobRequest = {
      ...body,
      jobId,
      priority: body.priority ?? 'normal',
      nodeCount: body.nodeCount ?? 1,
    };

    const status = jobQueue.addJob(request);
    return c.json(status, 201);
  });

  // Get job status
  app.get('/jobs/:jobId', (c) => {
    const jobId = c.req.param('jobId');
    const status = jobQueue.getJob(jobId);

    if (!status) {
      return c.json({ error: 'Job not found' }, 404);
    }

    return c.json(status);
  });

  // List all jobs
  app.get('/jobs', (c) => {
    const jobs = jobQueue.getAllJobs();
    return c.json({ jobs });
  });

  // Get job allocations
  app.get('/jobs/:jobId/allocations', (c) => {
    const jobId = c.req.param('jobId');
    const allocations = jobQueue.getAllocations(jobId);
    return c.json({ allocations });
  });

  // Judge rollout bundles (LLM-as-judge)
  app.post('/judge', async (c) => {
    const body = await c.req.json() as { bundles: RolloutBundle[] };

    if (!psycheListener) {
      return c.json({ error: 'Psyche integration not configured' }, 503);
    }

    // Create temporary client for judging
    const psycheClient = createPsycheClient({
      solanaRpcUrl: 'http://localhost:8899',
      llmJudgeUrl: process.env.LLM_JUDGE_URL ?? 'http://localhost:9001',
      llmJudgeModel: process.env.LLM_JUDGE_MODEL ?? 'default',
    });

    const results = await psycheClient.judgeMultipleBundles(body.bundles);
    return c.json({ results });
  });

  // Start Atropos server for a job
  app.post('/jobs/:jobId/atropos', async (c) => {
    const body = await c.req.json() as { port?: number };
    const port = body.port ?? 8000 + Math.floor(Math.random() * 1000);
    
    // Start Atropos server in background
    startAtroposServer(port);

    return c.json({ port, url: `http://localhost:${port}` });
  });

  // Bridge Merkle root computation
  app.post('/bridge/merkle/root', async (c) => {
    const body = await c.req.json() as { 
      rewards: Array<{ client: string; amount: string }> 
    };

    const { createCrossChainBridge } = await import('./cross-chain-bridge');
    const bridge = createCrossChainBridge({
      solanaRpcUrl: 'http://localhost:8899',
      evmRpcUrl: 'http://localhost:6546',
      bridgeContractAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    });

    const rewards = body.rewards.map(r => ({
      client: r.client as `0x${string}`,
      amount: BigInt(r.amount),
    }));

    const root = bridge.computeRewardsMerkleRoot(rewards);
    return c.json({ root });
  });

  // Bridge Merkle proof generation
  app.post('/bridge/merkle/proof', async (c) => {
    const body = await c.req.json() as { 
      rewards: Array<{ client: string; amount: string }>;
      index: number;
    };

    const { createCrossChainBridge } = await import('./cross-chain-bridge');
    const bridge = createCrossChainBridge({
      solanaRpcUrl: 'http://localhost:8899',
      evmRpcUrl: 'http://localhost:6546',
      bridgeContractAddress: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
    });

    const rewards = body.rewards.map(r => ({
      client: r.client as `0x${string}`,
      amount: BigInt(r.amount),
    }));

    const proof = bridge.generateMerkleProof(rewards, body.index);
    return c.json({ proof });
  });

  // Cancel a job
  app.post('/jobs/:jobId/cancel', (c) => {
    const jobId = c.req.param('jobId');
    const job = jobQueue.getJob(jobId);

    if (!job) {
      return c.json({ error: 'Job not found' }, 404);
    }

    jobQueue.releaseAllocations(jobId);
    return c.json({ success: true, jobId });
  });

  // Get total job count
  app.get('/jobs/count', (c) => {
    const jobs = jobQueue.getAllJobs();
    return c.json({ count: jobs.length });
  });

  return app;
}

// ============================================================================
// Main DWS Training Service
// ============================================================================

export class DWSTrainingService {
  private jobQueue: TrainingJobQueue;
  private provisioner: NodeProvisioner;
  private psycheListener: PsycheJobListener | null = null;
  private app: Hono;

  constructor() {
    this.jobQueue = new TrainingJobQueue();
    this.provisioner = new NodeProvisioner();
    this.app = createTrainingRoutes(this.jobQueue);
  }

  configurePsyche(config: PsycheJobConfig): void {
    this.psycheListener = new PsycheJobListener(
      config,
      this.jobQueue,
      this.provisioner
    );

    // Recreate routes with psyche listener
    this.app = createTrainingRoutes(
      this.jobQueue,
      this.psycheListener
    );
  }

  async startPsycheListener(): Promise<void> {
    if (this.psycheListener) {
      await this.psycheListener.start();
    }
  }

  async stopPsycheListener(): Promise<void> {
    if (this.psycheListener) {
      await this.psycheListener.stop();
    }
  }

  getApp(): Hono {
    return this.app;
  }

  getJobQueue(): TrainingJobQueue {
    return this.jobQueue;
  }

  getProvisioner(): NodeProvisioner {
    return this.provisioner;
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createDWSTrainingService(): DWSTrainingService {
  return new DWSTrainingService();
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.main) {
  const service = createDWSTrainingService();
  const app = service.getApp();

  const port = parseInt(process.env.TRAINING_API_PORT ?? '8080', 10);

  console.log(`[DWS Training] Starting API server on port ${port}`);

  Bun.serve({
    port,
    fetch: app.fetch,
  });

  // Optional: Configure Psyche integration
  if (process.env.SOLANA_RPC_URL && process.env.SOLANA_PRIVATE_KEY) {
    const keypairBytes = Buffer.from(process.env.SOLANA_PRIVATE_KEY, 'hex');
    const keypair = Keypair.fromSecretKey(keypairBytes);

    service.configurePsyche({
      solanaRpcUrl: process.env.SOLANA_RPC_URL,
      solanaKeypair: keypair,
      evmRpcUrl: process.env.EVM_RPC_URL ?? 'http://localhost:6546',
      evmPrivateKey: (process.env.EVM_PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex,
      bridgeAddress: (process.env.BRIDGE_ADDRESS ?? '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as Address,
      pollingIntervalMs: 5000,
    });

    service.startPsycheListener();
    console.log('[DWS Training] Psyche listener started');
  }
}

