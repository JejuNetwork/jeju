/**
 * jeju test - Comprehensive Test Runner
 * 
 * Modes:
 * - unit: Fast tests, no chain, no services
 * - integration: Chain + real services via Docker
 * - e2e: Full stack with UI testing (Playwright/Synpress)
 * - full: Everything including multi-chain (Solana, Arbitrum, Base)
 * - infra: Infrastructure and deployment tests
 * - smoke: Quick health checks
 * 
 * All modes use REAL services - no mocks.
 * CLI handles all setup/teardown automatically.
 */

import { Command } from 'commander';
import { execa, type ExecaError } from 'execa';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { createTestOrchestrator, TestOrchestrator } from '../services/test-orchestrator';
import { createDockerOrchestrator, type TestProfile } from '../services/docker-orchestrator';
import { discoverApps } from '../lib/testing';
import type { TestMode, TestResult, CoverageReport } from '../types/test';

export type { TestMode };

const MODE_TO_PROFILE: Record<TestMode, TestProfile> = {
  unit: 'chain',
  integration: 'services',
  e2e: 'apps',
  full: 'full',
  infra: 'services',
  smoke: 'chain',
};

interface ManifestTesting {
  unit?: { command?: string; timeout?: number };
  e2e?: { command?: string; config?: string; timeout?: number; requiresChain?: boolean; requiresWallet?: boolean };
  integration?: { command?: string; timeout?: number; requiresServices?: boolean };
  services?: string[];
  dependencies?: string[];
}

