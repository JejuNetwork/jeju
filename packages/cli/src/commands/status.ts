/**
 * jeju status - System status and diagnostics
 */

import { Command } from 'commander';
import { logger } from '../lib/logger';
import { getChainStatus, getAccountBalance } from '../lib/chain';
import { discoverApps } from '../lib/testing';
import {
  checkDocker,
  checkKurtosis,
  checkFoundry,
  checkBun,
  checkSocat,
  getSystemInfo,
  isPortAvailable,
} from '../lib/system';
import { getDevKeys, hasKeys } from '../lib/keys';
import { DEFAULT_PORTS, WELL_KNOWN_KEYS, type NetworkType } from '../types';

export const statusCommand = new Command('status')
  .description('Check system status and running services')
  .option('-n, --network <network>', 'Network', 'localnet')
  .option('--check', 'Run full system check')
  .action(async (options) => {
    const network = options.network as NetworkType;

    if (options.check) {
      await fullCheck(network);
    } else {
      await quickStatus(network);
    }
  });

async function quickStatus(network: NetworkType) {
  logger.header('STATUS');

  // Chain status
  const chainStatus = await getChainStatus(network);
  
  logger.subheader('Chain');
  if (chainStatus.running) {
    logger.table([
      { label: 'Network', value: network, status: 'ok' },
      { label: 'Chain ID', value: String(chainStatus.chainId), status: 'ok' },
      { label: 'Block', value: String(chainStatus.blockNumber), status: 'ok' },
    ]);
  } else {
    logger.table([
      { label: 'Network', value: network, status: 'warn' },
      { label: 'Status', value: 'Not running', status: 'warn' },
    ]);
    logger.info('Start with: jeju dev');
    return;
  }

  // Services
  logger.subheader('Services');
  
  const services = [
    { name: 'L1 RPC', port: DEFAULT_PORTS.l1Rpc },
    { name: 'L2 RPC', port: DEFAULT_PORTS.l2Rpc },
    { name: 'Indexer', port: DEFAULT_PORTS.indexerGraphQL },
  ];

  for (const svc of services) {
    const running = !(await isPortAvailable(svc.port));
    logger.table([{
      label: svc.name,
      value: running ? `http://127.0.0.1:${svc.port}` : 'stopped',
      status: running ? 'ok' : 'warn',
    }]);
  }

  // Apps
  try {
    const apps = discoverApps(process.cwd());
    const runningApps: string[] = [];
    
    for (const app of apps.slice(0, 5)) {
      if (app.ports?.main) {
        const running = !(await isPortAvailable(app.ports.main));
        if (running) {
          runningApps.push(app.displayName || app.name);
        }
      }
    }
    
    if (runningApps.length > 0) {
      logger.subheader('Apps');
      for (const name of runningApps) {
        logger.table([{ label: name, value: 'running', status: 'ok' }]);
      }
    }
  } catch {
    // Not in workspace
  }

  // Test wallet
  if (chainStatus.running && network === 'localnet') {
    const deployer = WELL_KNOWN_KEYS.dev[0];
    const balance = await getAccountBalance(
      `http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`,
      deployer.address as `0x${string}`
    );
    
    logger.subheader('Test Wallet');
    logger.keyValue('Address', deployer.address);
    logger.keyValue('Balance', `${balance} ETH`);
  }
}

async function fullCheck(network: NetworkType) {
  logger.header('SYSTEM CHECK');
  let hasErrors = false;
  let hasWarnings = false;

  // System
  logger.subheader('System');
  const sys = getSystemInfo();
  logger.table([
    { label: 'OS', value: sys.os, status: 'ok' },
    { label: 'Arch', value: sys.arch, status: 'ok' },
  ]);

  // Dependencies
  logger.subheader('Dependencies');
  
  const deps = [
    await checkDocker(),
    await checkKurtosis(),
    await checkFoundry(),
    await checkBun(),
    await checkSocat(),
  ];

  for (const dep of deps) {
    logger.table([{ label: dep.name, value: dep.message, status: dep.status }]);
    if (dep.status === 'error') hasErrors = true;
    if (dep.status === 'warn') hasWarnings = true;
  }

  // Chain
  logger.subheader('Chain');
  const chainStatus = await getChainStatus(network);
  
  if (chainStatus.running) {
    logger.table([
      { label: 'RPC', value: `http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`, status: 'ok' },
      { label: 'Block', value: String(chainStatus.blockNumber), status: 'ok' },
    ]);
  } else {
    logger.table([
      { label: 'Chain', value: 'Not running', status: network === 'localnet' ? 'warn' : 'ok' },
    ]);
    if (network === 'localnet') hasWarnings = true;
  }

  // Keys
  logger.subheader('Keys');
  const devKeys = getDevKeys();
  logger.table([
    { label: 'Localnet', value: `${devKeys.length} dev keys`, status: 'ok' },
    { label: 'Testnet', value: hasKeys('testnet') ? 'configured' : 'not set', status: hasKeys('testnet') ? 'ok' : 'warn' },
    { label: 'Mainnet', value: hasKeys('mainnet') ? 'configured' : 'not set', status: hasKeys('mainnet') ? 'ok' : 'warn' },
  ]);

  // Ports
  logger.subheader('Ports');
  const ports = [
    { name: 'L1 RPC', port: DEFAULT_PORTS.l1Rpc },
    { name: 'L2 RPC', port: DEFAULT_PORTS.l2Rpc },
    { name: 'Gateway', port: DEFAULT_PORTS.gateway },
  ];

  for (const { name, port } of ports) {
    const available = await isPortAvailable(port);
    logger.table([{
      label: name,
      value: `${port} (${available ? 'available' : 'in use'})`,
      status: 'ok',
    }]);
  }

  // Summary
  logger.newline();
  logger.separator();
  
  if (hasErrors) {
    logger.error('System has issues that need fixing');
  } else if (hasWarnings) {
    logger.warn('System ready with some warnings');
    logger.info('Start development: jeju dev');
  } else {
    logger.success('System ready');
  }
}
