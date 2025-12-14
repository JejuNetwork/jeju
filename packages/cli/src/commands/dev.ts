/**
 * jeju dev - Start development environment
 */

import { Command } from 'commander';
import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { startLocalnet, stopLocalnet, getChainStatus, bootstrapContracts } from '../lib/chain';
import { discoverApps } from '../lib/testing';
import { DEFAULT_PORTS, WELL_KNOWN_KEYS, type AppManifest } from '../types';

interface RunningService {
  name: string;
  port?: number;
  process?: ReturnType<typeof execa>;
}

const runningServices: RunningService[] = [];
let isShuttingDown = false;

export const devCommand = new Command('dev')
  .description('Start development environment')
  .option('--minimal', 'Localnet only (no apps)')
  .option('--only <apps>', 'Start specific apps (comma-separated)')
  .option('--skip <apps>', 'Skip specific apps (comma-separated)')
  .option('--stop', 'Stop the development environment')
  .action(async (options) => {
    if (options.stop) {
      await stopDev();
      return;
    }

    await startDev(options);
  });

async function startDev(options: { minimal?: boolean; only?: string; skip?: string }) {
  logger.header('JEJU DEV');

  const rootDir = process.cwd();
  setupSignalHandlers();

  // Check if already running
  const status = await getChainStatus('localnet');
  if (status.running) {
    logger.success('Chain already running (block ' + status.blockNumber + ')');
  } else {
    // Start localnet
    logger.step('Starting localnet...');
    const { l2Port } = await startLocalnet(rootDir);
    logger.success('Localnet running on port ' + l2Port);
  }

  const l2RpcUrl = `http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`;

  // Bootstrap contracts
  logger.step('Bootstrapping contracts...');
  await bootstrapContracts(rootDir, l2RpcUrl);

  if (options.minimal) {
    printReady(l2RpcUrl, []);
    await waitForever();
    return;
  }

  // Start indexer
  await startIndexer(rootDir, l2RpcUrl);

  // Discover and start apps
  const apps = discoverApps(rootDir);
  const appsToStart = filterApps(apps, options);

  logger.step(`Starting ${appsToStart.length} apps...`);
  for (const app of appsToStart) {
    await startApp(rootDir, app, l2RpcUrl);
  }

  printReady(l2RpcUrl, runningServices);
  await waitForever();
}

async function stopDev() {
  logger.header('STOPPING');

  logger.step('Stopping localnet...');
  await stopLocalnet();
  logger.success('Stopped');
}

function setupSignalHandlers() {
  const cleanup = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.newline();
    logger.step('Shutting down...');

    for (const service of runningServices) {
      if (service.process) {
        service.process.kill('SIGTERM');
      }
    }

    // Stop monitoring
    await execa('docker', ['compose', 'down'], {
      cwd: join(process.cwd(), 'apps/monitoring'),
      reject: false,
    }).catch(() => {});

    logger.success('Stopped');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

function filterApps(apps: AppManifest[], options: { only?: string; skip?: string }): AppManifest[] {
  let filtered = apps.filter(app =>
    app.enabled !== false &&
    app.autoStart !== false &&
    app.name !== 'indexer' &&
    app.name !== 'monitoring'
  );

  if (options.only) {
    const only = options.only.split(',').map(s => s.trim());
    filtered = filtered.filter(app => only.includes(app.name));
  }

  if (options.skip) {
    const skip = options.skip.split(',').map(s => s.trim());
    filtered = filtered.filter(app => !skip.includes(app.name));
  }

  return filtered;
}

async function startIndexer(rootDir: string, rpcUrl: string): Promise<void> {
  const indexerDir = join(rootDir, 'apps/indexer');
  if (!existsSync(indexerDir)) {
    return;
  }

  logger.step('Starting indexer...');

  const proc = execa('bun', ['run', 'dev'], {
    cwd: indexerDir,
    env: {
      ...process.env,
      RPC_ETH_HTTP: rpcUrl,
      START_BLOCK: '0',
      CHAIN_ID: '1337',
      GQL_PORT: String(DEFAULT_PORTS.indexerGraphQL),
    },
    stdio: 'pipe',
  });

  runningServices.push({
    name: 'Indexer',
    port: DEFAULT_PORTS.indexerGraphQL,
    process: proc,
  });

  await new Promise(r => setTimeout(r, 3000));
}

async function startApp(rootDir: string, app: AppManifest, rpcUrl: string): Promise<void> {
  const appDir = join(rootDir, 'apps', app.name);
  const vendorDir = join(rootDir, 'vendor', app.name);
  const dir = existsSync(appDir) ? appDir : vendorDir;

  if (!existsSync(dir)) return;

  const devCommand = app.commands?.dev;
  if (!devCommand) return;

  const mainPort = app.ports?.main;
  const appEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    JEJU_RPC_URL: rpcUrl,
    RPC_URL: rpcUrl,
    CHAIN_ID: '1337',
  };

  if (mainPort) {
    appEnv.PORT = String(mainPort);
  }

  const [cmd, ...args] = devCommand.split(' ');
  const proc = execa(cmd, args, {
    cwd: dir,
    env: appEnv,
    stdio: 'pipe',
  });

  runningServices.push({
    name: app.displayName || app.name,
    port: mainPort,
    process: proc,
  });

  proc.catch(() => {});
}

function printReady(rpcUrl: string, services: RunningService[]) {
  console.clear();

  logger.header('READY');
  logger.info('Press Ctrl+C to stop\n');

  logger.subheader('Chain');
  logger.table([
    { label: 'L1 RPC', value: `http://127.0.0.1:${DEFAULT_PORTS.l1Rpc}`, status: 'ok' },
    { label: 'L2 RPC', value: rpcUrl, status: 'ok' },
  ]);

  if (services.length > 0) {
    logger.subheader('Services');
    for (const svc of services) {
      const url = svc.port ? `http://127.0.0.1:${svc.port}` : 'running';
      logger.table([{ label: svc.name, value: url, status: 'ok' }]);
    }
  }

  logger.subheader('Test Wallet');
  const deployer = WELL_KNOWN_KEYS.dev[0];
  logger.keyValue('Address', deployer.address);
  logger.keyValue('Key', deployer.privateKey.slice(0, 20) + '...');
  logger.warn('Well-known test key - DO NOT use on mainnet');
}

async function waitForever(): Promise<void> {
  await new Promise(() => {});
}
