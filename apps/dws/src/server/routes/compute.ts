import { Hono } from 'hono';
import type { Address } from 'viem';
import { computeJobState } from '../../state.js';
import type { JobStatus } from '@jejunetwork/types';
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
    
    // Check if AWS Bedrock is available (credentials from AWS SDK default chain)
    const bedrockEnabled = process.env.AWS_BEDROCK_ENABLED === 'true' || 
      (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_REGION);

    // Try inference providers in order of preference
    // AWS Bedrock is checked first if AWS credentials are available
    interface ProviderConfig {
      id: string;
      url: string;
      env: string;
      isBedrock?: boolean;
      isAnthropic?: boolean;
      key?: string;
    }
    
    const providers: ProviderConfig[] = [
      ...(bedrockEnabled ? [{ id: 'bedrock', url: 'bedrock', env: 'AWS_BEDROCK_ENABLED', isBedrock: true }] : []),
      { id: 'groq', url: 'https://api.groq.com/openai/v1', env: 'GROQ_API_KEY' },
      { id: 'openrouter', url: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY' },
      { id: 'openai', url: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
      { id: 'anthropic', url: 'https://api.anthropic.com/v1', env: 'ANTHROPIC_API_KEY', isAnthropic: true },
      { id: 'together', url: 'https://api.together.xyz/v1', env: 'TOGETHER_API_KEY' },
      { id: 'custom', url: process.env.INFERENCE_API_URL ?? '', env: 'INFERENCE_API_KEY' },
    ];

    // Model-to-provider mapping
    const modelProviderMap: Record<string, string> = {
      // OpenAI models
      'gpt-4': 'openai', 'gpt-4o': 'openai', 'gpt-4o-mini': 'openai', 'gpt-4-turbo': 'openai',
      'gpt-3.5': 'openai', 'gpt-3.5-turbo': 'openai', 'o1': 'openai', 'o3': 'openai',
      // Anthropic models
      'claude': 'anthropic', 'claude-3': 'anthropic', 'claude-3.5': 'anthropic',
      'claude-3-opus': 'anthropic', 'claude-3-sonnet': 'anthropic', 'claude-3-haiku': 'anthropic',
      'claude-3-5-sonnet': 'anthropic', 'claude-3-5-haiku': 'anthropic',
      // Groq models (Llama, Mixtral)
      'llama': 'groq', 'llama-3': 'groq', 'llama-3.1': 'groq', 'llama-3.2': 'groq', 'llama-3.3': 'groq',
      'mixtral': 'groq', 'gemma': 'groq',
    };

    // Find the best provider based on model
    const requestedModel = body.model ?? '';
    let preferredProvider: string | null = null;
    
    // Check if model name starts with any known prefix
    for (const [prefix, provider] of Object.entries(modelProviderMap)) {
      if (requestedModel.toLowerCase().startsWith(prefix.toLowerCase())) {
        preferredProvider = provider;
        break;
      }
    }

    // Find first available provider, preferring the one that matches the model
    let selectedProvider: ProviderConfig | null = null;
    
    // First, try the preferred provider
    if (preferredProvider) {
      const p = providers.find(x => x.id === preferredProvider);
      if (p) {
        if (p.isBedrock && bedrockEnabled) {
          selectedProvider = { ...p, key: 'bedrock' };
        } else {
          const key = process.env[p.env];
          if (key && p.url) {
            selectedProvider = { ...p, key };
          }
        }
      }
    }
    
    // If no preferred provider or not available, fall back to any available
    if (!selectedProvider) {
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
    }

    // If no provider available, return mock response for dev/testing
    if (!selectedProvider) {
      const mockContent = `This is a mock response. No inference provider is configured.
Set one of: GROQ_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or AWS_BEDROCK_ENABLED=true`;
      
      return c.json({
        id: `chatcmpl-mock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? 'mock',
        provider: 'mock',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: mockContent },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });
    }

    // Handle AWS Bedrock
    if (selectedProvider.isBedrock) {
      const region = process.env.AWS_REGION ?? 'us-east-1';
      const modelId = body.model ?? 'anthropic.claude-3-haiku-20240307-v1:0';
      
      // Convert messages to Bedrock format (Anthropic Claude on Bedrock)
      const systemMessage = body.messages.find(m => m.role === 'system')?.content ?? '';
      const conversationMessages = body.messages.filter(m => m.role !== 'system');
      
      const bedrockBody = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: body.max_tokens ?? 1024,
        system: systemMessage,
        messages: conversationMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      };

      // Use AWS SDK v3 for Bedrock Runtime
      const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const client = new BedrockRuntimeClient({ region });
      
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(bedrockBody),
      });

      const bedrockResponse = await client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body)) as {
        content: Array<{ text: string }>;
        usage: { input_tokens: number; output_tokens: number };
      };

      // Convert to OpenAI format
      return c.json({
        id: `chatcmpl-bedrock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        provider: 'bedrock',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: responseBody.content[0]?.text ?? '' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: responseBody.usage.input_tokens,
          completion_tokens: responseBody.usage.output_tokens,
          total_tokens: responseBody.usage.input_tokens + responseBody.usage.output_tokens,
        },
      });
    }

    // Handle Anthropic's different API format
    if (selectedProvider.isAnthropic) {
      const anthropicBody = {
        model: body.model ?? 'claude-3-haiku-20240307',
        max_tokens: body.max_tokens ?? 1024,
        messages: body.messages.filter(m => m.role !== 'system').map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        system: body.messages.find(m => m.role === 'system')?.content,
      };

      const response = await fetch(`${selectedProvider.url}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': selectedProvider.key || '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(anthropicBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return c.json({ error: `Anthropic error: ${errorText}`, provider: 'anthropic' }, response.status as 400 | 401 | 403 | 500);
      }

      const result = await response.json() as { content: Array<{ text: string }>; usage: { input_tokens: number; output_tokens: number } };
      
      // Convert to OpenAI format
      return c.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? 'claude-3-haiku',
        provider: 'anthropic',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result.content[0]?.text ?? '' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: result.usage.input_tokens, completion_tokens: result.usage.output_tokens, total_tokens: result.usage.input_tokens + result.usage.output_tokens },
      });
    }

    // OpenAI-compatible providers (Groq, OpenRouter, OpenAI, Together)
    const response = await fetch(`${selectedProvider.url}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${selectedProvider.key}`,
        ...(selectedProvider.id === 'openrouter' ? { 'HTTP-Referer': 'https://jejunetwork.org', 'X-Title': 'Jeju Network' } : {}),
      },
      body: JSON.stringify({
        ...body,
        model: body.model ?? (selectedProvider.id === 'groq' ? 'llama-3.3-70b-versatile' : body.model),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return c.json({ error: `${selectedProvider.id} error: ${errorText}`, provider: selectedProvider.id }, response.status as 400 | 401 | 403 | 500);
    }

    const result = await response.json();
    return c.json({ ...result, provider: selectedProvider.id });
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
      throw new Error('Job not found');
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
      throw new Error('Job not found');
    }
    if (row.status === 'completed' || row.status === 'failed') {
      throw new Error('Job already finished');
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
    const { status } = validateQuery(trainingRunsQuerySchema, c);
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
    const { runId } = validateParams(trainingRunParamsSchema, c);
    const run = trainingRuns.get(runId);
    
    if (!run) {
      throw new Error('Run not found');
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
    const { address } = validateParams(nodeParamsSchema, c);
    const node = trainingNodes.get(address.toLowerCase());
    
    if (!node) {
      throw new Error('Node not found');
    }
    
    return c.json(node);
  });

  // Register as training node (for DWS nodes)
  app.post('/nodes/register', async (c) => {
    const body = await validateBody(trainingNodeRegistrationSchema, c);
    const address = body.address.toLowerCase();
    
    trainingNodes.set(address, {
      address,
      gpuTier: body.gpuTier,
      score: 100,
      latencyMs: 50,
      bandwidthMbps: 1000,
      isActive: true,
    });

    console.log(`[Compute] Registered node ${address} with GPU tier ${body.gpuTier}`, {
      capabilities: body.capabilities,
      teeProvider: body.teeProvider,
      region: body.region,
    });
    
    return c.json({
      success: true,
      address,
      gpuTier: body.gpuTier,
      capabilities: body.capabilities,
    });
  });

  // Training webhook for state updates
  app.post('/training/webhook', async (c) => {
    const body = await validateBody(trainingRunSchema, c);
    trainingRuns.set(body.runId, body);
    return c.json({ success: true });
  });
}
