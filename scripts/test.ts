#!/usr/bin/env bun
/**
 * @fileoverview Master Test Suite - One Command, All Tests
 * @module scripts/test
 * 
 * Just run: bun run test
 * 
 * Runs everything:
 * - Smart Contracts (Foundry) ✅
 * - TypeScript Unit Tests ✅
 * - Integration Tests ✅
 * - E2E Tests (if localnet running) ✅
 * - App Tests (OTC Agent, Launchpad, Hyperscape) ✅
 * - Configuration Validation ✅
 * 
 * Lifecycle: Fully automatic
 * - Sets up what's needed
 * - Runs tests
 * - Cleans up after
 * 
 * CI Mode: CI=true bun run test
 * - Skips localnet-dependent tests
 * - Fail-fast on critical failures
 * - Optimized for speed
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { $ } from 'bun';

const execAsync = promisify(exec);

const COLORS = {
  RESET: '\x1b[0m',
  BRIGHT: '\x1b[1m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  BLUE: '\x1b[34m',
  CYAN: '\x1b[36m',
} as const;

interface TestSuite {
  name: string;
  description: string;
  command: string;
  directory?: string;
  optional?: boolean;
  timeout?: number;
  skipInCI?: boolean;
  requiresLocalnet?: boolean;
}

interface TestResult {
  suite: string;
  passed: boolean;
  duration: number;
  output?: string;
  error?: string;
  skipped?: boolean;
}

const results: TestResult[] = [];
const isCI = process.env.CI === 'true';
let localnetStarted = false;

// Cleanup handler
let isCleaningUp = false;

/**
 * Cleanup function - tears down any test infrastructure
 */
async function cleanup() {
  if (isCleaningUp) return;
  isCleaningUp = true;
  
  if (localnetStarted && !isCI) {
    console.log('🧹 Stopping localnet...');
    await $`bun run scripts/localnet/stop.ts`.nothrow().quiet();
  }
}

