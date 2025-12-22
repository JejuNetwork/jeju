import { Hono } from 'hono';
import type { Address } from 'viem';
import { computeJobState } from '../../state.js';
import type { JobStatus } from '@jejunetwork/types';
import { 
  registerNode, 
  unregisterNode, 
  getActiveNodes, 
  getNodeStats,
  updateNodeHeartbeat,
  type InferenceNode 
} from '../../compute/inference-node';
import { validateBody, validateParams, validateQuery, validateHeaders, jejuAddressHeaderSchema, createJobRequestSchema, jobParamsSchema, jobListQuerySchema, inferenceRequestSchema, embeddingsRequestSchema, trainingNodeRegistrationSchema, trainingRunsQuerySchema, trainingRunParamsSchema, trainingRunSchema, nodeParamsSchema, z } from '../../shared';

interface ComputeJob {
  jobId: string;
  command: string;
  shell: string;
  env: Record<string, string>;
  workingDir?: string;
  timeout: number;
  status: JobStatus;
  output: string;
  exitCode: number | null;
  startedAt: number | null;
  completedAt: number | null;
  submittedBy: Address;
}

// Active jobs tracking (for in-process execution)
const activeJobs = new Set<string>();
const MAX_CONCURRENT = 5;

// State initialization is handled by main server startup

const SHELL_CONFIG: Record<string, { path: string; args: (cmd: string) => string[] }> = {
  bash: { path: '/bin/bash', args: (cmd) => ['-c', cmd] },
  sh: { path: '/bin/sh', args: (cmd) => ['-c', cmd] },
  pwsh: { path: 'pwsh', args: (cmd) => ['-c', cmd] },
  powershell: { path: 'pwsh', args: (cmd) => ['-c', cmd] },
  cmd: { path: 'cmd.exe', args: (cmd) => ['/c', cmd] },
};