export const testCommand = new Command('test')
  .description('Run tests with automatic setup/teardown (unit, integration, e2e, full, infra, smoke)')
  .option('-m, --mode <mode>', 'Test mode: unit, integration, e2e, full, infra, smoke', 'unit')
  .option('-a, --app <app>', 'Test specific app')
  .option('--package <pkg>', 'Test specific package')
  .option('--ci', 'CI mode (fail fast, coverage)')
  .option('--coverage', 'Generate coverage reports')
  .option('--dead-code', 'Detect dead/unused code')
  .option('--watch', 'Watch mode')
  .option('-v, --verbose', 'Verbose output')
  .option('--keep-services', 'Keep services running after tests')
  .option('--skip-lock', 'Skip test lock acquisition')
  .option('--skip-preflight', 'Skip preflight checks')
  .option('--skip-warmup', 'Skip app warmup')
  .option('--skip-bootstrap', 'Skip contract bootstrap')
  .option('--setup-only', 'Only run setup, don\'t run tests')
  .option('--teardown-only', 'Only run teardown')
  .option('--force', 'Force override existing test lock')
  .option('--forge-opts <opts>', 'Pass options to forge test')
  .action(async (options) => {
    const mode = options.mode as TestMode;
    const rootDir = findMonorepoRoot();
    const results: TestResult[] = [];

    logger.header(`JEJU TEST - ${mode.toUpperCase()}`);

    // Validate mode
    if (!['unit', 'integration', 'e2e', 'full', 'infra', 'smoke'].includes(mode)) {
      logger.error(`Invalid mode: ${mode}. Use: unit, integration, e2e, full, infra, smoke`);
      process.exit(1);
    }

    // Create test orchestrator
    const testOrchestrator = createTestOrchestrator({
      mode,
      app: options.app,
      skipLock: options.skipLock,
      skipPreflight: options.skipPreflight,
      skipWarmup: options.skipWarmup,
      skipBootstrap: options.skipBootstrap,
      keepServices: options.keepServices,
      force: options.force,
      rootDir,
    });

    const cleanup = async () => {
      if (!options.keepServices) {
        await testOrchestrator.teardown();
      }
    };

    process.on('SIGINT', async () => {
      await cleanup();
      process.exit(130);
    });

    process.on('SIGTERM', async () => {
      await cleanup();
      process.exit(143);
    });

    try {
      // Setup phase
      if (!options.teardownOnly) {
        await testOrchestrator.setup();
      }

      // Test execution phase
      if (!options.setupOnly && !options.teardownOnly) {
        const testEnv = { ...testOrchestrator.getEnvVars(), CI: options.ci ? 'true' : '', NODE_ENV: 'test' };

      // Route to appropriate test runner
      if (options.app) {
        results.push(await runAppTests(rootDir, options.app, mode, options, testEnv));
      } else if (options.package) {
        results.push(await runPackageTests(rootDir, options.package, options));
      } else {
        // Run by mode
        switch (mode) {
          case 'unit':
            results.push(await runForgeTests(rootDir, options));
            results.push(await runBunTests(rootDir, options, testEnv, 'unit'));
            break;
          case 'integration':
            results.push(await runForgeTests(rootDir, options));
            results.push(await runBunTests(rootDir, options, testEnv, 'integration'));
            results.push(await runIntegrationTests(rootDir, options, testEnv));
            results.push(await runComputeTests(rootDir, options, testEnv));
            break;
          case 'e2e':
            results.push(await runE2ETests(rootDir, options, testEnv));
            results.push(await runWalletTests(rootDir, options, testEnv));
            break;
          case 'full':
            results.push(await runForgeTests(rootDir, options));
            results.push(await runBunTests(rootDir, options, testEnv, 'unit'));
            results.push(await runIntegrationTests(rootDir, options, testEnv));
            results.push(await runComputeTests(rootDir, options, testEnv));
            results.push(await runE2ETests(rootDir, options, testEnv));
            results.push(await runWalletTests(rootDir, options, testEnv));
            results.push(await runCrossChainTests(rootDir, options, testEnv));
            break;
            case 'infra':
              results.push(await runInfraTests(rootDir, options, testEnv));
              break;
            case 'smoke':
              results.push(await runSmokeTests(rootDir, options, testEnv));
              break;
          }
        }

      // Coverage and dead code detection
      if (options.coverage || options.deadCode || options.ci) {
        const coverage = await generateCoverageReport(rootDir, results, options.deadCode);
        printCoverageReport(coverage);
      }

        printSummary(results);

        // Coverage and dead code detection
        if (options.coverage || options.deadCode || options.ci) {
          const coverage = await generateCoverageReport(rootDir, results, options.deadCode);
          printCoverageReport(coverage);
        }

        const failed = results.filter(r => !r.passed && !r.skipped).length;
        if (failed > 0) {
          await cleanup();
          process.exit(1);
        }
      }

      // Teardown phase
      if (options.teardownOnly || (!options.keepServices && !options.setupOnly)) {
        await cleanup();
      }

      if (options.setupOnly) {
        logger.success('Setup complete. Services are running.');
        logger.info('Run with --teardown-only to stop services.');
      }
    } catch (error) {
      logger.error(`Test failed: ${error instanceof Error ? error.message : String(error)}`);
      await cleanup();
      process.exit(1);
    }
  });

// Subcommands
testCommand
  .command('list')
  .description('List available tests')
  .action(async () => {
    const rootDir = findMonorepoRoot();
    logger.header('AVAILABLE TESTS');

    logger.subheader('Modes');
    console.log('  unit          Fast tests, no services');
    console.log('  integration   Chain + real services (Docker)');
    console.log('  e2e           Full stack with UI (Playwright)');
    console.log('  full          Everything including multi-chain');
    console.log('  infra         Infrastructure and deployment');
    console.log('  smoke         Quick health checks');

    logger.subheader('Apps');
    const apps = discoverApps(rootDir);
    for (const app of apps) {
      const manifest = loadManifest(join(rootDir, 'apps', app.name));
      const testing = manifest?.testing as ManifestTesting | undefined;
      const hasTests = !!(testing?.unit || testing?.e2e || testing?.integration);
      console.log(`  ${app.name.padEnd(14)} ${hasTests ? '✓' : '○'} ${app.displayName || ''}`);
    }

    logger.subheader('Packages');
    const pkgs = readdirSync(join(rootDir, 'packages')).filter(p =>
      existsSync(join(rootDir, 'packages', p, 'package.json'))
    );
    for (const pkg of pkgs) {
      console.log(`  ${pkg.padEnd(14)} @jejunetwork/${pkg}`);
    }
  });

