/**
 * jeju build - Build all components
 */

import { Command } from 'commander';
import { $ } from 'bun';
import { logger } from '../lib/logger';
import { findMonorepoRoot } from '../lib/system';

export const buildCommand = new Command('build')
  .description('Build all components (contracts, TypeScript, indexer, docs)')
  .option('--skip-contracts', 'Skip contract build')
  .option('--skip-types', 'Skip TypeScript type check')
  .option('--skip-indexer', 'Skip indexer build')
  .option('--skip-docs', 'Skip documentation build')
  .action(async (options) => {
    logger.header('BUILD');
    
    const rootDir = findMonorepoRoot();
    let failed = false;
    
    // Step 1: Build Smart Contracts
    if (!options.skipContracts) {
      logger.step('Building Smart Contracts (Foundry)...');
      const contractsResult = await $`cd ${rootDir}/packages/contracts && forge build`.nothrow();
      
      if (contractsResult.exitCode !== 0) {
        logger.error('Contracts build failed');
        failed = true;
      } else {
        logger.success('Contracts built successfully');
      }
      logger.newline();
    }
    
    // Step 2: TypeScript Type Check
    if (!options.skipTypes) {
      logger.step('TypeScript Type Checking...');
      const typecheckResult = await $`cd ${rootDir} && tsc --noEmit`.nothrow();
      
      if (typecheckResult.exitCode !== 0) {
        logger.error('TypeScript type check failed');
        failed = true;
      } else {
        logger.success('TypeScript type check passed');
      }
      logger.newline();
    }
    
    // Step 3: Build Indexer
    if (!options.skipIndexer) {
      logger.step('Building Indexer (Subsquid)...');
      const indexerResult = await $`cd ${rootDir}/apps/indexer && npm run build`.nothrow();
      
      if (indexerResult.exitCode !== 0) {
        logger.warn('Indexer build failed (continuing)');
      } else {
        logger.success('Indexer built successfully');
      }
      logger.newline();
    }
    
    // Step 4: Build Node Explorer
    logger.step('Building Node Explorer...');
    const explorerResult = await $`cd ${rootDir}/apps/node-explorer && bun run build`.nothrow();
    
    if (explorerResult.exitCode !== 0) {
      logger.warn('Node Explorer build failed (continuing)');
    } else {
      logger.success('Node Explorer built successfully');
    }
    logger.newline();
    
    // Step 5: Build Documentation
    if (!options.skipDocs) {
      logger.step('Building Documentation (VitePress)...');
      const docsResult = await $`cd ${rootDir} && vitepress build apps/documentation`.nothrow();
      
      if (docsResult.exitCode !== 0) {
        logger.warn('Documentation build failed (continuing)');
      } else {
        logger.success('Documentation built successfully');
      }
      logger.newline();
    }
    
    logger.separator();
    
    if (failed) {
      logger.error('Build failed');
      logger.info('Fix errors and run: jeju build');
      logger.newline();
      process.exit(1);
    } else {
      logger.success('Build complete!');
      logger.newline();
      logger.info('Next:');
      logger.info('  jeju test     # Run all tests');
      logger.info('  jeju dev      # Start development');
      logger.newline();
    }
  });

