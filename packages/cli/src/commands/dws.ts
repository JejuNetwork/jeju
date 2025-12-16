/**
 * jeju dws - Decentralized Web Services CLI
 *
 * Manage DWS services: storage, git (JejuGit), pkg (JejuPkg), CI/CD, CDN
 */

import { Command } from 'commander';
import { spawn } from 'bun';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { getChainStatus } from '../lib/chain';
import { DEFAULT_PORTS } from '../types';
import type { Address } from 'viem';

const DWS_PORT = parseInt(process.env.DWS_PORT || '4030');

function getDwsUrl(): string {
  return process.env.DWS_URL || `http://localhost:${DWS_PORT}`;
}

function getDefaultAddress(): Address {
  return (process.env.DEPLOYER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266') as Address;
}

export const dwsCommand = new Command('dws')
  .description('Decentralized Web Services (storage, git, pkg, ci, cdn)')
  .addCommand(
    new Command('status')
      .description('Check DWS services status')
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
  // Storage subcommands
  .addCommand(
    new Command('upload')
      .description('Upload file to decentralized storage')
      .argument('<file>', 'File path to upload')
      .action(async (file) => {
        await uploadFile(file);
      })
  )
  .addCommand(
    new Command('download')
      .description('Download file from storage')
      .argument('<cid>', 'Content ID (CID)')
      .option('-o, --output <path>', 'Output file path')
      .action(async (cid, options) => {
        await downloadFile(cid, options);
      })
  )
  // Git subcommands
  .addCommand(
    new Command('repos')
      .description('List Git repositories')
      .option('--user <address>', 'Filter by owner address')
      .option('--limit <n>', 'Max results', '20')
      .action(async (options) => {
        await listRepos(options);
      })
  )
  .addCommand(
    new Command('repo')
      .description('Get repository details')
      .argument('<owner>', 'Repository owner address')
      .argument('<name>', 'Repository name')
      .action(async (owner, name) => {
        await getRepo(owner, name);
      })
  )
  .addCommand(
    new Command('create-repo')
      .description('Create a new repository')
      .argument('<name>', 'Repository name')
      .option('--description <desc>', 'Repository description')
      .option('--private', 'Make repository private')
      .option('--address <address>', 'Owner address')
      .action(async (name, options) => {
        await createRepo(name, options);
      })
  )
  // Package registry subcommands
  .addCommand(
    new Command('pkg-search')
      .description('Search packages in JejuPkg registry')
      .argument('<query>', 'Search query')
      .option('--limit <n>', 'Max results', '20')
      .action(async (query, options) => {
        await searchPackages(query, options);
      })
  )
  .addCommand(
    new Command('pkg-info')
      .description('Get package information')
      .argument('<name>', 'Package name (e.g., @scope/package)')
      .action(async (name) => {
        await getPackageInfo(name);
      })
  )
  // CI/CD subcommands
  .addCommand(
    new Command('workflows')
      .description('List CI/CD workflows for a repository')
      .argument('<repo-id>', 'Repository ID (hex)')
      .action(async (repoId) => {
        await listWorkflows(repoId);
      })
  )
  .addCommand(
    new Command('runs')
      .description('List workflow runs')
      .argument('<repo-id>', 'Repository ID')
      .option('--status <status>', 'Filter by status')
      .option('--limit <n>', 'Max results', '20')
      .action(async (repoId, options) => {
        await listRuns(repoId, options);
      })
  )
  .addCommand(
    new Command('run')
      .description('Get run details')
      .argument('<run-id>', 'Run ID')
      .action(async (runId) => {
        await getRunDetails(runId);
      })
  )
  // CDN subcommands
  .addCommand(
    new Command('cdn-status')
      .description('Check CDN service status')
      .action(async () => {
        await checkCdnStatus();
      })
  );

async function checkStatus(): Promise<void> {
  logger.header('DWS STATUS');

  const chain = await getChainStatus('localnet');
  logger.table([
    {
      label: 'Chain',
      value: chain.running ? `Block ${chain.blockNumber}` : 'Not running',
      status: chain.running ? 'ok' : 'error',
    },
  ]);

  const dwsUrl = getDwsUrl();

  try {
    const response = await fetch(`${dwsUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const health = (await response.json()) as {
        status: string;
        service: string;
        version: string;
        uptime: number;
        decentralized?: {
          identityRegistry: string;
          registeredNodes: number;
          connectedPeers: number;
          frontendCid: string;
          p2pEnabled: boolean;
        };
        services: Record<string, { status: string }>;
        backends: { available: string[]; health: Record<string, boolean> };
      };

      logger.newline();
      logger.subheader('DWS Server');
      logger.table([
        { label: 'Status', value: health.status, status: health.status === 'healthy' ? 'ok' : 'error' },
        { label: 'Version', value: health.version, status: 'ok' },
        { label: 'Uptime', value: `${Math.floor(health.uptime / 1000)}s`, status: 'ok' },
      ]);

      logger.newline();
      logger.subheader('Services');
      for (const [name, svc] of Object.entries(health.services)) {
        const status = svc.status === 'healthy' ? 'ok' : svc.status === 'not-configured' ? 'warn' : 'error';
        logger.table([{ label: name, value: svc.status, status }]);
      }

      logger.newline();
      logger.subheader('Storage Backends');
      for (const backend of health.backends.available) {
        const healthy = health.backends.health[backend];
        logger.table([{ label: backend, value: healthy ? 'healthy' : 'unhealthy', status: healthy ? 'ok' : 'error' }]);
      }

      if (health.decentralized) {
        logger.newline();
        logger.subheader('Decentralized');
        logger.keyValue('Identity Registry', health.decentralized.identityRegistry);
        logger.keyValue('Registered Nodes', String(health.decentralized.registeredNodes));
        logger.keyValue('Connected Peers', String(health.decentralized.connectedPeers));
        logger.keyValue('P2P Enabled', health.decentralized.p2pEnabled ? 'Yes' : 'No');
      }
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch {
    logger.table([{ label: 'DWS Server', value: 'Not running', status: 'error' }]);
    logger.newline();
    logger.info('Start DWS with: jeju dws start');
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
      ? 'https://rpc.testnet.jeju.network'
      : 'https://rpc.jeju.network';

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

async function uploadFile(filePath: string): Promise<void> {
  logger.header('UPLOAD FILE');

  if (!existsSync(filePath)) {
    logger.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const dwsUrl = getDwsUrl();
  const content = readFileSync(filePath);
  const filename = filePath.split('/').pop() || 'file';

  logger.keyValue('File', filePath);
  logger.keyValue('Size', `${content.length} bytes`);
  logger.newline();

  try {
    const response = await fetch(`${dwsUrl}/storage/upload/raw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-filename': filename,
      },
      body: content,
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    const result = (await response.json()) as { cid: string; backend: string; size: number };
    logger.success('Upload complete');
    logger.keyValue('CID', result.cid);
    logger.keyValue('Backend', result.backend);
    logger.newline();
    logger.info(`Download with: jeju dws download ${result.cid}`);
  } catch (error) {
    logger.error(`Upload failed: ${error}`);
    process.exit(1);
  }
}

async function downloadFile(cid: string, options: { output?: string }): Promise<void> {
  logger.header('DOWNLOAD FILE');

  const dwsUrl = getDwsUrl();
  const outputPath = options.output || cid;

  logger.keyValue('CID', cid);
  logger.keyValue('Output', outputPath);
  logger.newline();

  try {
    const response = await fetch(`${dwsUrl}/storage/download/${cid}`, {
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.error('File not found');
      } else {
        logger.error(`HTTP ${response.status}`);
      }
      process.exit(1);
    }

    const content = Buffer.from(await response.arrayBuffer());
    await Bun.write(outputPath, content);

    logger.success('Download complete');
    logger.keyValue('Size', `${content.length} bytes`);
    logger.keyValue('Saved to', outputPath);
  } catch (error) {
    logger.error(`Download failed: ${error}`);
    process.exit(1);
  }
}

async function listRepos(options: { user?: string; limit: string }): Promise<void> {
  logger.header('GIT REPOSITORIES');

  const dwsUrl = getDwsUrl();

  try {
    const url = options.user
      ? `${dwsUrl}/git/users/${options.user}/repos`
      : `${dwsUrl}/git/repos?limit=${options.limit}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as {
      repositories: Array<{
        repoId: string;
        owner: string;
        name: string;
        description: string;
        visibility: string;
        starCount: number;
        cloneUrl: string;
      }>;
      total?: number;
    };

    if (data.repositories.length === 0) {
      logger.info('No repositories found');
      return;
    }

    logger.info(`Found ${data.repositories.length} repositories:\n`);

    for (const repo of data.repositories) {
      const visibility = repo.visibility === 'private' ? '🔒' : '📦';
      console.log(`  ${visibility} ${repo.owner.slice(0, 8)}.../${repo.name}`);
      if (repo.description) console.log(`     ${repo.description}`);
      console.log(`     ⭐ ${repo.starCount} | Clone: ${repo.cloneUrl}`);
      console.log('');
    }
  } catch (error) {
    logger.error(`Failed to list repos: ${error}`);
    process.exit(1);
  }
}

async function getRepo(owner: string, name: string): Promise<void> {
  const dwsUrl = getDwsUrl();

  try {
    const response = await fetch(`${dwsUrl}/git/repos/${owner}/${name}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.error('Repository not found');
      } else {
        logger.error(`HTTP ${response.status}`);
      }
      process.exit(1);
    }

    const repo = (await response.json()) as {
      repoId: string;
      owner: string;
      name: string;
      description: string;
      visibility: string;
      starCount: number;
      forkCount: number;
      createdAt: number;
      updatedAt: number;
      defaultBranch: string;
      branches: Array<{ name: string; tipCommit: string; protected: boolean }>;
      cloneUrl: string;
    };

    logger.header('REPOSITORY DETAILS');
    logger.keyValue('Name', `${repo.owner.slice(0, 10)}.../${repo.name}`);
    logger.keyValue('ID', repo.repoId);
    logger.keyValue('Visibility', repo.visibility);
    if (repo.description) logger.keyValue('Description', repo.description);
    logger.keyValue('Stars', String(repo.starCount));
    logger.keyValue('Forks', String(repo.forkCount));
    logger.keyValue('Default Branch', repo.defaultBranch);
    logger.keyValue('Created', new Date(repo.createdAt * 1000).toISOString());
    logger.keyValue('Clone URL', repo.cloneUrl);

    if (repo.branches.length > 0) {
      logger.newline();
      logger.subheader('Branches');
      for (const branch of repo.branches) {
        const prot = branch.protected ? ' 🔒' : '';
        console.log(`  ${branch.name}${prot}`);
        console.log(`     Tip: ${branch.tipCommit.slice(0, 7)}`);
      }
    }
  } catch (error) {
    logger.error(`Failed to get repo: ${error}`);
    process.exit(1);
  }
}