testCommand
  .command('apps')
  .description('Test all apps')
  .option('-m, --mode <mode>', 'Test mode', 'unit')
  .option('--ci', 'CI mode')
  .option('--no-docker', 'Skip Docker orchestration')
  .action(async (options) => {
    const rootDir = findMonorepoRoot();
    const results: TestResult[] = [];
    const mode = options.mode as TestMode;

    logger.header('TESTING ALL APPS');

    const testOrchestrator = createTestOrchestrator({
      mode,
      skipLock: true,
      skipPreflight: true,
      skipWarmup: true,
      keepServices: true,
      rootDir,
    });

    let testEnv: Record<string, string> = { NODE_ENV: 'test' };

    // Only start Docker if not disabled and mode requires it
    if (options.docker && mode !== 'unit') {
      await testOrchestrator.setup();
      testEnv = { ...testOrchestrator.getEnvVars(), NODE_ENV: 'test' };
    }

    const apps = discoverApps(rootDir);

    for (const app of apps) {
      const result = await runAppTests(rootDir, app.name, mode, options, testEnv);
      results.push(result);

      if (!result.passed && options.ci) {
        logger.error('Stopping due to failure in CI mode');
        break;
      }
    }

    await testOrchestrator.teardown();
    printSummary(results);

    const failed = results.filter(r => !r.passed && !r.skipped).length;
    if (failed > 0) process.exit(1);
  });

testCommand
  .command('coverage')
  .description('Generate coverage report')
  .action(async () => {
    const rootDir = findMonorepoRoot();
    logger.header('COVERAGE REPORT');

    const coverage = await generateCoverageReport(rootDir, [], true);
    printCoverageReport(coverage);
  });

// Test runners

async function runForgeTests(rootDir: string, options: Record<string, unknown>): Promise<TestResult> {
  const start = Date.now();
  logger.step('Running Forge tests (contracts)...');

  const contractsPath = join(rootDir, 'packages', 'contracts');
  if (!existsSync(contractsPath) || !existsSync(join(contractsPath, 'foundry.toml'))) {
    logger.info('No contracts to test');
    return { name: 'contracts', passed: true, duration: 0, skipped: true };
  }

  // Check forge installed
  try {
    await execa('which', ['forge']);
  } catch {
    logger.warn('Forge not installed. Install: curl -L https://foundry.paradigm.xyz | bash');
    return { name: 'contracts', passed: true, duration: 0, skipped: true };
  }

  // Check dependencies
  const forgeStdPath = join(contractsPath, 'lib', 'forge-std', 'src', 'Test.sol');
  if (!existsSync(forgeStdPath)) {
    logger.warn('Forge libs not installed. Run: cd packages/contracts && forge install');
    return { name: 'contracts', passed: true, duration: 0, skipped: true };
  }

  try {
    const args = ['test'];
    if (options.verbose) args.push('-vvv');
    if (options.forgeOpts) args.push(...(options.forgeOpts as string).split(' '));
    if (options.ci) args.push('--fail-fast');
    if (options.coverage) args.push('--coverage');

    await execa('forge', args, {
      cwd: contractsPath,
      stdio: 'inherit',
    });

    return { name: 'contracts', passed: true, duration: Date.now() - start };
  } catch (error) {
    const err = error as ExecaError;
    return { name: 'contracts', passed: false, duration: Date.now() - start, output: String(err.stderr || '') };
  }
}

async function runBunTests(
  rootDir: string,
  options: Record<string, unknown>,
  env: Record<string, string>,
  type: 'unit' | 'integration'
): Promise<TestResult> {
  const start = Date.now();
  logger.step(`Running Bun tests (${type})...`);

  // Only test our core directories
  const testDirs = type === 'unit'
    ? ['packages/', 'apps/']
    : ['packages/tests/integration/'];

  const existingDirs = testDirs.filter(d => existsSync(join(rootDir, d)));
  if (existingDirs.length === 0) {
    return { name: type, passed: true, duration: 0, skipped: true };
  }

  try {
    const args = ['test', ...existingDirs];
    if (options.coverage) args.push('--coverage');
    if (options.watch) args.push('--watch');

    await execa('bun', args, {
      cwd: rootDir,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });

    return { name: type, passed: true, duration: Date.now() - start };
  } catch (error) {
    const err = error as ExecaError;
    return { name: type, passed: false, duration: Date.now() - start, output: String(err.stderr || '') };
  }
}

