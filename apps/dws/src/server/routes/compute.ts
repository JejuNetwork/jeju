import { Hono } from 'hono';
import type { InferenceRequest } from '../../types';
import type { Address } from 'viem';
import { computeJobState, initializeDWSState } from '../../state.js';
import { 
  registerNode, 
  unregisterNode, 
  getActiveNodes, 
  getNodeStats,
  updateNodeHeartbeat,
  type InferenceNode 
} from '../../compute/inference-node';

type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

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
const DEFAULT_TIMEOUT = 300000;

// Initialize CQL state
initializeDWSState().catch(console.error);

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
    const queued = await computeJobState.getQueued();
    return c.json({
      service: 'dws-compute',
      status: 'healthy',
      activeJobs: activeJobs.size,
      maxConcurrent: MAX_CONCURRENT,
      queuedJobs: queued.length,
    });
  });

  app.post('/chat/completions', async (c) => {
    const body = await c.req.json<InferenceRequest>();
    
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
      selectedNode = activeNodes.find(n => n.currentLoad < n.maxConcurrent) || null;
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
    try {
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
    } catch (error) {
      return c.json({
        error: `Failed to reach node ${selectedNode.address}: ${(error as Error).message}`,
        node: selectedNode.address,
      }, 502);
    }
  });

  app.post('/embeddings', async (c) => {
    const body = await c.req.json<{ input: string | string[]; model?: string }>();
    
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
      // Return mock embeddings for dev/testing when no provider available
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      return c.json({
        object: 'list',
        data: inputs.map((_, i) => ({
          object: 'embedding',
          index: i,
          embedding: Array.from({ length: 1536 }, () => Math.random() * 2 - 1),
        })),
        model: body.model ?? 'text-embedding-mock',
        usage: { prompt_tokens: 10, total_tokens: 10 },
        provider: 'mock',
        message: 'Set AWS_BEDROCK_ENABLED=true or OPENAI_API_KEY for real embeddings',
      });
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
    const submitter = c.req.header('x-jeju-address') as Address;
    if (!submitter) return c.json({ error: 'Missing x-jeju-address header' }, 401);

    const { command, shell = 'bash', env = {}, workingDir, timeout = DEFAULT_TIMEOUT } = await c.req.json<{
      command: string;
      shell?: string;
      env?: Record<string, string>;
      workingDir?: string;
      timeout?: number;
    }>();

    if (!command) return c.json({ error: 'Command is required' }, 400);

    const jobId = crypto.randomUUID();
    const job: ComputeJob = {
      jobId,
      command,
      shell,
      env,
      workingDir,
      timeout,
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
    const row = await computeJobState.get(c.req.param('jobId'));
    if (!row) return c.json({ error: 'Job not found' }, 404);

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
    const row = await computeJobState.get(c.req.param('jobId'));
    if (!row) return c.json({ error: 'Job not found' }, 404);
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
    const submitter = c.req.header('x-jeju-address')?.toLowerCase();
    const statusFilter = c.req.query('status');
    const limit = parseInt(c.req.query('limit') || '20');

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
    status: 'running',
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

// ============ Training Routes ============

interface TrainingRun {
  runId: string;
  model: string;
  state: number;
  clients: number;
  step: number;
  totalSteps: number;
  createdAt: number;
}

interface TrainingNode {
  address: string;
  gpuTier: number;
  score: number;
  latencyMs: number;
  bandwidthMbps: number;
  isActive: boolean;
}

// Mock storage for training runs (in production, reads from chain)
const trainingRuns: Map<string, TrainingRun> = new Map();
const trainingNodes: Map<string, TrainingNode> = new Map();

export function addTrainingRoutes(app: Hono): void {
  // List training runs
  app.get('/training/runs', async (c) => {
    const status = c.req.query('status');
    let runs = Array.from(trainingRuns.values());
    
    if (status === 'active') {
      runs = runs.filter(r => r.state >= 1 && r.state <= 5);
    } else if (status === 'completed') {
      runs = runs.filter(r => r.state === 6);
    } else if (status === 'paused') {
      runs = runs.filter(r => r.state === 7);
    }
    
    return c.json(runs);
  });

  // Get training run
  app.get('/training/runs/:runId', async (c) => {
    const runId = c.req.param('runId');
    const run = trainingRuns.get(runId);
    
    if (!run) {
      return c.json({ error: 'Run not found' }, 404);
    }
    
    return c.json(run);
  });

  // List compute nodes
  app.get('/nodes', async (c) => {
    const nodes = Array.from(trainingNodes.values()).filter(n => n.isActive);
    return c.json(nodes);
  });

  // Get node info
  app.get('/nodes/:address', async (c) => {
    const address = c.req.param('address');
    const node = trainingNodes.get(address.toLowerCase());
    
    if (!node) {
      return c.json({ error: 'Node not found' }, 404);
    }
    
    return c.json(node);
  });

  // Register as training/inference node (for DWS nodes)
  app.post('/nodes/register', async (c) => {
    const body = await c.req.json<{
      address: string;
      gpuTier: number;
      capabilities?: string[];
      endpoint?: string;
      region?: string;
      teeProvider?: string;
      provider?: string;
      models?: string[];
      maxConcurrent?: number;
    }>();
    
    const address = body.address.toLowerCase();
    
    // Register for training jobs
    trainingNodes.set(address, {
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
    const updated = updateNodeHeartbeat(body.address.toLowerCase(), body.load);
    return c.json({ success: updated });
  });
  
  // Unregister node
  app.delete('/nodes/:address', async (c) => {
    const address = c.req.param('address').toLowerCase();
    trainingNodes.delete(address);
    unregisterNode(address);
    return c.json({ success: true });
  });
  
  // Get inference node stats
  app.get('/nodes/stats', async (c) => {
    const stats = getNodeStats();
    return c.json({
      inference: stats,
      training: {
        totalNodes: trainingNodes.size,
        activeNodes: Array.from(trainingNodes.values()).filter(n => n.isActive).length,
      },
    });
  });
  
  // List active inference nodes
  app.get('/nodes/inference', async (c) => {
    return c.json(getActiveNodes());
  });

  // Training webhook for state updates
  app.post('/training/webhook', async (c) => {
    const body = await c.req.json<TrainingRun>();
    trainingRuns.set(body.runId, body);
    return c.json({ success: true });
  });
}
