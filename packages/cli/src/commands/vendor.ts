/**
 * vendor command - Manage vendor app integration
 *
 * Commands:
 *   jeju vendor init <app-name>  - Create vendor manifest for external app integration
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { execa } from 'execa'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

export const vendorCommand = new Command('vendor').description(
  'Manage vendor app integration',
)

// ============================================================================
// init - Create vendor manifest for external app integration
// ============================================================================

vendorCommand
  .command('init')
  .description(
    'Create vendor manifest for external app integration (interactive)',
  )
  .argument('<app-name>', 'Vendor app name (must exist in vendor/ directory)')
  .action(async (appName: string) => {
    logger.header('CREATE VENDOR MANIFEST')

    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/infrastructure/create-vendor-manifest.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Vendor manifest script not found')
      process.exit(1)
    }

    await execa('bun', ['run', scriptPath, appName], {
      cwd: rootDir,
      stdio: 'inherit',
    })
  })

export default vendorCommand