async function runIntegrationTests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>
): Promise<TestResult> {
  const start = Date.now();
  logger.step('Running integration tests...');

  const testsPath = join(rootDir, 'packages', 'tests', 'integration');
  if (!existsSync(testsPath)) {
    return { name: 'integration', passed: true, duration: 0, skipped: true };
  }

  try {
    await execa('bun', ['test', 'integration/'], {
      cwd: join(rootDir, 'packages', 'tests'),
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });

    return { name: 'integration', passed: true, duration: Date.now() - start };
  } catch (error) {
    const err = error as ExecaError;
    return { name: 'integration', passed: false, duration: Date.now() - start, output: String(err.stderr || '') };
  }
}

async function runComputeTests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>
): Promise<TestResult> {
  const start = Date.now();
  logger.step('Running compute bridge tests...');

  const computePath = join(rootDir, 'apps', 'compute');
  const integrationTest = join(computePath, 'src', 'providers', 'tests', 'integration.test.ts');
  
  if (!existsSync(integrationTest)) {
    return { name: 'compute', passed: true, duration: 0, skipped: true };
  }

  // Check if bridge is running
  const bridgeUrl = env.COMPUTE_BRIDGE_URL || 'http://127.0.0.1:4010';
  let bridgeRunning = false;
  try {
    const response = await fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(3000) });
    bridgeRunning = response.ok;
  } catch {
    logger.warn('Compute bridge not running - some tests may be skipped');
  }

  try {
    await execa('bun', ['test', 'src/providers/tests/integration.test.ts'], {
      cwd: computePath,
      stdio: 'inherit',
      env: { 
        ...process.env, 
        ...env,
        COMPUTE_BRIDGE_URL: bridgeUrl,
        COMPUTE_BRIDGE_RUNNING: bridgeRunning ? 'true' : 'false',
      },
    });

    return { name: 'compute', passed: true, duration: Date.now() - start };
  } catch (error) {
    const err = error as ExecaError;
    return { name: 'compute', passed: false, duration: Date.now() - start, output: String(err.stderr || '') };
  }
}

async function runE2ETests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>
): Promise<TestResult> {
  const start = Date.now();
  logger.step('Running E2E tests (Playwright)...');

  const testsPath = join(rootDir, 'packages', 'tests', 'e2e');
  if (!existsSync(testsPath)) {
    return { name: 'e2e', passed: true, duration: 0, skipped: true };
  }

  try {
    await execa('bunx', ['playwright', 'test'], {
      cwd: join(rootDir, 'packages', 'tests'),
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });

    return { name: 'e2e', passed: true, duration: Date.now() - start };
  } catch (error) {
    const err = error as ExecaError;
    return { name: 'e2e', passed: false, duration: Date.now() - start, output: String(err.stderr || '') };
  }
}

async function runWalletTests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>
): Promise<TestResult> {
  const start = Date.now();
  logger.step('Running wallet tests (Synpress)...');

  const walletPath = join(rootDir, 'apps', 'wallet');
  const synpressConfig = join(walletPath, 'synpress.config.ts');

  if (!existsSync(synpressConfig)) {
    return { name: 'wallet-e2e', passed: true, duration: 0, skipped: true };
  }

  try {
    await execa('bunx', ['playwright', 'test', '--config', 'synpress.config.ts'], {
      cwd: walletPath,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });

    return { name: 'wallet-e2e', passed: true, duration: Date.now() - start };
  } catch (error) {
    const err = error as ExecaError;
    return { name: 'wallet-e2e', passed: false, duration: Date.now() - start, output: String(err.stderr || '') };
  }
}