export function createComputeRouter(): Hono {
  const app = new Hono();
  
  // Add training routes to compute router
  addTrainingRoutes(app);

  app.get('/health', async (c) => {
    let queuedCount = 0;
    let cqlStatus = 'connected';
    try {
      const queued = await computeJobState.getQueued();
      queuedCount = queued.length;
    } catch {
      cqlStatus = 'unavailable';
    }
    return c.json({
      service: 'dws-compute',
      status: 'healthy',
      activeJobs: activeJobs.size,
      maxConcurrent: MAX_CONCURRENT,
      queuedJobs: queuedCount,
      cqlStatus,
    });
  });

  app.post('/chat/completions', async (c) => {
    const body = await validateBody(inferenceRequestSchema, c);
    
    // Get active inference nodes
    const activeNodes = getActiveNodes();
    
    // Find a suitable node for this model
    const modelLower = (body.model ?? '').toLowerCase();
    let selectedNode: InferenceNode | null = null;
    
    // Try to find a node that can handle this model
    for (const node of activeNodes) {
      if (node.currentLoad >= node.maxConcurrent) continue;
      
      // Check if node's provider/models match
      const nodeModels = node.models.map(m => m.toLowerCase());
      if (nodeModels.includes('*') || nodeModels.some(m => modelLower.includes(m) || m.includes(modelLower.split('-')[0]))) {
        selectedNode = node;
        break;
      }
    }
    
    // Fallback to any available node
    if (!selectedNode) {
      selectedNode = activeNodes.find(n => n.currentLoad < n.maxConcurrent) ?? null;
    }
    
    // If no nodes available, return error (no fallback to direct providers)
    if (!selectedNode) {
      return c.json({
        error: 'No inference nodes available',
        message: 'Register an inference node with DWS. For local dev: bun run src/compute/local-inference-server.ts',
        activeNodes: activeNodes.length,
        stats: getNodeStats(),
      }, 503);
    }
    
    // Route request to the node
    const response = await fetch(`${selectedNode.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return c.json({ 
        error: `Node ${selectedNode.address} error: ${errorText}`,
        node: selectedNode.address,
      }, response.status as 400 | 500);
    }
    
    const result = await response.json() as Record<string, unknown>;
    return c.json({
      ...result,
      node: selectedNode.address,
      provider: selectedNode.provider,
    });
  });

  app.post('/embeddings', async (c) => {
    const body = await validateBody(embeddingsRequestSchema, c);
    
    // Check if AWS Bedrock is available
    const bedrockEnabled = process.env.AWS_BEDROCK_ENABLED === 'true' || 
      (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_REGION);

    // Try embedding providers in order (Bedrock first if available)
    interface EmbeddingProvider {
      id: string;
      url: string;
      env: string;
      isBedrock?: boolean;
      key?: string;
    }
    
    const providers: EmbeddingProvider[] = [
      ...(bedrockEnabled ? [{ id: 'bedrock', url: 'bedrock', env: 'AWS_BEDROCK_ENABLED', isBedrock: true }] : []),
      { id: 'openai', url: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
      { id: 'together', url: 'https://api.together.xyz/v1', env: 'TOGETHER_API_KEY' },
      { id: 'custom', url: process.env.INFERENCE_API_URL ?? '', env: 'INFERENCE_API_KEY' },
    ];

    let selectedProvider: EmbeddingProvider | null = null;
    for (const p of providers) {
      if (p.isBedrock && bedrockEnabled) {
        selectedProvider = { ...p, key: 'bedrock' };
        break;
      }
      const key = process.env[p.env];
      if (key && p.url) {
        selectedProvider = { ...p, key };
        break;
      }
    }

    if (!selectedProvider) {
      // No provider available - fail with clear error
      return c.json({
        error: 'No embedding provider configured',
        message: 'Set AWS_BEDROCK_ENABLED=true or OPENAI_API_KEY for embeddings',
        configured: providers.map(p => p.id),
      }, 503);
    }

    // Handle AWS Bedrock Titan Embeddings
    if (selectedProvider.isBedrock) {
      const region = process.env.AWS_REGION ?? 'us-east-1';
      const modelId = body.model ?? 'amazon.titan-embed-text-v2:0';
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      
      const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const client = new BedrockRuntimeClient({ region });
      
      const embeddings: number[][] = [];
      let totalTokens = 0;
      
      for (const text of inputs) {
        const command = new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({ inputText: text }),
        });
        
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body)) as {
          embedding: number[];
          inputTextTokenCount: number;
        };
        
        embeddings.push(responseBody.embedding);
        totalTokens += responseBody.inputTextTokenCount;
      }

      return c.json({
        object: 'list',
        data: embeddings.map((embedding, i) => ({
          object: 'embedding',
          index: i,
          embedding,
        })),
        model: modelId,
        provider: 'bedrock',
        usage: { prompt_tokens: totalTokens, total_tokens: totalTokens },
      });
    }

    const response = await fetch(`${selectedProvider.url}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${selectedProvider.key}`,
      },
      body: JSON.stringify({
        ...body,
        model: body.model ?? 'text-embedding-3-small',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return c.json({ error: `${selectedProvider.id} embeddings error: ${errorText}`, provider: selectedProvider.id }, response.status as 400 | 401 | 403 | 500);
    }

    const result = await response.json();
    return c.json({ ...result, provider: selectedProvider.id });
  });

  app.post('/jobs', async (c) => {
    const { 'x-jeju-address': submitter } = validateHeaders(jejuAddressHeaderSchema, c);
    const body = await validateBody(createJobRequestSchema, c);

    const jobId = crypto.randomUUID();
    const job: ComputeJob = {
      jobId,
      command: body.command,
      shell: body.shell,
      env: body.env,
      workingDir: body.workingDir,
      timeout: body.timeout,
      status: 'queued',
      output: '',
      exitCode: null,
      startedAt: null,
      completedAt: null,
      submittedBy: submitter,
    };

    await computeJobState.save(job);
    processQueue();

    return c.json({ jobId, status: job.status }, 201);
  });

  app.get('/jobs/:jobId', async (c) => {
    const { jobId } = validateParams(jobParamsSchema, c);
    const row = await computeJobState.get(jobId);
    if (!row) {
      return c.json({ error: 'Job not found' }, 404);
    }

    return c.json({
      jobId: row.job_id,
      status: row.status,
      output: row.output,
      exitCode: row.exit_code,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      duration: row.completed_at && row.started_at ? row.completed_at - row.started_at : null,
    });
  });

  app.post('/jobs/:jobId/cancel', async (c) => {
    const { jobId } = validateParams(jobParamsSchema, c);
    const row = await computeJobState.get(jobId);
    if (!row) {
      return c.json({ error: 'Job not found' }, 404);
    }
    if (row.status === 'completed' || row.status === 'failed') {
      return c.json({ error: 'Job already finished' }, 400);
    }

    const job: ComputeJob = {
      jobId: row.job_id,
      command: row.command,
      shell: row.shell,
      env: JSON.parse(row.env),
      workingDir: row.working_dir ?? undefined,
      timeout: row.timeout,
      status: 'cancelled',
      output: row.output,
      exitCode: row.exit_code,
      startedAt: row.started_at,
      completedAt: Date.now(),
      submittedBy: row.submitted_by as Address,
    };

    await computeJobState.save(job);
    activeJobs.delete(row.job_id);

    return c.json({ jobId: row.job_id, status: 'cancelled' });
  });

  app.get('/jobs', async (c) => {
    const { 'x-jeju-address': submitter } = validateHeaders(z.object({ 'x-jeju-address': z.string().optional() }), c);
    const { status: statusFilter, limit } = validateQuery(jobListQuerySchema, c);

    const rows = await computeJobState.list({
      submittedBy: submitter,
      status: statusFilter ?? undefined,
      limit,
    });

    return c.json({
      jobs: rows.map((j) => ({
        jobId: j.job_id,
        status: j.status,
        exitCode: j.exit_code,
        startedAt: j.started_at,
        completedAt: j.completed_at,
      })),
      total: rows.length,
    });
  });

  return app;
}

async function processQueue(): Promise<void> {
  if (activeJobs.size >= MAX_CONCURRENT) return;

  const queued = await computeJobState.getQueued();
  const next = queued[0];
  if (!next) return;

  const job: ComputeJob = {
    jobId: next.job_id,
    command: next.command,
    shell: next.shell,
    env: JSON.parse(next.env),
    workingDir: next.working_dir ?? undefined,
    timeout: next.timeout,
    status: 'in_progress',
    output: '',
    exitCode: null,
    startedAt: Date.now(),
    completedAt: null,
    submittedBy: next.submitted_by as Address,
  };

  activeJobs.add(job.jobId);
  await computeJobState.save(job);

  executeJob(job);
}

async function executeJob(job: ComputeJob): Promise<void> {
  const config = SHELL_CONFIG[job.shell] || SHELL_CONFIG.bash;
  const output: string[] = [];

  const proc = Bun.spawn([config.path, ...config.args(job.command)], {
    cwd: job.workingDir || process.cwd(),
    env: { ...process.env, ...job.env, CI: 'true', JEJU_COMPUTE: 'true' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timeoutId = setTimeout(() => {
    proc.kill();
    finishJob(job, output.join('') + '\n[TIMEOUT]', 1);
  }, job.timeout);

  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      output.push(decoder.decode(value));
    }
  };

  await Promise.all([drain(proc.stdout), drain(proc.stderr)]);
  clearTimeout(timeoutId);

  finishJob(job, output.join(''), await proc.exited);
}

async function finishJob(job: ComputeJob, output: string, exitCode: number): Promise<void> {
  job.output = output;
  job.exitCode = exitCode;
  job.status = exitCode === 0 ? 'completed' : 'failed';
  job.completedAt = Date.now();
  
  await computeJobState.save(job);
  activeJobs.delete(job.jobId);
  processQueue();
}

// ============ Training Routes (CQL-backed) ============

import { trainingState } from '../../state';

export function addTrainingRoutes(app: Hono): void {
  // List training runs
  app.get('/training/runs', async (c) => {
    const { status } = validateQuery(trainingRunsQuerySchema, c);
    const runs = await trainingState.listRuns(status as 'active' | 'completed' | 'paused' | undefined);
    
    return c.json(runs.map(r => ({
      runId: r.run_id,
      model: r.model,
      state: r.state,
      clients: r.clients,
      step: r.step,
      totalSteps: r.total_steps,
      createdAt: r.created_at,
    })));
  });

  // Get training run
  app.get('/training/runs/:runId', async (c) => {
    const { runId } = validateParams(trainingRunParamsSchema, c);
    const run = await trainingState.getRun(runId);
    
    if (!run) {
      throw new Error('Run not found');
    }
    
    return c.json({
      runId: run.run_id,
      model: run.model,
      state: run.state,
      clients: run.clients,
      step: run.step,
      totalSteps: run.total_steps,
      createdAt: run.created_at,
    });
  });

  // List compute nodes
  app.get('/nodes', async (c) => {
    const nodes = await trainingState.listNodes(true);
    return c.json(nodes.map(n => ({
      address: n.address,
      gpuTier: n.gpu_tier,
      score: n.score,
      latencyMs: n.latency_ms,
      bandwidthMbps: n.bandwidth_mbps,
      isActive: n.is_active === 1,
    })));
  });
  
  // Get node stats (must be before /:address route)
  app.get('/nodes/stats', async (c) => {
    const inferenceStats = getNodeStats();
    const trainingStats = await trainingState.getStats();
    
    return c.json({
      inference: inferenceStats,
      training: {
        totalNodes: trainingStats.totalNodes,
        activeNodes: trainingStats.activeNodes,
        totalRuns: trainingStats.totalRuns,
        activeRuns: trainingStats.activeRuns,
      },
    });
  });
  
  // List active inference nodes (must be before /:address route)
  app.get('/nodes/inference', async (c) => {
    return c.json(getActiveNodes());
  });

  // Get node info (parameterized route must come after specific routes)
  app.get('/nodes/:address', async (c) => {
    const { address } = validateParams(nodeParamsSchema, c);
    const node = await trainingState.getNode(address);
    
    if (!node) {
      throw new Error('Node not found');
    }
    
    return c.json({
      address: node.address,
      gpuTier: node.gpu_tier,
      score: node.score,
      latencyMs: node.latency_ms,
      bandwidthMbps: node.bandwidth_mbps,
      isActive: node.is_active === 1,
    });
  });

  // Register as training/inference node (for DWS nodes)
  app.post('/nodes/register', async (c) => {
    const body = await validateBody(trainingNodeRegistrationSchema, c);
    const address = body.address.toLowerCase();
    
    // Register for training jobs (persisted to CQL)
    await trainingState.saveNode({
      address,
      gpuTier: body.gpuTier,
      score: 100,
      latencyMs: 50,
      bandwidthMbps: 1000,
      isActive: true,
    });
    
    // Register for inference if endpoint provided
    if (body.endpoint && body.capabilities?.includes('inference')) {
      registerNode({
        address,
        endpoint: body.endpoint,
        capabilities: body.capabilities || ['inference'],
        models: body.models || ['*'],
        provider: body.provider || 'local',
        region: body.region || 'unknown',
        gpuTier: body.gpuTier,
        maxConcurrent: body.maxConcurrent || 10,
        isActive: true,
        teeProvider: body.teeProvider,
      });
    }
    
    console.log(`[Compute] Registered node ${address} with GPU tier ${body.gpuTier}`, {
      capabilities: body.capabilities,
      teeProvider: body.teeProvider,
      region: body.region,
      provider: body.provider,
    });
    
    return c.json({
      success: true,
      address,
      gpuTier: body.gpuTier,
      capabilities: body.capabilities,
    });
  });
  
  // Node heartbeat
  app.post('/nodes/heartbeat', async (c) => {
    const body = await c.req.json<{ address: string; load?: number }>();
    const address = body.address.toLowerCase();
    
    // Update CQL
    await trainingState.updateHeartbeat(address);
    
    // Update inference node (in-memory)
    const updated = updateNodeHeartbeat(address, body.load);
    
    return c.json({ success: updated });
  });
  
  // Unregister node
  app.delete('/nodes/:address', async (c) => {
    const address = c.req.param('address').toLowerCase();
    
    // Remove from CQL
    await trainingState.deleteNode(address);
    
    // Remove from inference nodes
    unregisterNode(address);
    
    return c.json({ success: true });
  });
  
  // Training webhook for state updates
  app.post('/training/webhook', async (c) => {
    const body = await validateBody(trainingRunSchema, c);
    
    await trainingState.saveRun({
      runId: body.runId,
      model: body.model,
      state: body.state,
      clients: body.clients,
      step: body.step,
      totalSteps: body.totalSteps,
    });
    
    return c.json({ success: true });
  });
}
