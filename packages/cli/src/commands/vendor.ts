/**
 * vendor command - Manage vendor app integration
 * 
 * Commands:
 *   jeju vendor init <app-name>  - Create vendor manifest for external app integration
 */

import { Command } from 'commander';
import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { findMonorepoRoot } from '../lib/system';

export const vendorCommand = new Command('vendor')
  .description('Manage vendor app integration');

// ============================================================================
// init - Create vendor manifest for external app integration
// ============================================================================

vendorCommand
  .command('init')
  .description('Create vendor manifest for external app integration (interactive)')
  .argument('<app-name>', 'Vendor app name (must exist in vendor/ directory)')
  .action(async (appName: string) => {
    logger.header('CREATE VENDOR MANIFEST');

    const rootDir = findMonorepoRoot();
    const scriptPath = join(rootDir, 'scripts/vendor/create-vendor-manifest.ts');

    if (!existsSync(scriptPath)) {
      logger.error('Vendor manifest script not found');
      process.exit(1);
    }

    await execa('bun', ['run', scriptPath, appName], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  });

export default vendorCommand;