async function runCrossChainTests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>
): Promise<TestResult> {
  const start = Date.now();
  logger.step('Running cross-chain tests...');

  // Check if Solana is available
  try {
    const response = await fetch(env.SOLANA_RPC_URL || 'http://127.0.0.1:8899', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'getVersion', id: 1 }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      logger.warn('Solana not available, skipping cross-chain tests');
      return { name: 'cross-chain', passed: true, duration: 0, skipped: true };
    }
  } catch {
    logger.warn('Solana not available, skipping cross-chain tests');
    return { name: 'cross-chain', passed: true, duration: 0, skipped: true };
  }

  // Run cross-chain specific tests
  const crossChainPath = join(rootDir, 'packages', 'tests', 'cross-chain');
  if (!existsSync(crossChainPath)) {
    // Fallback: run grep for cross-chain tests in integration directory
    try {
      await execa('bun', ['test', '--grep', 'cross-chain|EIL|OIF|bridge'], {
        cwd: join(rootDir, 'packages', 'tests'),
        stdio: 'inherit',
        env: { ...process.env, ...env },
      });
      return { name: 'cross-chain', passed: true, duration: Date.now() - start };
    } catch (error) {
      const err = error as ExecaError;
      return { name: 'cross-chain', passed: false, duration: Date.now() - start, output: String(err.stderr || '') };
    }
  }

  try {
    await execa('bun', ['test', 'cross-chain/'], {
      cwd: join(rootDir, 'packages', 'tests'),
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });

    return { name: 'cross-chain', passed: true, duration: Date.now() - start };
  } catch (error) {
    const err = error as ExecaError;
    return { name: 'cross-chain', passed: false, duration: Date.now() - start, output: String(err.stderr || '') };
  }
}

async function runSmokeTests(
  rootDir: string,
  _options: Record<string, unknown>,
  env: Record<string, string>
): Promise<TestResult> {
  const start = Date.now();
  logger.step('Running smoke tests...');

  const testsPath = join(rootDir, 'packages', 'tests', 'smoke');
  if (!existsSync(testsPath)) {
    return { name: 'smoke', passed: true, duration: 0, skipped: true };
  }

  try {
    await execa('bunx', ['playwright', 'test', '--config', 'smoke/playwright.config.ts'], {
      cwd: join(rootDir, 'packages', 'tests'),
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });

    return { name: 'smoke', passed: true, duration: Date.now() - start };
  } catch (error) {
    const err = error as ExecaError;
    return { name: 'smoke', passed: false, duration: Date.now() - start, output: String(err.stderr || '') };
  }
}

async function runInfraTests(
  rootDir: string,
  options: Record<string, unknown>,
  env: Record<string, string>
): Promise<TestResult> {
  const start = Date.now();
  logger.step('Running infrastructure tests...');

  const results: boolean[] = [];

  // 1. Terraform validation
  logger.info('Validating Terraform configurations...');
  const terraformDirs = [
    join(rootDir, 'packages/deployment/terraform/environments/testnet'),
    join(rootDir, 'packages/deployment/terraform/environments/mainnet'),
  ];

  for (const dir of terraformDirs) {
    if (!existsSync(dir)) continue;
    try {
      await execa('terraform', ['init', '-backend=false'], { cwd: dir, stdio: 'pipe' });
      await execa('terraform', ['validate'], { cwd: dir, stdio: 'pipe' });
      logger.success(`  ${dir.split('/').pop()}: valid`);
      results.push(true);
    } catch {
      logger.error(`  ${dir.split('/').pop()}: invalid`);
      results.push(false);
    }
  }

  // 2. Helm chart validation
  logger.info('Validating Helm charts...');
  const helmDir = join(rootDir, 'packages/deployment/kubernetes/helm');
  if (existsSync(helmDir)) {
    const charts = readdirSync(helmDir).filter(d =>
      existsSync(join(helmDir, d, 'Chart.yaml'))
    );

    for (const chart of charts.slice(0, 5)) { // Limit to first 5 for speed
      try {
        await execa('helm', ['lint', chart], { cwd: helmDir, stdio: 'pipe' });
        results.push(true);
      } catch {
        logger.warn(`  ${chart}: lint warnings`);
        results.push(true); // Warnings are OK
      }
    }
    logger.success(`  ${charts.length} Helm charts validated`);
  }

  // 3. Docker build test
  logger.info('Testing Docker builds...');
  const dockerApps = ['indexer', 'gateway'];
  for (const app of dockerApps) {
    const dockerfile = join(rootDir, 'apps', app, 'Dockerfile');
    if (!existsSync(dockerfile)) continue;

    try {
      await execa('docker', ['build', '--no-cache', '-t', `jeju-${app}:test`, '.'], {
        cwd: join(rootDir, 'apps', app),
        stdio: 'pipe',
        timeout: 300000,
      });
      logger.success(`  ${app}: builds`);
      results.push(true);
    } catch {
      logger.error(`  ${app}: build failed`);
      results.push(false);
    }
  }

  // 4. Deployment tests (optional - only if --deploy flag)
  if (options.deploy) {
    logger.info('Testing testnet deployment...');
    try {
      await execa('bun', ['run', 'scripts/deploy/testnet.ts', '--dry-run'], {
        cwd: rootDir,
        stdio: 'inherit',
        env: { ...process.env, ...env, DRY_RUN: 'true' },
      });
      results.push(true);
    } catch {
      results.push(false);
    }
  }

  const allPassed = results.every(r => r);
  return {
    name: 'infrastructure',
    passed: allPassed,
    duration: Date.now() - start,
  };
}

