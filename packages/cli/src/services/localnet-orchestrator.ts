/**
 * Localnet Orchestrator
 * 
 * Manages Kurtosis localnet lifecycle:
 * - Start/stop localnet
 * - Port forwarding
 * - Contract bootstrap
 * - Health checks
 */

import { execa } from 'execa';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { startLocalnet, stopLocalnet, bootstrapContracts, checkRpcHealth, loadPortsConfig } from '../lib/chain';
import { DEFAULT_PORTS } from '../types';

export interface LocalnetStatus {
  running: boolean;
  l1Rpc?: string;
  l2Rpc?: string;
  chainId?: number;
  bootstrapped?: boolean;
}

export class LocalnetOrchestrator {
  private rootDir: string;
  private started: boolean = false;
  private bootstrapped: boolean = false;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async start(): Promise<void> {
    if (this.started) {
      logger.debug('Localnet already started');
      return;
    }

    logger.step('Starting localnet...');
    
    const ports = await startLocalnet(this.rootDir);
    this.started = true;
    
    logger.success(`Localnet running (L1: ${ports.l1Port}, L2: ${ports.l2Port})`);
  }

  async bootstrap(): Promise<void> {
    if (this.bootstrapped) {
      logger.debug('Contracts already bootstrapped');
      return;
    }

    const ports = loadPortsConfig(this.rootDir);
    if (!ports) {
      throw new Error('Localnet not running - cannot bootstrap');
    }

    const l2RpcUrl = `http://127.0.0.1:${ports.l2Port}`;
    
    logger.step('Bootstrapping contracts...');
    await bootstrapContracts(this.rootDir, l2RpcUrl);
    this.bootstrapped = true;
    
    logger.success('Contracts bootstrapped');
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    logger.step('Stopping localnet...');
    await stopLocalnet();
    this.started = false;
    this.bootstrapped = false;
    
    logger.success('Localnet stopped');
  }

  async waitForReady(timeout = 60000): Promise<boolean> {
    const ports = loadPortsConfig(this.rootDir);
    if (!ports) {
      return false;
    }

    const l2RpcUrl = `http://127.0.0.1:${ports.l2Port}`;
    return await checkRpcHealth(l2RpcUrl, timeout);
  }

  getEnvVars(): Record<string, string> {
    const ports = loadPortsConfig(this.rootDir);
    if (!ports) {
      return {};
    }

    return {
      L1_RPC_URL: `http://127.0.0.1:${ports.l1Port}`,
      L2_RPC_URL: `http://127.0.0.1:${ports.l2Port}`,
      JEJU_RPC_URL: `http://127.0.0.1:${ports.l2Port}`,
      CHAIN_ID: '1337',
    };
  }

  getStatus(): LocalnetStatus {
    const ports = loadPortsConfig(this.rootDir);
    if (!ports) {
      return { running: false };
    }

    const bootstrapFile = join(this.rootDir, 'packages/contracts/deployments/localnet-complete.json');
    
    return {
      running: this.started,
      l1Rpc: `http://127.0.0.1:${ports.l1Port}`,
      l2Rpc: `http://127.0.0.1:${ports.l2Port}`,
      chainId: 1337,
      bootstrapped: existsSync(bootstrapFile),
    };
  }
}

export function createLocalnetOrchestrator(rootDir: string): LocalnetOrchestrator {
  return new LocalnetOrchestrator(rootDir);
}

