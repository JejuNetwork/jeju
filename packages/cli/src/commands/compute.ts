/**
 * jeju compute - DWS compute operations
 *
 * Manage compute jobs on DWS (Decentralized Web Services).
 */

import { Command } from 'commander';
import { spawn } from 'bun';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { getChainStatus } from '../lib/chain';
import { DEFAULT_PORTS } from '../types';

const DWS_PORT = parseInt(process.env.DWS_PORT || '4030');

function getDwsUrl(): string {
  return process.env.DWS_URL || `http://localhost:${DWS_PORT}`;
}

export const computeCommand = new Command('compute')
  .description('DWS compute operations')
  .addCommand(
    new Command('status')
      .description('Check DWS compute services status')
      .action(async () => {
        await checkStatus();
      })
  )
  .addCommand(
    new Command('start')
      .description('Start DWS server')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .option('--port <port>', 'Server port', String(DWS_PORT))
      .action(async (options) => {
        await startDws(options);
      })
  )
  .addCommand(
    new Command('node')
      .description('Start DWS provider node (storage + compute)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .option('--port <port>', 'Node port', '4031')
      .action(async (options) => {
        await startNode(options);
      })
  )
  .addCommand(
    new Command('submit')
      .description('Submit a compute job')
      .argument('<command>', 'Shell command to execute')
      .option('--shell <shell>', 'Shell to use: bash, sh, pwsh', 'bash')
      .option('--timeout <ms>', 'Timeout in milliseconds', '300000')
      .option('--address <address>', 'Submitter address')
      .action(async (command, options) => {
        await submitJob(command, options);
      })
  )
  .addCommand(
    new Command('jobs')
      .description('List compute jobs')
      .option('--status <status>', 'Filter by status: queued, running, completed, failed')
      .option('--limit <limit>', 'Max results', '20')
      .action(async (options) => {
        await listJobs(options);
      })
  )
  .addCommand(
    new Command('job')
      .description('Get job details')
      .argument('<job-id>', 'Job ID')
      .action(async (jobId) => {
        await getJob(jobId);
      })
  )
  .addCommand(
    new Command('cancel')
      .description('Cancel a running job')
      .argument('<job-id>', 'Job ID')
      .action(async (jobId) => {
        await cancelJob(jobId);
      })
  )
  .addCommand(
    new Command('inference')
      .description('Run inference request')
      .argument('<prompt>', 'The prompt to send')
      .option('--model <model>', 'Model name', 'default')
      .option('--system <system>', 'System prompt')
      .action(async (prompt, options) => {
        await runInference(prompt, options);
      })
  );

async function checkStatus(): Promise<void> {
  logger.header('DWS COMPUTE STATUS');

  const chain = await getChainStatus('localnet');
  logger.table([
    {
      label: 'Chain',
      value: chain.running ? `Block ${chain.blockNumber}` : 'Not running',
      status: chain.running ? 'ok' : 'error',
    },
  ]);

  const dwsUrl = getDwsUrl();
  let dwsOk = false;

  try {
    const response = await fetch(`${dwsUrl}/compute/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      dwsOk = true;
      const status = (await response.json()) as {
        service: string;
        status: string;
        activeJobs: number;
        maxConcurrent: number;
        queuedJobs: number;
      };

      logger.newline();
      logger.subheader('Compute Service');
      logger.table([
        { label: 'Status', value: status.status, status: status.status === 'healthy' ? 'ok' : 'error' },
        { label: 'Active Jobs', value: String(status.activeJobs), status: 'ok' },
        { label: 'Queued Jobs', value: String(status.queuedJobs), status: 'ok' },
        { label: 'Max Concurrent', value: String(status.maxConcurrent), status: 'ok' },
      ]);
    }
  } catch {
    // DWS not running
  }

  logger.newline();
  logger.table([
    {
      label: 'DWS Server',
      value: dwsOk ? dwsUrl : 'Not running',
      status: dwsOk ? 'ok' : 'error',
    },
  ]);

  if (!dwsOk) {
    logger.newline();
    logger.info('Start DWS with: jeju compute start');
  }
}

async function startDws(options: { network: string; port: string }): Promise<void> {
  logger.header('DWS SERVER');

  const rootDir = process.cwd();
  const dwsDir = join(rootDir, 'apps/dws');

  if (!existsSync(dwsDir)) {
    logger.error('DWS app not found');
    process.exit(1);
  }

  const chain = await getChainStatus(options.network as 'localnet' | 'testnet' | 'mainnet');
  if (!chain.running && options.network === 'localnet') {
    logger.warn('Chain not running. Start with: jeju dev');
    process.exit(1);
  }

  const rpcUrl = options.network === 'localnet'
    ? `http://localhost:${DEFAULT_PORTS.l2Rpc}`
    : options.network === 'testnet'
      ? 'https://testnet-rpc.jejunetwork.org'
      : 'https://rpc.jejunetwork.org';

  logger.step(`Starting DWS server on port ${options.port}...`);
  logger.keyValue('Network', options.network);
  logger.keyValue('RPC URL', rpcUrl);

  const proc = spawn({
    cmd: ['bun', 'run', 'start'],
    cwd: dwsDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: options.port,
      DWS_PORT: options.port,
      NETWORK: options.network,
      RPC_URL: rpcUrl,
      JEJU_RPC_URL: rpcUrl,
    },
  });

  process.on('SIGINT', () => {
    proc.kill('SIGTERM');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    proc.kill('SIGTERM');
    process.exit(0);
  });

  await proc.exited;
}

async function startNode(options: { network: string; port: string }): Promise<void> {
  logger.header('DWS PROVIDER NODE');

  const rootDir = process.cwd();
  const dwsDir = join(rootDir, 'apps/dws');

  if (!existsSync(dwsDir)) {
    logger.error('DWS app not found');
    process.exit(1);
  }

  const chain = await getChainStatus(options.network as 'localnet' | 'testnet' | 'mainnet');
  if (!chain.running && options.network === 'localnet') {
    logger.warn('Chain not running. Start with: jeju dev');
    process.exit(1);
  }

  const rpcUrl = options.network === 'localnet'
    ? `http://localhost:${DEFAULT_PORTS.l2Rpc}`
    : options.network === 'testnet'
      ? 'https://testnet-rpc.jejunetwork.org'
      : 'https://rpc.jejunetwork.org';

  logger.step(`Starting DWS provider node on port ${options.port}...`);
  logger.keyValue('Network', options.network);
  logger.keyValue('RPC URL', rpcUrl);

  const proc = spawn({
    cmd: ['bun', 'run', 'node'],
    cwd: dwsDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      DWS_NODE_PORT: options.port,
      NETWORK: options.network,
      RPC_URL: rpcUrl,
    },
  });

  process.on('SIGINT', () => {
    proc.kill('SIGTERM');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    proc.kill('SIGTERM');
    process.exit(0);
  });

  await proc.exited;
}

async function submitJob(
  command: string,
  options: { shell: string; timeout: string; address?: string }
): Promise<void> {
  logger.header('SUBMIT COMPUTE JOB');

  const dwsUrl = getDwsUrl();
  const address = options.address || process.env.DEPLOYER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

  logger.keyValue('Command', command);
  logger.keyValue('Shell', options.shell);
  logger.keyValue('Timeout', `${options.timeout}ms`);
  logger.newline();

  try {
    const response = await fetch(`${dwsUrl}/compute/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': address,
      },
      body: JSON.stringify({
        command,
        shell: options.shell,
        timeout: parseInt(options.timeout),
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    const result = (await response.json()) as { jobId: string; status: string };
    logger.success('Job submitted');
    logger.keyValue('Job ID', result.jobId);
    logger.keyValue('Status', result.status);
    logger.newline();
    logger.info(`Track with: jeju compute job ${result.jobId}`);
  } catch (error) {
    logger.error(`Failed to submit job: ${error}`);
    process.exit(1);
  }
}

async function listJobs(options: { status?: string; limit: string }): Promise<void> {
  logger.header('COMPUTE JOBS');

  const dwsUrl = getDwsUrl();

  try {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    params.set('limit', options.limit);

    const url = `${dwsUrl}/compute/jobs?${params}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as {
      jobs: Array<{
        jobId: string;
        status: string;
        exitCode: number | null;
        startedAt: number | null;
        completedAt: number | null;
      }>;
      total: number;
    };

    if (data.jobs.length === 0) {
      logger.info('No jobs found');
      return;
    }

    logger.info(`Found ${data.jobs.length} of ${data.total} jobs:\n`);

    for (const job of data.jobs) {
      const statusIcon = job.status === 'completed' ? '✅' : 
                         job.status === 'running' ? '🔄' : 
                         job.status === 'queued' ? '⏳' : 
                         job.status === 'failed' ? '❌' : '⛔';
      console.log(`  ${statusIcon} ${job.jobId}`);
      console.log(`     Status: ${job.status}`);
      if (job.exitCode !== null) console.log(`     Exit Code: ${job.exitCode}`);
      if (job.startedAt) console.log(`     Started: ${new Date(job.startedAt).toISOString()}`);
      if (job.completedAt) console.log(`     Completed: ${new Date(job.completedAt).toISOString()}`);
      console.log('');
    }
  } catch (error) {
    logger.error(`Failed to list jobs: ${error}`);
    process.exit(1);
  }
}

async function getJob(jobId: string): Promise<void> {
  const dwsUrl = getDwsUrl();

  try {
    const response = await fetch(`${dwsUrl}/compute/jobs/${jobId}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.error(`Job not found: ${jobId}`);
      } else {
        logger.error(`HTTP ${response.status}`);
      }
      process.exit(1);
    }

    const job = (await response.json()) as {
      jobId: string;
      status: string;
      output: string;
      exitCode: number | null;
      startedAt: number | null;
      completedAt: number | null;
      duration: number | null;
    };

    logger.header('JOB DETAILS');
    logger.keyValue('Job ID', job.jobId);
    logger.keyValue('Status', job.status);
    if (job.exitCode !== null) logger.keyValue('Exit Code', String(job.exitCode));
    if (job.startedAt) logger.keyValue('Started', new Date(job.startedAt).toISOString());
    if (job.completedAt) logger.keyValue('Completed', new Date(job.completedAt).toISOString());
    if (job.duration !== null) logger.keyValue('Duration', `${job.duration}ms`);

    if (job.output) {
      logger.newline();
      logger.subheader('Output');
      console.log(job.output);
    }
  } catch (error) {
    logger.error(`Failed to get job: ${error}`);
    process.exit(1);
  }
}

async function cancelJob(jobId: string): Promise<void> {
  logger.header('CANCEL JOB');

  const dwsUrl = getDwsUrl();

  try {
    const response = await fetch(`${dwsUrl}/compute/jobs/${jobId}/cancel`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    logger.success(`Cancelled job ${jobId}`);
  } catch (error) {
    logger.error(`Failed to cancel job: ${error}`);
    process.exit(1);
  }
}

async function runInference(
  prompt: string,
  options: { model: string; system?: string }
): Promise<void> {
  logger.header('INFERENCE');

  const dwsUrl = getDwsUrl();

  const messages: Array<{ role: string; content: string }> = [];
  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push({ role: 'user', content: prompt });

  logger.keyValue('Model', options.model);
  logger.keyValue('Prompt', prompt.length > 50 ? `${prompt.slice(0, 50)}...` : prompt);
  logger.newline();

  try {
    const response = await fetch(`${dwsUrl}/compute/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    const result = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    logger.subheader('Response');
    console.log(result.choices[0]?.message?.content || 'No response');
    logger.newline();
    logger.keyValue('Tokens', `${result.usage.prompt_tokens} + ${result.usage.completion_tokens} = ${result.usage.total_tokens}`);
  } catch (error) {
    logger.error(`Inference failed: ${error}`);
    process.exit(1);
  }
}