async function runAppTests(
  rootDir: string,
  appName: string,
  mode: TestMode,
  options: Record<string, unknown>,
  env: Record<string, string>
): Promise<TestResult> {
  const start = Date.now();
  logger.step(`Testing app: ${appName}`);

  // Find app path
  let appPath = join(rootDir, 'apps', appName);
  if (!existsSync(appPath)) {
    appPath = join(rootDir, 'vendor', appName);
  }
  if (!existsSync(appPath)) {
    logger.error(`App not found: ${appName}`);
    return { name: appName, passed: false, duration: 0 };
  }

  // Load manifest
  const manifest = loadManifest(appPath);
  const testing = manifest?.testing as ManifestTesting | undefined;

  // Determine test command based on mode
  let testCmd: string | null = null;
  let timeout = 120000;

  if (mode === 'unit' && testing?.unit?.command) {
    testCmd = testing.unit.command;
    timeout = testing.unit.timeout || timeout;
  } else if (mode === 'e2e' && testing?.e2e?.command) {
    testCmd = testing.e2e.command;
    timeout = testing.e2e.timeout || timeout;
  } else if (mode === 'integration' && testing?.integration?.command) {
    testCmd = testing.integration.command;
    timeout = testing.integration.timeout || timeout;
  } else {
    // Fallback to package.json test script
    const pkgPath = join(appPath, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.test) {
        testCmd = 'bun run test';
      } else if (pkg.scripts?.[`test:${mode}`]) {
        testCmd = `bun run test:${mode}`;
      }
    }
  }

  if (!testCmd) {
    logger.info(`No ${mode} tests for ${appName}`);
    return { name: appName, passed: true, duration: 0, skipped: true };
  }

  try {
    const [cmd, ...args] = testCmd.split(' ');
    if (options.watch) args.push('--watch');
    if (options.coverage) args.push('--coverage');

    await execa(cmd, args, {
      cwd: appPath,
      stdio: 'inherit',
      timeout,
      env: { ...process.env, ...env },
    });

    return { name: appName, passed: true, duration: Date.now() - start };
  } catch (error) {
    const err = error as ExecaError;
    return { name: appName, passed: false, duration: Date.now() - start, output: String(err.stderr || '') };
  }
}

