/**
 * Build commands for Docker images and other artifacts
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { execa } from 'execa'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

const buildCommand = new Command('build')
  .description('Build all components (contracts, TypeScript, indexer, docs)')
  .option('--contracts-only', 'Build contracts only')
  .option('--types-only', 'Build TypeScript types only')
  .option('--skip-docs', 'Skip documentation generation')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()

    if (options.contractsOnly) {
      logger.step('Building contracts...')
      await execa('forge', ['build'], {
        cwd: join(rootDir, 'packages/contracts'),
        stdio: 'inherit',
      })
      logger.success('Contracts built')
      return
    }

    if (options.typesOnly) {
      logger.step('Building types...')
      await execa('bun', ['run', 'build'], {
        cwd: join(rootDir, 'packages/types'),
        stdio: 'inherit',
      })
      logger.success('Types built')
      return
    }

    // Build types first
    logger.step('Building types...')
    await execa('bun', ['run', 'build'], {
      cwd: join(rootDir, 'packages/types'),
      stdio: 'inherit',
    })

    // Build contracts
    logger.step('Building contracts...')
    await execa('forge', ['build'], {
      cwd: join(rootDir, 'packages/contracts'),
      stdio: 'inherit',
    })

    // Generate docs if not skipped
    if (!options.skipDocs) {
      logger.step('Generating documentation...')
      await execa('bun', ['run', 'docs:generate'], {
        cwd: rootDir,
        stdio: 'pipe',
      }).catch(() => {
        logger.warn('Documentation generation skipped (optional)')
      })
    }

    logger.success('Build complete')
  })

buildCommand
  .command('images')
  .description('Build Docker images for apps')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--push', 'Push images to ECR after building')
  .action(async (options: { network: string; push?: boolean }) => {
    const rootDir = findMonorepoRoot()
    const scriptPath = join(
      rootDir,
      'packages/deployment/scripts/build-images.ts',
    )

    if (!existsSync(scriptPath)) {
      logger.error('Build images script not found')
      return
    }

    const args: string[] = []
    if (options.push) args.push('--push')

    await execa('bun', ['run', scriptPath, ...args], {
      cwd: rootDir,
      env: { ...process.env, NETWORK: options.network },
      stdio: 'inherit',
    })
  })

buildCommand
  .command('covenantsql')
  .description('Build CovenantSQL multi-arch Docker image')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--push', 'Push image to ECR after building')
  .option('--arm-only', 'Build ARM64 only')
  .option('--x86-only', 'Build x86_64 only')
  .action(
    async (options: {
      network: string
      push?: boolean
      armOnly?: boolean
      x86Only?: boolean
    }) => {
      const rootDir = findMonorepoRoot()
      const scriptPath = join(
        rootDir,
        'packages/deployment/scripts/build-covenantsql.ts',
      )

      if (!existsSync(scriptPath)) {
        logger.error('Build CovenantSQL script not found')
        return
      }

      const args: string[] = []
      if (options.push) args.push('--push')
      if (options.armOnly) args.push('--arm-only')
      if (options.x86Only) args.push('--x86-only')

      await execa('bun', ['run', scriptPath, ...args], {
        cwd: rootDir,
        env: { ...process.env, NETWORK: options.network },
        stdio: 'inherit',
      })
    },
  )

buildCommand
  .command('abis')
  .description('Export contract ABIs from forge build artifacts')
  .action(async () => {
    logger.error('ABI export functionality has been removed.')
    logger.info('ABIs are automatically exported during forge build.')
    logger.info('Check packages/contracts/abis/ for exported ABIs.')
    process.exit(1)
  })

export { buildCommand }
