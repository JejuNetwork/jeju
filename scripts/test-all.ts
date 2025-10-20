#!/usr/bin/env bun
/**
 * Master Test Runner
 * Runs all tests across the entire project
 */

import { spawn } from 'child_process';
import { Logger } from './shared/logger';

const logger = new Logger('test-all');

interface TestSuite {
  name: string;
  command: string;
  cwd?: string;
  required: boolean;
}

const TEST_SUITES: TestSuite[] = [
  // Cloud E2E tests
  {
    name: 'Cloud Integration E2E',
    command: 'bun test tests/e2e/cloud-simple.test.ts',
    required: true
  },
  
  // Shared utilities tests
  {
    name: 'Logger Tests',
    command: 'bun test scripts/shared/logger.test.ts',
    required: false
  },
  {
    name: 'Format Tests',
    command: 'bun test scripts/shared/format.test.ts',
    required: false
  },
  {
    name: 'RPC Tests',
    command: 'bun test scripts/shared/rpc.test.ts',
    required: false
  },
  {
    name: 'Notifications Tests',
    command: 'bun test scripts/shared/notifications.test.ts',
    required: false
  },
  {
    name: 'Network Ban Cache Tests',
    command: 'bun test scripts/shared/__tests__/NetworkBanCache.test.ts',
    required: false
  },
  
  // Config tests
  {
    name: 'Config Tests',
    command: 'bun test config/index.test.ts',
    required: false
  },
  
  // Integration tests
  {
    name: 'Deep Integration Tests',
    command: 'bun test tests/integration/deep-integration.test.ts',
    required: false
  },
  
  // Contract tests (Foundry)
  {
    name: 'Registry Contract Tests',
    command: 'forge test --match-path "test/*Registry*.t.sol" -vv',
    cwd: 'contracts',
    required: false
  },
  {
    name: 'Moderation Contract Tests',
    command: 'forge test --match-path "test/BanManager.t.sol" --match-path "test/ReputationLabelManager.t.sol" --match-path "test/UnifiedReportingSystem.t.sol" -vv',
    cwd: 'contracts',
    required: true
  },
  {
    name: 'Moderation Integration Tests',
    command: 'forge test --match-path "test/ModerationIntegration.t.sol" -vv',
    cwd: 'contracts',
    required: true
  }
];

async function runTests() {
  logger.info('═══════════════════════════════════════════════════');
  logger.info('   Master Test Suite - Jeju Project');
  logger.info('═══════════════════════════════════════════════════\n');
  
  const results: { name: string; passed: boolean; duration: number }[] = [];
  
  for (const suite of TEST_SUITES) {
    const startTime = Date.now();
    
    logger.info(`\n${'─'.repeat(60)}`);
    logger.info(`📋 Running: ${suite.name}`);
    logger.info('─'.repeat(60));
    
    const passed = await runTestSuite(suite);
    const duration = Date.now() - startTime;
    
    results.push({ name: suite.name, passed, duration });
    
    if (!passed && suite.required) {
      logger.error(`\n✗ Required test suite failed: ${suite.name}`);
      logger.error('Aborting test run');
      printSummary(results);
      process.exit(1);
    }
  }
  
  printSummary(results);
  
  const allPassed = results.every(r => r.passed);
  process.exit(allPassed ? 0 : 1);
}

async function runTestSuite(suite: TestSuite): Promise<boolean> {
  return new Promise((resolve) => {
    const [cmd, ...args] = suite.command.split(' ');
    
    const test = spawn(cmd, args, {
      cwd: suite.cwd || process.cwd(),
      stdio: 'inherit'
    });
    
    test.on('close', (code) => {
      resolve(code === 0);
    });
    
    test.on('error', (error) => {
      logger.error(`Test suite error: ${error.message}`);
      resolve(false);
    });
  });
}

function printSummary(results: { name: string; passed: boolean; duration: number }[]) {
  logger.info('\n' + '═'.repeat(60));
  logger.info('📊 Test Results Summary');
  logger.info('═'.repeat(60) + '\n');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  
  results.forEach(result => {
    const icon = result.passed ? '✓' : '✗';
    const color = result.passed ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    
    logger.info(
      `${color}${icon}${reset} ${result.name.padEnd(40)} ${(result.duration / 1000).toFixed(2)}s`
    );
  });
  
  logger.info('\n' + '-'.repeat(60));
  logger.info(`Total: ${total} suites`);
  logger.info(`${passed} passed, ${failed} failed`);
  logger.info(`Duration: ${(totalDuration / 1000).toFixed(2)}s`);
  logger.info('-'.repeat(60) + '\n');
  
  if (failed === 0) {
    logger.success('🎉 All tests passed!');
  } else {
    logger.warn(`⚠️  ${failed} test suite(s) failed or skipped`);
  }
}

runTests();