async function createRepo(
  name: string,
  options: { description?: string; private?: boolean; address?: string }
): Promise<void> {
  logger.header('CREATE REPOSITORY');

  const dwsUrl = getDwsUrl();
  const address = options.address || getDefaultAddress();

  logger.keyValue('Name', name);
  logger.keyValue('Owner', address);
  if (options.description) logger.keyValue('Description', options.description);
  logger.keyValue('Visibility', options.private ? 'private' : 'public');
  logger.newline();

  try {
    const response = await fetch(`${dwsUrl}/git/repos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': address,
      },
      body: JSON.stringify({
        name,
        description: options.description || '',
        visibility: options.private ? 1 : 0,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(error);
    }

    const result = (await response.json()) as { repoId: string; cloneUrl: string };
    logger.success('Repository created');
    logger.keyValue('Repo ID', result.repoId);
    logger.keyValue('Clone URL', result.cloneUrl);
    logger.newline();
    logger.info(`Clone with: git clone ${result.cloneUrl}`);
  } catch (error) {
    logger.error(`Failed to create repo: ${error}`);
    process.exit(1);
  }
}

async function searchPackages(query: string, options: { limit: string }): Promise<void> {
  logger.header('PACKAGE SEARCH');

  const dwsUrl = getDwsUrl();

  logger.keyValue('Query', query);
  logger.newline();

  try {
    const params = new URLSearchParams({ text: query, size: options.limit });
    const response = await fetch(`${dwsUrl}/pkg/-/v1/search?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as {
      objects: Array<{
        package: {
          name: string;
          scope?: string;
          version: string;
          description: string;
          publisher: { username: string };
        };
      }>;
      total: number;
    };

    if (data.objects.length === 0) {
      logger.info('No packages found');
      return;
    }

    logger.info(`Found ${data.total} packages:\n`);

    for (const obj of data.objects) {
      const pkg = obj.package;
      console.log(`  📦 ${pkg.name}@${pkg.version}`);
      if (pkg.description) console.log(`     ${pkg.description}`);
      console.log(`     Publisher: ${pkg.publisher.username}`);
      console.log('');
    }
  } catch (error) {
    logger.error(`Search failed: ${error}`);
    process.exit(1);
  }
}

async function getPackageInfo(name: string): Promise<void> {
  const dwsUrl = getDwsUrl();
  const encodedName = encodeURIComponent(name).replace('%40', '@').replace('%2F', '/');

  try {
    const response = await fetch(`${dwsUrl}/pkg/${encodedName}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.error('Package not found');
      } else {
        logger.error(`HTTP ${response.status}`);
      }
      process.exit(1);
    }

    const pkg = (await response.json()) as {
      name: string;
      description?: string;
      'dist-tags'?: Record<string, string>;
      versions: Record<string, { version: string; description?: string }>;
      time?: Record<string, string>;
    };

    logger.header('PACKAGE INFO');
    logger.keyValue('Name', pkg.name);
    if (pkg.description) logger.keyValue('Description', pkg.description);
    
    if (pkg['dist-tags']) {
      logger.newline();
      logger.subheader('Tags');
      for (const [tag, version] of Object.entries(pkg['dist-tags'])) {
        logger.keyValue(tag, version);
      }
    }

    const versions = Object.keys(pkg.versions).sort().reverse().slice(0, 5);
    if (versions.length > 0) {
      logger.newline();
      logger.subheader('Recent Versions');
      for (const v of versions) {
        console.log(`  ${v}`);
      }
    }
  } catch (error) {
    logger.error(`Failed to get package info: ${error}`);
    process.exit(1);
  }
}

async function listWorkflows(repoId: string): Promise<void> {
  logger.header('CI WORKFLOWS');

  const dwsUrl = getDwsUrl();

  try {
    const response = await fetch(`${dwsUrl}/ci/workflows/${repoId}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as {
      workflows: Array<{
        workflowId: string;
        name: string;
        description: string;
        triggers: string[];
        jobs: Array<{ name: string; stepCount: number }>;
        active: boolean;
      }>;
    };

    if (data.workflows.length === 0) {
      logger.info('No workflows found');
      return;
    }

    logger.info(`Found ${data.workflows.length} workflows:\n`);

    for (const wf of data.workflows) {
      const active = wf.active ? '✅' : '⏸️';
      console.log(`  ${active} ${wf.name}`);
      console.log(`     ID: ${wf.workflowId}`);
      if (wf.description) console.log(`     ${wf.description}`);
      console.log(`     Triggers: ${wf.triggers.join(', ')}`);
      console.log(`     Jobs: ${wf.jobs.map((j) => j.name).join(', ')}`);
      console.log('');
    }
  } catch (error) {
    logger.error(`Failed to list workflows: ${error}`);
    process.exit(1);
  }
}

async function listRuns(repoId: string, options: { status?: string; limit: string }): Promise<void> {
  logger.header('CI RUNS');

  const dwsUrl = getDwsUrl();

  try {
    const params = new URLSearchParams({ limit: options.limit });
    if (options.status) params.set('status', options.status);

    const response = await fetch(`${dwsUrl}/ci/repos/${repoId}/runs?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as {
      runs: Array<{
        runId: string;
        workflowId: string;
        status: string;
        conclusion: string | null;
        branch: string;
        commitSha: string;
        startedAt: number;
        completedAt: number | null;
        duration: number;
      }>;
      total: number;
    };

    if (data.runs.length === 0) {
      logger.info('No runs found');
      return;
    }

    logger.info(`Found ${data.runs.length} of ${data.total} runs:\n`);

    for (const run of data.runs) {
      const statusIcon = run.conclusion === 'success' ? '✅' :
                         run.conclusion === 'failure' ? '❌' :
                         run.status === 'in_progress' ? '🔄' :
                         run.status === 'queued' ? '⏳' : '⏸️';
      console.log(`  ${statusIcon} ${run.runId.slice(0, 8)}...`);
      console.log(`     Branch: ${run.branch} @ ${run.commitSha}`);
      console.log(`     Status: ${run.status}${run.conclusion ? ` (${run.conclusion})` : ''}`);
      console.log(`     Duration: ${Math.round(run.duration / 1000)}s`);
      console.log('');
    }
  } catch (error) {
    logger.error(`Failed to list runs: ${error}`);
    process.exit(1);
  }
}

async function getRunDetails(runId: string): Promise<void> {
  const dwsUrl = getDwsUrl();

  try {
    const response = await fetch(`${dwsUrl}/ci/runs/${runId}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.error('Run not found');
      } else {
        logger.error(`HTTP ${response.status}`);
      }
      process.exit(1);
    }

    const run = (await response.json()) as {
      runId: string;
      workflowId: string;
      repoId: string;
      status: string;
      conclusion: string | null;
      branch: string;
      commitSha: string;
      triggeredBy: string;
      startedAt: number;
      completedAt: number | null;
      jobs: Array<{
        jobId: string;
        name: string;
        status: string;
        conclusion: string | null;
        steps: Array<{
          stepId: string;
          name: string;
          status: string;
          conclusion: string | null;
          exitCode: number | null;
        }>;
      }>;
    };

    logger.header('RUN DETAILS');
    logger.keyValue('Run ID', run.runId);
    logger.keyValue('Workflow ID', run.workflowId);
    logger.keyValue('Status', run.status);
    if (run.conclusion) logger.keyValue('Conclusion', run.conclusion);
    logger.keyValue('Branch', run.branch);
    logger.keyValue('Commit', run.commitSha);
    logger.keyValue('Triggered By', run.triggeredBy);
    logger.keyValue('Started', new Date(run.startedAt).toISOString());
    if (run.completedAt) logger.keyValue('Completed', new Date(run.completedAt).toISOString());

    if (run.jobs.length > 0) {
      logger.newline();
      logger.subheader('Jobs');
      for (const job of run.jobs) {
        const jobIcon = job.conclusion === 'success' ? '✅' :
                        job.conclusion === 'failure' ? '❌' :
                        job.status === 'in_progress' ? '🔄' : '⏳';
        console.log(`  ${jobIcon} ${job.name}`);
        
        for (const step of job.steps) {
          const stepIcon = step.conclusion === 'success' ? '✓' :
                           step.conclusion === 'failure' ? '✗' :
                           step.status === 'in_progress' ? '...' : '-';
          console.log(`     ${stepIcon} ${step.name}${step.exitCode !== null ? ` (exit: ${step.exitCode})` : ''}`);
        }
        console.log('');
      }
    }

    logger.newline();
    logger.info(`View logs: curl ${dwsUrl}/ci/runs/${runId}/logs`);
  } catch (error) {
    logger.error(`Failed to get run: ${error}`);
    process.exit(1);
  }
}

async function checkCdnStatus(): Promise<void> {
  logger.header('CDN STATUS');

  const dwsUrl = getDwsUrl();

  try {
    const response = await fetch(`${dwsUrl}/cdn/health`, {
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const health = (await response.json()) as {
        status: string;
        service: string;
        cache?: { entries: number; hitRate: number };
        edgeNodes?: number;
      };

      logger.table([
        { label: 'Status', value: health.status, status: health.status === 'healthy' ? 'ok' : 'error' },
        { label: 'Service', value: health.service, status: 'ok' },
      ]);

      if (health.cache) {
        logger.newline();
        logger.subheader('Cache');
        logger.keyValue('Entries', String(health.cache.entries));
        logger.keyValue('Hit Rate', `${(health.cache.hitRate * 100).toFixed(1)}%`);
      }

      if (health.edgeNodes !== undefined) {
        logger.keyValue('Edge Nodes', String(health.edgeNodes));
      }
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch {
    logger.table([{ label: 'CDN', value: 'Not available', status: 'error' }]);
  }
}

