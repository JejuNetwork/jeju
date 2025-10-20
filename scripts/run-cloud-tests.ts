#!/usr/bin/env bun
/**
 * Comprehensive Cloud Integration Test Runner
 * 
 * Runs all E2E tests in sequence with proper setup and teardown.
 * NO MOCKS - full integration testing with real blockchain.
 */

import { spawn } from 'child_process';
import { Logger } from './shared/logger';
import fs from 'fs';
import path from 'path';

const logger = new Logger('cloud-test-runner');

interface TestSuite {
  name: string;
  file: string;
  timeout: number;
  required: boolean;
}

const TEST_SUITES: TestSuite[] = [
  {
    name: 'Cloud Registry Integration',
    file: 'tests/e2e/cloud-registry-integration.test.ts',
    timeout: 120000,
    required: true
  },
  {
    name: 'Cloud A2A Integration',
    file: 'tests/e2e/cloud-a2a-integration.test.ts',
    timeout: 60000,
    required: true
  },
  {
    name: 'Cloud x402 Payments',
    file: 'tests/e2e/cloud-x402-payments.test.ts',
    timeout: 60000,
    required: true
  }
];

interface TestResult {
  suite: string;
  passed: boolean;
  duration: number;
  output: string;
  error?: string;
}

const results: TestResult[] = [];
let localnetProcess: any;

async function main() {
  logger.info('═══════════════════════════════════════════════════');
  logger.info('   Cloud Integration E2E Test Suite');
  logger.info('═══════════════════════════════════════════════════\n');
  
  try {
    // Step 1: Start localnet
    await startLocalnet();
    
    // Step 2: Deploy contracts
    await deployContracts();
    
    // Step 3: Run test suites
    for (const suite of TEST_SUITES) {
      await runTestSuite(suite);
    }
    
    // Step 4: Generate report
    generateReport();
    
  } catch (error) {
    logger.error('Test runner failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    await stopLocalnet();
  }
  
  // Exit with appropriate code
  const allPassed = results.every(r => r.passed);
  process.exit(allPassed ? 0 : 1);
}

async function startLocalnet(): Promise<void> {
  logger.info('🚀 Starting localnet...');
  
  return new Promise((resolve, reject) => {
    localnetProcess = spawn('anvil', ['--block-time', '1'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let output = '';
    localnetProcess.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
      if (output.includes('Listening on')) {
        logger.success('✓ Localnet started');
        setTimeout(resolve, 2000); // Give it 2s to stabilize
      }
    });
    
    localnetProcess.stderr?.on('data', (data: Buffer) => {
      logger.warn(data.toString());
    });
    
    localnetProcess.on('error', reject);
    
    setTimeout(() => {
      if (!output.includes('Listening on')) {
        reject(new Error('Localnet failed to start'));
      }
    }, 10000);
  });
}

async function stopLocalnet(): Promise<void> {
  if (localnetProcess) {
    logger.info('🛑 Stopping localnet...');
    localnetProcess.kill();
    logger.success('✓ Localnet stopped');
  }
}

async function deployContracts(): Promise<void> {
  logger.info('📝 Deploying contracts...');
  
  return new Promise((resolve, reject) => {
    const deploy = spawn('bun', ['run', 'deploy:cloud'], {
      stdio: 'pipe',
      env: {
        ...process.env,
        RPC_URL: 'http://localhost:8545',
        PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
      }
    });
    
    let output = '';
    deploy.stdout?.on('data', (data) => {
      output += data.toString();
    });
    
    deploy.stderr?.on('data', (data) => {
      logger.warn(data.toString());
    });
    
    deploy.on('close', (code) => {
      if (code === 0) {
        logger.success('✓ Contracts deployed');
        resolve();
      } else {
        logger.warn('Contract deployment had issues, using fallback addresses');
        resolve(); // Continue with fallback
      }
    });
    
    setTimeout(() => {
      deploy.kill();
      logger.warn('Deployment timeout, using fallback addresses');
      resolve();
    }, 60000);
  });
}

async function runTestSuite(suite: TestSuite): Promise<void> {
  logger.info(`\n${'═'.repeat(60)}`);
  logger.info(`📋 Running: ${suite.name}`);
  logger.info(`${'═'.repeat(60)}\n`);
  
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const test = spawn('bun', ['test', suite.file], {
      stdio: 'pipe',
      env: {
        ...process.env,
        RPC_URL: 'http://localhost:8545'
      }
    });
    
    let output = '';
    let errorOutput = '';
    
    test.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(text);
    });
    
    test.stderr?.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      process.stderr.write(text);
    });
    
    test.on('close', (code) => {
      const duration = Date.now() - startTime;
      const passed = code === 0;
      
      results.push({
        suite: suite.name,
        passed,
        duration,
        output,
        error: passed ? undefined : errorOutput
      });
      
      if (passed) {
        logger.success(`\n✓ ${suite.name} passed (${duration}ms)\n`);
      } else {
        logger.error(`\n✗ ${suite.name} failed (${duration}ms)\n`);
        
        if (suite.required) {
          logger.error('Required test suite failed, aborting...');
          stopLocalnet();
          process.exit(1);
        }
      }
      
      resolve();
    });
    
    setTimeout(() => {
      test.kill();
      const duration = Date.now() - startTime;
      
      results.push({
        suite: suite.name,
        passed: false,
        duration,
        output,
        error: 'Test timeout'
      });
      
      logger.error(`\n✗ ${suite.name} timeout (${suite.timeout}ms)\n`);
      
      if (suite.required) {
        logger.error('Required test suite timeout, aborting...');
        stopLocalnet();
        process.exit(1);
      }
      
      resolve();
    }, suite.timeout);
  });
}

function generateReport(): void {
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
      `${color}${icon}${reset} ${result.suite} - ${result.duration}ms`
    );
    
    if (!result.passed && result.error) {
      logger.error(`  Error: ${result.error.substring(0, 200)}...`);
    }
  });
  
  logger.info('\n' + '-'.repeat(60));
  logger.info(`Total: ${total} suites`);
  logger.info(`${passed} passed, ${failed} failed`);
  logger.info(`Duration: ${totalDuration}ms`);
  logger.info('-'.repeat(60) + '\n');
  
  if (failed === 0) {
    logger.success('🎉 All tests passed!');
  } else {
    logger.error(`❌ ${failed} test suite(s) failed`);
  }
  
  // Save report to file
  const reportPath = path.join(__dirname, '../test-results.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    results,
    summary: {
      total,
      passed,
      failed,
      duration: totalDuration
    }
  }, null, 2));
  
  logger.info(`\n📄 Full report saved to: ${reportPath}`);
}

// Run tests
main().catch((error) => {
  logger.error('Fatal error:', error);
  stopLocalnet();
  process.exit(1);
});


