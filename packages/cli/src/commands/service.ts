/**
 * jeju service - Manage long-running network services
 * 
 * Services:
 * - auto-update: Automatic node updates
 * - bridge: Forced inclusion monitor
 * - dispute: Fraud proof challenger
 * - sequencer: Consensus coordinator
 */

import { Command } from 'commander';
import { spawn } from 'bun';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { findMonorepoRoot } from '../lib/system';
import { type NetworkType } from '../types';

const runningServices = new Map<string, ReturnType<typeof spawn>>();

export const serviceCommand = new Command('service')
  .description('Manage long-running network services')
  .addCommand(
    new Command('auto-update')
      .description('Auto-update manager (checks for new releases)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .option('--check-interval <ms>', 'Check interval in milliseconds', '3600000')
      .option('--auto', 'Enable automatic updates', false)
      .action(async (options) => {
        await startAutoUpdate(options);
      })
  )
  .addCommand(
    new Command('bridge')
      .description('Forced inclusion monitor (anti-censorship)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .option('--l1-rpc <url>', 'L1 RPC URL')
      .option('--monitor-key <key>', 'Monitor private key (optional)')
      .action(async (options) => {
        await startBridgeMonitor(options);
      })
  )
  .addCommand(
    new Command('dispute')
      .description('Fraud proof challenger service')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .option('--l1-rpc <url>', 'L1 RPC URL')
      .option('--l2-rpc <url>', 'L2 RPC URL')
      .option('--challenger-key <key>', 'Challenger private key')
      .option('--challenger-key-file <file>', 'Challenger private key file')
      .action(async (options) => {
        await startChallenger(options);
      })
  )
  .addCommand(
    new Command('sequencer')
      .description('Consensus coordinator (P2P signature collection)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .option('--l1-rpc <url>', 'L1 RPC URL')
      .option('--block-interval <ms>', 'Block interval in milliseconds', '2000')
      .option('--vote-ratio <ratio>', 'Vote ratio threshold', '0.67')
      .option('--signer-urls <urls>', 'Comma-separated signer URLs')
      .action(async (options) => {
        await startSequencer(options);
      })
  )
  .addCommand(
    new Command('list')
      .description('List running services')
      .action(() => {
        listServices();
      })
  )
  .addCommand(
    new Command('stop')
      .description('Stop a running service')
      .argument('<service>', 'Service name: auto-update, bridge, dispute, sequencer')
      .action(async (serviceName) => {
        await stopService(serviceName);
      })
  )
  .addCommand(
    new Command('stop-all')
      .description('Stop all running services')
      .action(async () => {
        await stopAllServices();
      })
  );

async function startAutoUpdate(options: { network: string; checkInterval: string; auto: boolean }) {
  const rootDir = findMonorepoRoot();
  const scriptPath = join(rootDir, 'scripts/auto-update/update-manager.ts');
  
  if (!existsSync(scriptPath)) {
    logger.error('Auto-update script not found');
    return;
  }

  logger.header('AUTO-UPDATE SERVICE');
  logger.info(`Network: ${options.network}`);
  logger.info(`Check interval: ${options.checkInterval}ms`);
  logger.info(`Auto-update: ${options.auto ? 'enabled' : 'disabled'}`);
  logger.newline();

  const env = {
    ...process.env,
    NETWORK: options.network,
    UPDATE_CHECK_INTERVAL: options.checkInterval,
    AUTO_UPDATE: options.auto ? 'true' : 'false',
  };

  const proc = spawn({
    cmd: ['bun', 'run', scriptPath],
    cwd: rootDir,
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  runningServices.set('auto-update', proc);
  
  logger.success('Auto-update service started');
  logger.info('Press Ctrl+C to stop');
  
  process.on('SIGINT', () => {
    proc.kill();
    process.exit(0);
  });

  await proc.exited;
}

async function startBridgeMonitor(options: { network: string; l1Rpc?: string; monitorKey?: string }) {
  const rootDir = findMonorepoRoot();
  const scriptPath = join(rootDir, 'scripts/bridge/forced-inclusion-monitor.ts');
  
  if (!existsSync(scriptPath)) {
    logger.error('Bridge monitor script not found');
    return;
  }

  logger.header('FORCED INCLUSION MONITOR');
  logger.info(`Network: ${options.network}`);
  if (options.l1Rpc) logger.info(`L1 RPC: ${options.l1Rpc}`);
  logger.newline();

  const env: Record<string, string> = {
    ...process.env,
    NETWORK: options.network,
  };

  if (options.l1Rpc) env.L1_RPC_URL = options.l1Rpc;
  if (options.monitorKey) env.MONITOR_PRIVATE_KEY = options.monitorKey;

  const proc = spawn({
    cmd: ['bun', 'run', scriptPath],
    cwd: rootDir,
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  runningServices.set('bridge', proc);
  
  logger.success('Bridge monitor started');
  logger.info('Press Ctrl+C to stop');
  
  process.on('SIGINT', () => {
    proc.kill();
    process.exit(0);
  });

  await proc.exited;
}

async function startChallenger(options: { network: string; l1Rpc?: string; l2Rpc?: string; challengerKey?: string; challengerKeyFile?: string }) {
  const rootDir = findMonorepoRoot();
  const scriptPath = join(rootDir, 'scripts/dispute/run-challenger.ts');
  
  if (!existsSync(scriptPath)) {
    logger.error('Challenger script not found');
    return;
  }

  logger.header('FRAUD PROOF CHALLENGER');
  logger.info(`Network: ${options.network}`);
  if (options.l1Rpc) logger.info(`L1 RPC: ${options.l1Rpc}`);
  if (options.l2Rpc) logger.info(`L2 RPC: ${options.l2Rpc}`);
  logger.newline();

  const env: Record<string, string> = {
    ...process.env,
    NETWORK: options.network,
  };

  if (options.l1Rpc) env.L1_RPC_URL = options.l1Rpc;
  if (options.l2Rpc) env.L2_RPC_URL = options.l2Rpc;
  if (options.challengerKey) env.CHALLENGER_PRIVATE_KEY = options.challengerKey;
  if (options.challengerKeyFile) env.CHALLENGER_PRIVATE_KEY_FILE = options.challengerKeyFile;

  const proc = spawn({
    cmd: ['bun', 'run', scriptPath],
    cwd: rootDir,
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  runningServices.set('dispute', proc);
  
  logger.success('Challenger service started');
  logger.info('Press Ctrl+C to stop');
  
  process.on('SIGINT', () => {
    proc.kill();
    process.exit(0);
  });

  await proc.exited;
}

async function startSequencer(options: { network: string; l1Rpc?: string; blockInterval?: string; voteRatio?: string; signerUrls?: string }) {
  const rootDir = findMonorepoRoot();
  const scriptPath = join(rootDir, 'scripts/sequencer/run-consensus.ts');
  
  if (!existsSync(scriptPath)) {
    logger.error('Sequencer script not found');
    return;
  }

  logger.header('CONSENSUS COORDINATOR');
  logger.info(`Network: ${options.network}`);
  logger.info(`Block interval: ${options.blockInterval}ms`);
  logger.info(`Vote ratio: ${options.voteRatio}`);
  if (options.l1Rpc) logger.info(`L1 RPC: ${options.l1Rpc}`);
  if (options.signerUrls) logger.info(`Signer URLs: ${options.signerUrls}`);
  logger.newline();

  const env: Record<string, string> = {
    ...process.env,
    NETWORK: options.network,
    BLOCK_INTERVAL: options.blockInterval || '2000',
    VOTE_RATIO: options.voteRatio || '0.67',
  };

  if (options.l1Rpc) env.L1_RPC_URL = options.l1Rpc;
  if (options.signerUrls) {
    const urls = options.signerUrls.split(',');
    urls.forEach((url, i) => {
      env[`SIGNER_${i + 1}_URL`] = url.trim();
    });
  }

  const proc = spawn({
    cmd: ['bun', 'run', scriptPath],
    cwd: rootDir,
    env,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  runningServices.set('sequencer', proc);
  
  logger.success('Consensus coordinator started');
  logger.info('Press Ctrl+C to stop');
  
  process.on('SIGINT', () => {
    proc.kill();
    process.exit(0);
  });

  await proc.exited;
}

function listServices() {
  logger.header('RUNNING SERVICES');
  
  if (runningServices.size === 0) {
    logger.info('No services running');
    return;
  }

  for (const [name, proc] of runningServices) {
    logger.table([{
      label: name,
      value: `PID: ${proc.pid}`,
      status: 'ok',
    }]);
  }
}

async function stopService(serviceName: string) {
  const proc = runningServices.get(serviceName);
  if (!proc) {
    logger.warn(`Service '${serviceName}' is not running`);
    return;
  }

  logger.step(`Stopping ${serviceName}...`);
  proc.kill();
  runningServices.delete(serviceName);
  logger.success(`Stopped ${serviceName}`);
}

async function stopAllServices() {
  if (runningServices.size === 0) {
    logger.info('No services running');
    return;
  }

  logger.step(`Stopping ${runningServices.size} service(s)...`);
  
  for (const [name, proc] of runningServices) {
    proc.kill();
  }
  
  runningServices.clear();
  logger.success('All services stopped');
}

