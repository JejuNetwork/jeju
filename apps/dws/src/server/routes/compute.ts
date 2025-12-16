import { Hono } from 'hono';
import type { InferenceRequest } from '../../types';
import type { Address } from 'viem';
import { computeJobState, initializeDWSState } from '../../state.js';

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
    const inferenceUrl = process.env.INFERENCE_API_URL;
    const body = await c.req.json<InferenceRequest>();
    
    // If no inference backend, return mock response for dev/testing
    if (!inferenceUrl) {
      return c.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? 'dws-mock',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'This is a mock response from DWS compute. Set INFERENCE_API_URL to connect to a real model.',
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });
    }

    // Proxy to actual inference backend
    const response = await fetch(`${inferenceUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.INFERENCE_API_KEY ? { 'Authorization': `Bearer ${process.env.INFERENCE_API_KEY}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return c.json({ error: `Inference backend error: ${errorText}` }, response.status);
    }

    const result = await response.json();
    return c.json(result);
  });

  app.post('/embeddings', async (c) => {
    const inferenceUrl = process.env.INFERENCE_API_URL;
    const body = await c.req.json<{ input: string | string[]; model?: string }>();
    
    // If no inference backend, return mock embeddings for dev/testing
    if (!inferenceUrl) {
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
      });
    }

    // Proxy to actual embeddings backend
    const response = await fetch(`${inferenceUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.INFERENCE_API_KEY ? { 'Authorization': `Bearer ${process.env.INFERENCE_API_KEY}` } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return c.json({ error: `Embeddings backend error: ${errorText}` }, response.status);
    }

    const result = await response.json();
    return c.json(result);
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
