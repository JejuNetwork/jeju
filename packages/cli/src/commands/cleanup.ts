/**
 * jeju cleanup - Clean up orphaned processes and resources
 */

import { Command } from 'commander';
import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { findMonorepoRoot } from '../lib/system';

export const cleanupCommand = new Command('cleanup')
  .description('Clean up orphaned processes and resources')
  .action(async () => {
    const rootDir = findMonorepoRoot();
    const scriptPath = join(rootDir, 'scripts/cleanup-processes.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error('Cleanup script not found');
      return;
    }

    logger.header('CLEANUP');
    logger.info('Cleaning up orphaned processes and resources...');
    logger.newline();

    await execa('bun', ['run', scriptPath], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  });

