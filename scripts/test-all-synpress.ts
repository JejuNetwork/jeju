#!/usr/bin/env bun
/**
 * Unified Synpress Test Runner for All Apps
 * Starts infrastructure, then runs all synpress tests across apps
 */

import { spawn } from 'child_process';
import { Logger } from './shared/logger';
import { existsSync } from 'fs';
import path from 'path';

const logger = new Logger('test-all-synpress');

interface AppTestConfig {
  name: string;
  dir: string;
  port: number;
  hasSynpressTests: boolean;
  testCommand?: string;
  devCommand?: string;
}

const APPS_WITH_SYNPRESS: AppTestConfig[] = [
  {
    name: 'bazaar',
    dir: 'apps/bazaar',
    port: 4006,
    hasSynpressTests: true,
    testCommand: 'bun run test:e2e',
    devCommand: 'bun run dev'
  },
  {
    name: 'gateway',
    dir: 'apps/gateway',
    port: 4001,
    hasSynpressTests: true,
    testCommand: 'bun run test:e2e',
    devCommand: 'bun run dev'
  },
  {
    name: 'leaderboard',
    dir: 'apps/leaderboard',
    port: 3000,
    hasSynpressTests: true,
    testCommand: 'bun run test:e2e',
    devCommand: 'bun run dev'
  },
  {
    name: 'predimarket',
    dir: 'apps/predimarket',
    port: 4005,
    hasSynpressTests: true,
    testCommand: 'bun run test:e2e:wallet',
    devCommand: 'bun run dev'
  },
  {
    name: 'crucible',
    dir: 'apps/crucible',
    port: 3001,
    hasSynpressTests: true,
    testCommand: 'bun run test:e2e',
    devCommand: 'bun run dev'
  }
];

interface TestResult {
  app: string;
  passed: boolean;
  duration: number;
  screenshotsGenerated: number;
  error?: string;
}

async function runCommand(command: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command.split(' ');
    const proc = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: true
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', (error) => {
      logger.error(`Command error: ${error.message}`);
      resolve(false);
    });
  });
}

