/**
 * Test orchestration utilities
 */

import { execa } from 'execa';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { logger } from './logger';
import { checkRpcHealth } from './chain';
import type { TestPhase, TestResult, AppManifest } from '../types';

export interface TestOptions {
  phase?: string;
  app?: string;
  ci?: boolean;
  coverage?: boolean;
  watch?: boolean;
  verbose?: boolean;
}

const TEST_PHASES: TestPhase[] = [
  {
    name: 'preflight',
    description: 'Chain connectivity and health checks',
    command: 'bun run packages/tests/shared/preflight.ts',
    timeout: 30000,
    required: true,
  },
  {
    name: 'contracts',
    description: 'Solidity smart contract tests',
    command: 'forge test -vv',
    cwd: 'packages/contracts',
    timeout: 120000,
    required: true,
  },
  {
    name: 'unit',
    description: 'TypeScript unit tests',
    command: 'bun test scripts/shared/',
    timeout: 60000,
    required: false,
  },
  {
    name: 'packages',
    description: 'Package tests (config, types)',
    command: 'bun test packages/config/',
    timeout: 30000,
    required: false,
  },
  {
    name: 'integration',
    description: 'Cross-service integration tests',
    command: 'bun test packages/tests/integration/',
    timeout: 180000,
    required: false,
  },
  {
    name: 'e2e',
    description: 'Playwright E2E tests',
    command: 'bunx playwright test',
    timeout: 300000,
    required: false,
  },
  {
    name: 'wallet',
    description: 'Synpress wallet tests',
    command: 'bunx playwright test --config synpress.config.ts',
    timeout: 600000,
    required: false,
  },
];

export function getTestPhases(options: TestOptions): TestPhase[] {
  if (options.phase) {
    const phase = TEST_PHASES.find(p => p.name === options.phase);
    if (!phase) {
      throw new Error(`Unknown test phase: ${options.phase}. Available: ${TEST_PHASES.map(p => p.name).join(', ')}`);
    }
    return [phase];
  }
  
  // By default, run preflight + contracts + unit
  // Skip wallet tests unless explicitly requested
  return TEST_PHASES.filter(p => 
    p.name !== 'wallet' && p.name !== 'e2e'
  );
}

export async function runPreflightChecks(_rootDir: string, rpcUrl: string): Promise<TestResult> {
  const startTime = Date.now();
  
  logger.step('Running preflight checks...');
  
  // Check RPC connectivity
  const rpcHealthy = await checkRpcHealth(rpcUrl, 5000);
  if (!rpcHealthy) {
    return {
      name: 'preflight',
      passed: false,
      duration: Date.now() - startTime,
      output: `RPC not responding: ${rpcUrl}`,
    };
  }
  
  logger.success('Chain is healthy');
  
  return {
    name: 'preflight',
    passed: true,
    duration: Date.now() - startTime,
  };
}

export async function runTestPhase(
  phase: TestPhase,
  rootDir: string,
  options: TestOptions
): Promise<TestResult> {
  const startTime = Date.now();
  const cwd = phase.cwd ? join(rootDir, phase.cwd) : rootDir;
  
  logger.step(`Running ${phase.name}: ${phase.description}`);
  logger.debug(`Command: ${phase.command}`);
  logger.debug(`Directory: ${cwd}`);
  
  // Check if required files exist
  if (!existsSync(cwd)) {
    logger.warn(`Directory not found: ${cwd}`);
    return {
      name: phase.name,
      passed: true,
      duration: Date.now() - startTime,
      skipped: true,
      output: 'Skipped (directory not found)',
    };
  }
  
  try {
    const result = await execa('sh', ['-c', phase.command], {
      cwd,
      timeout: phase.timeout,
      stdio: options.verbose ? 'inherit' : 'pipe',
      env: {
        ...process.env,
        CI: options.ci ? 'true' : undefined,
      },
    });
    
    const duration = Date.now() - startTime;
    logger.success(`${phase.name} passed (${(duration / 1000).toFixed(2)}s)`);
    
    return {
      name: phase.name,
      passed: true,
      duration,
      output: result.stdout,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const err = error as { stdout?: string; stderr?: string; message?: string };
    
    if (phase.required) {
      logger.error(`${phase.name} failed (required)`);
    } else {
      logger.warn(`${phase.name} failed (optional)`);
    }
    
    return {
      name: phase.name,
      passed: false,
      duration,
      output: err.stderr || err.stdout || err.message || 'Unknown error',
    };
  }
}

export async function runAppTests(
  appName: string,
  rootDir: string,
  options: TestOptions
): Promise<TestResult[]> {
  const results: TestResult[] = [];
  
  // Find app directory
  const appPaths = [
    join(rootDir, 'apps', appName),
    join(rootDir, 'vendor', appName),
  ];
  
  let appDir: string | null = null;
  for (const path of appPaths) {
    if (existsSync(path)) {
      appDir = path;
      break;
    }
  }
  
  if (!appDir) {
    throw new Error(`App not found: ${appName}`);
  }
  
  // Check for package.json
  const pkgPath = join(appDir, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new Error(`No package.json found in ${appDir}`);
  }
  
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  
  // Run unit tests if available
  if (pkg.scripts?.test) {
    const phase: TestPhase = {
      name: `${appName}-unit`,
      description: `Unit tests for ${appName}`,
      command: 'bun run test',
      cwd: appDir,
      timeout: 120000,
    };
    results.push(await runTestPhase(phase, rootDir, options));
  }
  
  // Run playwright tests if available
  if (existsSync(join(appDir, 'playwright.config.ts'))) {
    const phase: TestPhase = {
      name: `${appName}-e2e`,
      description: `E2E tests for ${appName}`,
      command: 'bunx playwright test',
      cwd: appDir,
      timeout: 300000,
    };
    results.push(await runTestPhase(phase, rootDir, options));
  }
  
  // Run synpress tests if available
  if (existsSync(join(appDir, 'synpress.config.ts'))) {
    const phase: TestPhase = {
      name: `${appName}-wallet`,
      description: `Wallet tests for ${appName}`,
      command: 'bunx playwright test --config synpress.config.ts',
      cwd: appDir,
      timeout: 600000,
    };
    results.push(await runTestPhase(phase, rootDir, options));
  }
  
  return results;
}

export function discoverApps(rootDir: string, includeVendor = false): AppManifest[] {
  const apps: AppManifest[] = [];
  
  // Only include 'apps' directory by default, vendor apps are optional
  const directories = includeVendor ? ['apps', 'vendor'] : ['apps'];
  
  for (const dir of directories) {
    const baseDir = join(rootDir, dir);
    if (!existsSync(baseDir)) continue;
    
    const entries = readdirSync(baseDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      
      const manifestPath = join(baseDir, entry.name, 'jeju-manifest.json');
      if (!existsSync(manifestPath)) continue;
      
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as AppManifest;
      apps.push(manifest);
    }
  }
  
  return apps;
}

export function printTestSummary(results: TestResult[]): void {
  logger.newline();
  logger.separator();
  logger.subheader('Test Summary');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  
  for (const result of results) {
    const icon = result.passed ? '✓' : '✗';
    const status = result.passed ? 'PASS' : 'FAIL';
    const time = `${(result.duration / 1000).toFixed(2)}s`;
    logger.info(`  ${icon} ${result.name.padEnd(20)} ${status.padEnd(6)} ${time}`);
  }
  
  logger.separator();
  logger.info(`  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  logger.info(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  logger.separator();
  
  if (failed > 0) {
    logger.error(`${failed} test(s) failed`);
  } else {
    logger.success('All tests passed');
  }
}

