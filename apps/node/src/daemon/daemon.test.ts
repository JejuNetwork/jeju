/**
 * Daemon CLI Tests
 * 
 * Tests all CLI commands for headless operation
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, rmSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { saveConfig } from './index';
import { execSync } from 'child_process';

const TEST_DIR = join(tmpdir(), 'jeju-node-test-' + Date.now());
const TEST_CONFIG_PATH = join(TEST_DIR, 'config.json');

function runDaemon(args: string): string {
  try {
    return execSync(`cd ${process.cwd()} && bun run src/daemon/index.ts ${args}`, {
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, HOME: TEST_DIR },
    });
  } catch (e: Error | unknown) {
    const error = e as { stdout?: string; stderr?: string };
    return error.stdout || error.stderr || '';
  }
}

describe('Daemon CLI', () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, '.jeju-node'), { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('Help Command', () => {
    test('--help shows usage', () => {
      const output = runDaemon('--help');
      expect(output).toContain('Usage:');
      expect(output).toContain('Commands:');
      expect(output).toContain('init');
      expect(output).toContain('start');
      expect(output).toContain('status');
      expect(output).toContain('config');
      expect(output).toContain('wallet');
      expect(output).toContain('register');
    });
  });

  describe('Config Command', () => {
    test('config shows current configuration', () => {
      const output = runDaemon('config');
      expect(output).toContain('Current Configuration');
      expect(output).toContain('network');
      expect(output).toContain('services');
    });

    test('config set updates values', () => {
      runDaemon('config set network testnet');
      const output = runDaemon('config get network');
      expect(output.trim()).toContain('testnet');
    });

    test('config set handles boolean values', () => {
      runDaemon('config set services.oracle true');
      const output = runDaemon('config get services.oracle');
      expect(output.trim()).toContain('true');
    });

    test('config set handles numeric values', () => {
      runDaemon('config set computeConfig.cpuCores 8');
      const output = runDaemon('config get computeConfig.cpuCores');
      expect(output.trim()).toContain('8');
    });
  });

  describe('Status Command', () => {
    test('status shows node status', () => {
      const output = runDaemon('status');
      expect(output).toContain('Network Node Status');
      expect(output).toContain('Network:');
      expect(output).toContain('Hardware:');
      expect(output).toContain('Configured Services:');
    });

    test('status shows hardware info', () => {
      const output = runDaemon('status');
      expect(output).toContain('CPU:');
      expect(output).toContain('RAM:');
      expect(output).toContain('GPU:');
      expect(output).toContain('Docker:');
    });
  });

  describe('Wallet Command', () => {
    test('wallet shows usage without args', () => {
      const output = runDaemon('wallet');
      expect(output).toContain('wallet generate');
      expect(output).toContain('wallet import');
      expect(output).toContain('wallet balance');
    });
  });

  describe('Register Command', () => {
    test('register requires wallet or shows usage', () => {
      const output = runDaemon('register');
      // Either shows usage or requires wallet
      const hasUsage = output.includes('register compute');
      const requiresWallet = output.includes('wallet');
      expect(hasUsage || requiresWallet).toBe(true);
    });

    test('register compute requires wallet', () => {
      const output = runDaemon('register compute');
      expect(output).toContain('wallet');
    });
  });

  describe('Config File Operations', () => {
    test('saveConfig creates config file', () => {
      const config = {
        version: '1.0.0',
        network: 'localnet' as const,
        rpcUrl: 'http://127.0.0.1:8545',
        chainId: 1337,
        privateKey: '',
        walletAddress: '',
        services: {
          compute: false,
          storage: false,
          oracle: false,
          proxy: false,
          cron: true,
          rpc: false,
          xlp: false,
          solver: false,
          sequencer: false,
        },
        computeConfig: {
          type: 'cpu' as const,
          cpuCores: 4,
          gpuIds: [],
          useDocker: true,
          pricePerHour: '0.01',
          acceptNonTee: false,
        },
        bots: {
          dex_arb: false,
          cross_chain_arb: false,
          sandwich: false,
          liquidation: false,
          oracle_keeper: false,
          solver: false,
        },
        botConfig: {
          capitalAllocation: '1.0',
          maxGasGwei: 50,
          minProfitBps: 50,
        },
        autoClaim: true,
        autoStake: false,
        autoClaimThreshold: '0.1',
        logLevel: 'info' as const,
      };

      saveConfig(config, TEST_CONFIG_PATH);
      expect(existsSync(TEST_CONFIG_PATH)).toBe(true);

      const saved = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
      expect(saved.network).toBe('localnet');
      expect(saved.services.cron).toBe(true);
    });
  });
});

describe('Headless Workflow', () => {
  test('complete headless setup workflow', () => {
    // 1. Check initial status
    let output = runDaemon('status');
    expect(output).toContain('Network Node Status');

    // 2. Configure network
    runDaemon('config set network testnet');
    output = runDaemon('config get network');
    expect(output.trim()).toContain('testnet');

    // 3. Enable services
    runDaemon('config set services.compute true');
    runDaemon('config set services.cron true');
    runDaemon('config set services.oracle true');

    // 4. Configure compute
    runDaemon('config set computeConfig.cpuCores 4');
    runDaemon('config set computeConfig.pricePerHour 0.02');
    runDaemon('config set computeConfig.acceptNonTee true');

    // 5. Verify configuration
    output = runDaemon('status');
    expect(output).toContain('compute: Enabled');
    expect(output).toContain('cron: Enabled');
    expect(output).toContain('oracle: Enabled');

    console.log('✓ Headless workflow test passed');
  });
});
