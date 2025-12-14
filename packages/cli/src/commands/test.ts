/**
 * jeju test - Unified test runner
 */

import { Command } from 'commander';
import { logger } from '../lib/logger';
import { getChainStatus } from '../lib/chain';
import {
  getTestPhases,
  runPreflightChecks,
  runTestPhase,
  runAppTests,
  printTestSummary,
  type TestOptions,
} from '../lib/testing';
import { DEFAULT_PORTS } from '../types';

export const testCommand = new Command('test')
  .description('Run Jeju test suite')
  .option('-p, --phase <phase>', 'Run specific phase: preflight, contracts, unit, integration, e2e, wallet')
  .option('-a, --app <app>', 'Run tests for specific app')
  .option('--ci', 'CI mode (fail fast, no retries)')
  .option('--coverage', 'Generate coverage report')
  .option('--watch', 'Watch mode')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options: TestOptions) => {
    logger.header('JEJU TEST SUITE');

    const rootDir = process.cwd();
    const rpcUrl = `http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`;

    // If testing specific app
    if (options.app) {
      logger.step(`Testing app: ${options.app}`);
      
      try {
        const results = await runAppTests(options.app, rootDir, options);
        printTestSummary(results);
        
        const failed = results.filter(r => !r.passed).length;
        if (failed > 0) {
          process.exit(1);
        }
        return;
      } catch (error) {
        const err = error as Error;
        logger.error(err.message);
        process.exit(1);
      }
    }

    // Get phases to run
    const phases = getTestPhases(options);
    
    logger.info(`Running ${phases.length} phase(s): ${phases.map(p => p.name).join(' → ')}`);
    if (options.ci) {
      logger.info('CI mode: enabled');
    }
    logger.newline();

    const results = [];

    // Preflight check
    if (phases.some(p => p.name === 'preflight')) {
      const status = await getChainStatus('localnet');
      
      if (!status.running) {
        logger.warn('Localnet not running. Starting...');
        logger.info('Run `jeju up` first for faster test startup');
        
        // Import dynamically to avoid circular deps
        const { startLocalnet } = await import('../lib/chain');
        await startLocalnet(rootDir);
      }

      const preflightResult = await runPreflightChecks(rootDir, rpcUrl);
      results.push(preflightResult);
      
      if (!preflightResult.passed) {
        logger.error('Preflight checks failed');
        printTestSummary(results);
        process.exit(1);
      }
    }

    // Run remaining phases
    for (const phase of phases) {
      if (phase.name === 'preflight') continue; // Already ran
      
      const result = await runTestPhase(phase, rootDir, options);
      results.push(result);
      
      // In CI mode, fail fast on required phases
      if (options.ci && phase.required && !result.passed) {
        logger.error(`Required phase ${phase.name} failed`);
        printTestSummary(results);
        process.exit(1);
      }
    }

    // Summary
    printTestSummary(results);

    const failed = results.filter(r => !r.passed).length;
    if (failed > 0) {
      process.exit(1);
    }
  });

// Subcommand for listing available phases
testCommand
  .command('list')
  .description('List available test phases')
  .action(() => {
    logger.header('AVAILABLE TEST PHASES');
    
    logger.table([
      { label: 'preflight', value: 'Chain connectivity checks', status: 'ok' },
      { label: 'contracts', value: 'Solidity tests (Forge)', status: 'ok' },
      { label: 'unit', value: 'TypeScript unit tests', status: 'ok' },
      { label: 'packages', value: 'Package tests', status: 'ok' },
      { label: 'integration', value: 'Cross-service tests', status: 'ok' },
      { label: 'e2e', value: 'Playwright E2E', status: 'ok' },
      { label: 'wallet', value: 'Synpress wallet tests', status: 'ok' },
    ]);
    
    logger.newline();
    logger.subheader('Examples');
    logger.list([
      'jeju test                     - Run default phases',
      'jeju test --phase=contracts   - Run only contract tests',
      'jeju test --phase=wallet      - Run wallet tests',
      'jeju test --app=bazaar        - Test specific app',
      'jeju test --ci                - CI mode (fail fast)',
    ]);
  });