async function waitForPort(port: number, timeout = 60000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}`);
      if (response.ok || response.status < 500) {
        return true;
      }
    } catch {
      // Port not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

async function countScreenshots(appDir: string): Promise<number> {
  const screenshotDir = path.join(appDir, 'test-results', 'screenshots');
  if (!existsSync(screenshotDir)) {
    return 0;
  }

  try {
    const { spawn } = await import('child_process');
    return new Promise((resolve) => {
      const proc = spawn('find', [screenshotDir, '-name', '*.png', '-type', 'f'], {
        cwd: process.cwd()
      });

      let count = 0;
      proc.stdout.on('data', (data) => {
        count += data.toString().split('\n').filter((line: string) => line.trim()).length;
      });

      proc.on('close', () => {
        resolve(count);
      });

      proc.on('error', () => {
        resolve(0);
      });
    });
  } catch {
    return 0;
  }
}

async function verifyScreenshotsUnique(appDir: string): Promise<boolean> {
  const screenshotDir = path.join(appDir, 'test-results', 'screenshots');
  if (!existsSync(screenshotDir)) {
    return false;
  }

  try {
    // Get all screenshot files
    const { spawn } = await import('child_process');
    const files = await new Promise<string[]>((resolve) => {
      const proc = spawn('find', [screenshotDir, '-name', '*.png', '-type', 'f'], {
        cwd: process.cwd()
      });

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', () => {
        resolve(output.split('\n').filter(line => line.trim()));
      });

      proc.on('error', () => {
        resolve([]);
      });
    });

    if (files.length === 0) return false;

    // Check file sizes (if all same size, likely blank/same)
    const sizes = new Set<number>();
    for (const file of files) {
      try {
        const stat = await Bun.file(file).size;
        sizes.add(stat);
      } catch {
        // Ignore errors
      }
    }

    // If we have multiple screenshots but only 1 unique size, they might be blank/same
    if (files.length > 1 && sizes.size === 1) {
      logger.warn(`Warning: All screenshots have the same size (${Array.from(sizes)[0]} bytes)`);
      return false;
    }

    // Check that screenshots are not too small (likely blank)
    const tooSmall = Array.from(sizes).filter(size => size < 1000); // Less than 1KB
    if (tooSmall.length > 0) {
      logger.warn(`Warning: Found ${tooSmall.length} screenshots smaller than 1KB (likely blank)`);
      return false;
    }

    return true;
  } catch (error) {
    logger.error(`Error verifying screenshots: ${error}`);
    return false;
  }
}

async function runAppTests(app: AppTestConfig): Promise<TestResult> {
  const startTime = Date.now();

  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`📋 Testing: ${app.name}`);
  logger.info('='.repeat(60));

  try {
    // Check if app directory exists
    if (!existsSync(app.dir)) {
      return {
        app: app.name,
        passed: false,
        duration: Date.now() - startTime,
        screenshotsGenerated: 0,
        error: 'Directory not found'
      };
    }

    // Clean old screenshots
    const screenshotDir = path.join(app.dir, 'test-results', 'screenshots');
    if (existsSync(screenshotDir)) {
      await runCommand(`rm -rf ${screenshotDir}`, process.cwd());
    }

    // Wait for app to be ready (assuming dev infrastructure is running)
    logger.info(`⏳ Waiting for ${app.name} on port ${app.port}...`);
    const isReady = await waitForPort(app.port, 30000);
    if (!isReady) {
      logger.warn(`⚠️  Port ${app.port} not ready, skipping ${app.name}`);
      return {
        app: app.name,
        passed: false,
        duration: Date.now() - startTime,
        screenshotsGenerated: 0,
        error: 'Port not ready'
      };
    }

    // Run tests
    logger.info(`🧪 Running tests for ${app.name}...`);
    const passed = await runCommand(app.testCommand || 'bun run test:e2e', app.dir);

    // Count and verify screenshots
    const screenshotsGenerated = await countScreenshots(app.dir);
    const screenshotsUnique = await verifyScreenshotsUnique(app.dir);

    logger.info(`📸 Screenshots generated: ${screenshotsGenerated}`);
    logger.info(`✓ Screenshots unique: ${screenshotsUnique ? 'Yes' : 'No'}`);

    if (!screenshotsUnique && screenshotsGenerated > 0) {
      logger.warn(`⚠️  Screenshots may not be unique or contain blank images`);
    }

    return {
      app: app.name,
      passed: passed && screenshotsGenerated > 0 && screenshotsUnique,
      duration: Date.now() - startTime,
      screenshotsGenerated
    };
  } catch (error) {
    return {
      app: app.name,
      passed: false,
      duration: Date.now() - startTime,
      screenshotsGenerated: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  logger.info('═══════════════════════════════════════════════════');
  logger.info('   Unified Synpress Test Runner - Jeju Project');
  logger.info('═══════════════════════════════════════════════════\n');

  // Check if infrastructure is running
  logger.info('🔍 Checking infrastructure...');
  const l2Ready = await waitForPort(9545, 5000); // L2 RPC
  if (!l2Ready) {
    logger.error('❌ Infrastructure not running! Please start it first:');
    logger.error('   bun run dev');
    process.exit(1);
  }
  logger.success('✅ Infrastructure is running\n');

  const results: TestResult[] = [];

  for (const app of APPS_WITH_SYNPRESS) {
    const result = await runAppTests(app);
    results.push(result);

    if (!result.passed) {
      logger.warn(`⚠️  ${app.name} tests failed or incomplete`);
    }
  }

  // Print summary
  logger.info('\n' + '═'.repeat(60));
  logger.info('📊 Test Results Summary');
  logger.info('═'.repeat(60) + '\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalScreenshots = results.reduce((sum, r) => sum + r.screenshotsGenerated, 0);

  results.forEach(result => {
    const icon = result.passed ? '✓' : '✗';
    const color = result.passed ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';

    logger.info(
      `${color}${icon}${reset} ${result.app.padEnd(20)} ${result.screenshotsGenerated} screenshots ${(result.duration / 1000).toFixed(2)}s`
    );

    if (result.error) {
      logger.info(`  └─ Error: ${result.error}`);
    }
  });

  logger.info('\n' + '-'.repeat(60));
  logger.info(`Total: ${results.length} apps`);
  logger.info(`${passed} passed, ${failed} failed`);
  logger.info(`${totalScreenshots} total screenshots generated`);
  logger.info('-'.repeat(60) + '\n');

  if (failed === 0 && totalScreenshots > 0) {
    logger.success('🎉 All tests passed with screenshots!');
    process.exit(0);
  } else {
    logger.warn(`⚠️  ${failed} app(s) failed or generated no screenshots`);
    process.exit(1);
  }
}

main();