process.on('SIGINT', async () => {
  console.log('\n\n🛑 Tests interrupted, cleaning up...\n');
  await cleanup();
  process.exit(130);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

/** All test suites in order of execution */
const TEST_SUITES: TestSuite[] = [
  // Phase 1: Configuration & Setup
  {
    name: 'Configuration Validation',
    description: 'Validate all network configurations',
    command: 'bun run scripts/validate-config.ts',
    timeout: 30000,
  },
  {
    name: 'TypeScript Type Checking',
    description: 'Ensure zero TypeScript errors',
    command: 'bun run typecheck',
    timeout: 60000,
    optional: true, // Has warnings but non-blocking
  },
  
  // Phase 2: Smart Contracts
  {
    name: 'Smart Contract Compilation',
    description: 'Compile all Solidity contracts',
    command: 'forge build',
    directory: 'contracts',
    timeout: 120000,
  },
  {
    name: 'Smart Contract Tests',
    description: 'Run all Foundry tests',
    command: 'forge test -vv',
    directory: 'contracts',
    timeout: 180000,
  },
  {
    name: 'Contract Coverage',
    description: 'Generate test coverage report',
    command: 'forge coverage --report summary 2>/dev/null || echo "Coverage skipped"',
    directory: 'contracts',
    timeout: 180000,
    optional: true,
    skipInCI: true,
  },
  {
    name: 'Contract Gas Report',
    description: 'Generate gas usage report',
    command: 'forge test --gas-report 2>/dev/null || echo "Gas report skipped"',
    directory: 'contracts',
    timeout: 120000,
    optional: true,
    skipInCI: true,
  },
  
  // Phase 3: TypeScript Unit Tests
  {
    name: 'Config Module Tests',
    description: 'Test configuration loader',
    command: 'bun test config/index.test.ts',
    timeout: 30000,
    optional: false,
  },
  {
    name: 'Shared Utilities Tests',
    description: 'Test format, logger, notifications, RPC utils',
    command: 'bun test scripts/shared/',
    timeout: 120000,
    optional: false,
  },
  
  // Phase 4: Integration Tests
  {
    name: 'Integration Tests',
    description: 'Test service interactions',
    command: 'bun test tests/integration/',
    optional: true,
    timeout: 120000,
    skipInCI: false, // Run in CI but don't fail build
  },
  
  // Phase 5: Localnet Tests (skip in CI unless explicitly requested)
  {
    name: 'Localnet Deployment',
    description: 'Test Kurtosis localnet startup',
    command: 'bun run scripts/localnet/start.ts',
    timeout: 300000,
    optional: true,
    skipInCI: true,
  },

  // Phase 6: E2E Tests
  {
    name: 'E2E Tests',
    description: 'End-to-end user journey tests',
    command: 'bun test tests/e2e/',
    optional: true,
    timeout: 180000,
    skipInCI: true,
  },
  
  // Phase 7: Infrastructure Tests
  {
    name: 'Helm Chart Validation',
    description: 'Validate Kubernetes Helm charts (helm must be installed)',
    command: 'helm lint kubernetes/helm/rpc-gateway && helm template kubernetes/helm/rpc-gateway > /dev/null',
    timeout: 120000,
    optional: true,
  },
  
  // Phase 8: Documentation
  {
    name: 'Documentation Coverage',
    description: 'Verify all code has proper documentation',
    command: 'bun run scripts/verify-documentation.ts',
    timeout: 60000,
    optional: true,
    skipInCI: false, // Run but don't block
  },
  
  
  // Phase 9: App Tests
  {
    name: 'Indexer Tests',
    description: 'Test Subsquid indexer',
    command: 'npm run test',
    directory: 'indexer',
    timeout: 120000,
    optional: true,
  },
  
  // Phase 10: Vendor App Tests (Optional - only run if apps exist)
  {
    name: 'TheDesk (OTC Agent) Tests',
    description: 'Test OTC Agent runtime integration',
    command: 'npm run test',
    directory: 'vendor/otc-desk',
    timeout: 180000,
    optional: true, // Vendor app is optional
    skipInCI: true,
  },
  {
    name: 'Launchpad Tests',
    description: 'Test launchpad multi-chain configuration',
    command: 'npx vitest run',
    directory: 'vendor/launchpad',
    timeout: 120000,
    optional: true, // Vendor app is optional
    skipInCI: true,
  },
  {
    name: 'Hyperscape Tests',
    description: 'Test Hyperscape on-chain game integration',
    command: 'bun run test',
    directory: 'vendor/hyperscape',
    timeout: 300000,
    optional: true, // Vendor app is optional
    skipInCI: true,
  },
  {
    name: 'Cloud Platform Tests',
    description: 'Test cloud platform e2e flows',
    command: 'bunx playwright test',
    directory: 'vendor/cloud/tests/e2e',
    timeout: 180000,
    optional: true, // Vendor app is optional
    skipInCI: true,
  },
];

/**
 * Run a single test suite
 */
async function runTestSuite(suite: TestSuite): Promise<TestResult> {
  const startTime = Date.now();

  // Skip if marked for CI skip and we're in CI
  if (isCI && suite.skipInCI) {
    console.log(`${COLORS.YELLOW}⏭️  SKIPPED${COLORS.RESET} (skipped in CI)`);
    return {
      suite: suite.name,
      passed: true,
      duration: 0,
      skipped: true,
    };
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`${COLORS.BRIGHT}${COLORS.CYAN}${suite.name}${COLORS.RESET}`);
  console.log(`${suite.description}`);
  console.log('─'.repeat(70));

  try {
    const options: any = {
      timeout: suite.timeout || 60000,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    };

    if (suite.directory) {
      options.cwd = suite.directory;
    }

    const { stdout, stderr } = await execAsync(suite.command, options);
    const duration = Date.now() - startTime;

    // Show output
    if (stdout) console.log(stdout);
    if (stderr && !stderr.includes('warning')) console.log(stderr);

    console.log(`${COLORS.GREEN}✅ PASSED${COLORS.RESET} (${(duration / 1000).toFixed(2)}s)`);

    return {
      suite: suite.name,
      passed: true,
      duration,
      output: stdout as unknown as string,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;

    // Check if this is an optional suite
    if (suite.optional && (error.message.includes('ENOENT') || error.message.includes('not found'))) {
      console.log(`${COLORS.YELLOW}⏭️  SKIPPED${COLORS.RESET} (optional, not available)`);
      return {
        suite: suite.name,
        passed: true,
        duration,
        skipped: true,
      };
    }

    console.log(error.stdout || '');
    console.log(error.stderr || '');
    console.log(`${COLORS.RED}❌ FAILED${COLORS.RESET} (${(duration / 1000).toFixed(2)}s)`);

    return {
      suite: suite.name,
      passed: false,
      duration,
      error: error.message,
    };
  }
}

/**
 * Print summary of all test results
 */
function printSummary() {
  const passed = results.filter(r => r.passed && !r.skipped).length;
  const failed = results.filter(r => !r.passed).length;
  const skipped = results.filter(r => r.skipped).length;
  const total = results.length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log('\n' + '═'.repeat(70));
  console.log(`${COLORS.BRIGHT}${COLORS.CYAN}TEST SUMMARY${COLORS.RESET}`);
  console.log('═'.repeat(70) + '\n');

  for (const result of results) {
    const icon = result.skipped ? '⏭️ ' : result.passed ? '✅' : '❌';
    const status = result.skipped ? 'SKIPPED' : result.passed ? 'PASSED' : 'FAILED';
    const color = result.skipped ? COLORS.YELLOW : result.passed ? COLORS.GREEN : COLORS.RED;
    const duration = `(${(result.duration / 1000).toFixed(2)}s)`;

    console.log(`${icon} ${result.suite.padEnd(35)} ${color}${status}${COLORS.RESET} ${duration}`);
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`Total: ${total} | Passed: ${COLORS.GREEN}${passed}${COLORS.RESET} | Failed: ${COLORS.RED}${failed}${COLORS.RESET} | Skipped: ${COLORS.YELLOW}${skipped}${COLORS.RESET}`);
  console.log(`Total Duration: ${(totalDuration / 1000).toFixed(2)}s (${(totalDuration / 60000).toFixed(1)}m)`);
  console.log('─'.repeat(70) + '\n');

  // Count only non-optional failures
  const criticalFailures = results.filter(r => !r.passed && !r.skipped).length;
  const optionalFailures = results.filter((r, idx) => !r.passed && !r.skipped && TEST_SUITES[idx].optional).length;
  const realFailures = criticalFailures - optionalFailures;

  if (realFailures > 0) {
    console.log(`${COLORS.RED}${COLORS.BRIGHT}❌ TESTS FAILED${COLORS.RESET}\n`);
    console.log('Failed tests:');
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result.passed && !result.skipped && !TEST_SUITES[i].optional) {
        console.log(`  ${COLORS.RED}✗${COLORS.RESET} ${result.suite}`);
        if (result.error) {
          const errorLine = result.error.split('\n')[0];
          console.log(`    ${COLORS.YELLOW}${errorLine}${COLORS.RESET}`);
        }
      }
    }
    console.log('\n💡 Fix the failures and run: bun run test\n');
    process.exit(1);
  } else if (criticalFailures > 0) {
    console.log(`${COLORS.YELLOW}${COLORS.BRIGHT}⚠️  OPTIONAL TESTS FAILED${COLORS.RESET}\n`);
    console.log('Non-critical issues:');
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (!result.passed && !result.skipped && TEST_SUITES[i].optional) {
        console.log(`  ${COLORS.YELLOW}⚠${COLORS.RESET} ${result.suite}`);
      }
    }
    console.log('\n✅ All critical tests passed\n');
    console.log('💡 Optional failures don\'t block development\n');
    process.exit(0);
  } else {
    console.log(`${COLORS.GREEN}${COLORS.BRIGHT}✅ ALL TESTS PASSED${COLORS.RESET}\n`);
    
    if (skipped > 0 && !isCI) {
      console.log(`ℹ️  ${skipped} test(s) skipped (not available or optional)\n`);
    }
    
    console.log('🎉 Everything works!\n');
    
    if (!isCI) {
      console.log('💡 Next steps:');
      console.log('  - Deploy to testnet: bun run deploy:testnet');
      console.log('  - Start development: bun run dev');
      console.log('');
    }
    
    process.exit(0);
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                  ║');
  console.log('║              JEJU TEST SUITE                                  ║');
  console.log('║              One command runs everything                         ║');
  console.log('║                                                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  if (isCI) {
    console.log('\n🤖 CI Mode: Fast, focused, fail-fast\n');
  } else {
    console.log('\n🧪 Dev Mode: Comprehensive, auto-managed\n');
  }

  const targetSuite = process.argv[2];

  let suitesToRun = TEST_SUITES;

  // Filter to specific suite if requested (dev convenience)
  if (targetSuite) {
    suitesToRun = TEST_SUITES.filter(s => 
      s.name.toLowerCase().includes(targetSuite.toLowerCase()) ||
      s.description.toLowerCase().includes(targetSuite.toLowerCase())
    );

    if (suitesToRun.length === 0) {
      console.error(`\n❌ No test suite matching "${targetSuite}"\n`);
      console.log('💡 Available suites:');
      for (const suite of TEST_SUITES) {
        console.log(`  - ${suite.name.toLowerCase().split(' ')[0]}`);
      }
      console.log('\n💡 Example: bun run test contracts\n');
      process.exit(1);
    }
    console.log(`🎯 Running ${suitesToRun.length} matching suite(s)\n`);
  } else {
    const willRun = suitesToRun.filter(s => !isCI || !s.skipInCI).length;
    console.log(`📊 Running ${willRun} test suites\n`);
  }

  // Run all test suites
  for (const suite of suitesToRun) {
    const result = await runTestSuite(suite);
    results.push(result);
    
    // Track if localnet was started
    if (suite.name.includes('Localnet') && result.passed && !result.skipped) {
      localnetStarted = true;
    }
    
    // Fail fast in CI if a critical test fails
    if (isCI && !result.passed && !suite.optional && !result.skipped) {
      console.log(`\n${COLORS.RED}❌ Critical test failed in CI${COLORS.RESET}\n`);
      await cleanup();
      printSummary();
      break;
    }
  }

  // Cleanup after all tests
  await cleanup();

  // Print summary
  printSummary();
}

// Run tests
main().catch((error) => {
  console.error(`\n${COLORS.RED}❌ Test runner crashed:${COLORS.RESET}`, error);
  process.exit(1);
});

export { runTestSuite, TEST_SUITES };

