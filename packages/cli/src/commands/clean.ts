/**
 * jeju clean - Clean build artifacts
 */

import { existsSync, rmSync } from 'node:fs'
import { $ } from 'bun'
import { Command } from 'commander'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

export const cleanCommand = new Command('clean')
  .description('Clean build artifacts and stop running services')
  .option('--deep', 'Deep clean (includes Docker and node_modules)')
  .action(async (options) => {
    logger.header(`CLEAN${options.deep ? ' (DEEP)' : ''}`)

    const rootDir = findMonorepoRoot()

    // Step 1: Stop localnet
    logger.step('Stopping Localnet...')
    const stopResult = await $`cd ${rootDir} && bun run localnet:stop`.nothrow()
    if (stopResult.exitCode === 0) {
      logger.success('Localnet stopped')
    } else {
      logger.info('No localnet running')
    }
    logger.newline()

    // Step 2: Clean build artifacts
    logger.step('Removing Build Artifacts...')

    const pathsToClean = [
      'packages/contracts/out',
      'packages/contracts/cache',
      'apps/indexer/lib',
      'apps/indexer/.sqd',
      'apps/node-explorer/dist',
      'apps/node-explorer/.next',
      'apps/documentation/.vitepress/dist',
      'apps/documentation/.vitepress/cache',
      '.cache',
      'dist',
    ]

    let cleaned = 0
    for (const path of pathsToClean) {
      const fullPath = `${rootDir}/${path}`
      if (existsSync(fullPath)) {
        try {
          rmSync(fullPath, { recursive: true, force: true })
          logger.info(`Removed ${path}`)
          cleaned++
        } catch (_e) {
          logger.warn(`Failed to remove ${path}`)
        }
      }
    }

    logger.success(`Cleaned ${cleaned} directories`)
    logger.newline()

    // Step 3: Clean node_modules (optional)
    if (options.deep) {
      logger.step('Removing node_modules...')

      const nodeModulesPaths = [
        'node_modules',
        'apps/indexer/node_modules',
        'apps/node-explorer/node_modules',
      ]

      let cleanedModules = 0
      for (const path of nodeModulesPaths) {
        const fullPath = `${rootDir}/${path}`
        if (existsSync(fullPath)) {
          try {
            logger.info(`Removing ${path}...`)
            rmSync(fullPath, { recursive: true, force: true })
            cleanedModules++
          } catch (_e) {
            logger.warn(`Failed to remove ${path}`)
          }
        }
      }

      logger.success(`Cleaned ${cleanedModules} node_modules directories`)
      logger.newline()
    }

    // Step 4: Clean Docker (optional)
    if (options.deep) {
      logger.step('Cleaning Docker Resources...')
      await $`docker system prune -f`.nothrow()
      logger.success('Docker resources cleaned')
      logger.newline()
    }

    // Step 5: Clean logs
    logger.step('Removing Log Files...')

    const logPaths = ['logs']

    let cleanedLogs = 0
    for (const path of logPaths) {
      const fullPath = `${rootDir}/${path}`
      if (existsSync(fullPath)) {
        try {
          rmSync(fullPath, { recursive: true, force: true })
          logger.info(`Removed ${path}`)
          cleanedLogs++
        } catch (_e) {
          logger.warn(`Failed to remove ${path}`)
        }
      }
    }

    logger.success(`Cleaned ${cleanedLogs} log directories`)
    logger.newline()

    logger.separator()
    logger.success('Cleanup complete!')
    logger.newline()

    if (options.deep) {
      logger.info('Next: bun install')
      logger.newline()
    }

    logger.info('Next: jeju build')
    logger.newline()
  })