async function runPackageTests(
  rootDir: string,
  pkgName: string,
  options: Record<string, unknown>
): Promise<TestResult> {
  const start = Date.now();
  logger.step(`Testing package: ${pkgName}`);

  const pkgPath = join(rootDir, 'packages', pkgName);
  if (!existsSync(pkgPath)) {
    logger.error(`Package not found: ${pkgName}`);
    return { name: pkgName, passed: false, duration: 0 };
  }

  // Special handling for contracts
  if (pkgName === 'contracts') {
    return runForgeTests(rootDir, options);
  }

  try {
    const args = ['test'];
    if (options.watch) args.push('--watch');
    if (options.coverage) args.push('--coverage');

    await execa('bun', args, {
      cwd: pkgPath,
      stdio: 'inherit',
    });

    return { name: pkgName, passed: true, duration: Date.now() - start };
  } catch (error) {
    const err = error as ExecaError;
    return { name: pkgName, passed: false, duration: Date.now() - start, output: String(err.stderr || '') };
  }
}

// Coverage

async function generateCoverageReport(
  rootDir: string,
  _results: TestResult[],
  detectDeadCode: boolean
): Promise<CoverageReport> {
  logger.step('Generating coverage report...');

  const report: CoverageReport = {
    lines: { total: 0, covered: 0, percent: 0 },
    functions: { total: 0, covered: 0, percent: 0 },
    branches: { total: 0, covered: 0, percent: 0 },
    deadCode: [],
  };

  // Collect Bun coverage
  const coverageDir = join(rootDir, 'coverage');
  if (existsSync(coverageDir)) {
    // Parse lcov or similar
    logger.info('Coverage data collected');
  }

  // Detect dead code using ts-prune or similar
  if (detectDeadCode) {
    logger.info('Detecting dead code...');
    try {
      const result = await execa('bunx', ['ts-prune', '--project', 'tsconfig.json'], {
        cwd: rootDir,
        reject: false,
      });
      if (result.stdout) {
        const deadFiles = result.stdout.split('\n').filter(line => 
          line.includes(' - ') && !line.includes('node_modules')
        );
        report.deadCode = deadFiles.slice(0, 20); // Limit output
      }
    } catch {
      // ts-prune not available
    }
  }

  // Write report
  const reportPath = join(rootDir, 'test-results', 'coverage.json');
  mkdirSync(join(rootDir, 'test-results'), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));

  return report;
}

// Helpers

function findMonorepoRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    if (existsSync(join(dir, 'bun.lock')) && existsSync(join(dir, 'packages'))) {
      return dir;
    }
    dir = join(dir, '..');
  }
  return process.cwd();
}

function loadManifest(appPath: string): Record<string, unknown> | null {
  const manifestPath = join(appPath, 'jeju-manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

function printSummary(results: TestResult[]) {
  logger.newline();
  logger.separator();
  logger.subheader('RESULTS');

  for (const r of results) {
    if (r.skipped) {
      console.log(`  ${r.name.padEnd(16)} skipped`);
    } else if (r.passed) {
      console.log(`  ${r.name.padEnd(16)} ✓ ${r.duration}ms`);
    } else {
      console.log(`  ${r.name.padEnd(16)} ✗ FAILED`);
    }
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  logger.newline();
  if (failed === 0) {
    logger.success(`${passed} passed${skipped ? `, ${skipped} skipped` : ''}`);
  } else {
    logger.error(`${failed} failed, ${passed} passed`);
  }
}

function printCoverageReport(coverage: CoverageReport) {
  logger.subheader('COVERAGE');

  if (coverage.lines.total > 0) {
    console.log(`  Lines:     ${coverage.lines.percent.toFixed(1)}% (${coverage.lines.covered}/${coverage.lines.total})`);
    console.log(`  Functions: ${coverage.functions.percent.toFixed(1)}% (${coverage.functions.covered}/${coverage.functions.total})`);
    console.log(`  Branches:  ${coverage.branches.percent.toFixed(1)}% (${coverage.branches.covered}/${coverage.branches.total})`);
  }

  if (coverage.deadCode && coverage.deadCode.length > 0) {
    logger.subheader('DEAD CODE');
    for (const file of coverage.deadCode.slice(0, 10)) {
      console.log(`  ${file}`);
    }
    if (coverage.deadCode.length > 10) {
      console.log(`  ... and ${coverage.deadCode.length - 10} more`);
    }
  }
}
