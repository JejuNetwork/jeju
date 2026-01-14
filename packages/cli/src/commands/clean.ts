/** Clean build artifacts */

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { $ } from 'bun'
import { Command } from 'commander'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

export const cleanCommand = new Command('clean')
  .description('Clean build artifacts and stop running services')
  .option('--deep', 'Deep clean (includes Docker and node_modules)')
  .option('--reset-localnet', 'Reset localnet state (clears deployment state and kurtosis enclave)')
  .action(async (options) => {
    logger.header(`CLEAN${options.deep ? ' (DEEP)' : ''}${options.resetLocalnet ? ' (RESET LOCALNET)' : ''}`)

    const rootDir = findMonorepoRoot()

    logger.step('Stopping Localnet...')
    const stopResult = await $`cd ${rootDir} && bun run localnet:stop`.nothrow()
    if (stopResult.exitCode === 0) {
      logger.success('Localnet stopped')
    } else {
      logger.info('No localnet running')
    }
    logger.newline()

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

    if (options.deep) {
      logger.step('Cleaning Docker Resources...')
      await $`docker system prune -f`.nothrow()
      logger.success('Docker resources cleaned')
      logger.newline()
    }

    if (options.resetLocalnet || options.deep) {
      logger.step('Resetting Localnet State...')

      // Clean localnet deployment state files
      const deploymentsDir = `${rootDir}/packages/contracts/deployments`
      if (existsSync(deploymentsDir)) {
        try {
          const files = readdirSync(deploymentsDir)
          let cleanedDeployments = 0
          for (const file of files) {
            if (file.includes('localnet') || file.startsWith('localnet-')) {
              rmSync(`${deploymentsDir}/${file}`, { force: true })
              logger.info(`Removed ${file}`)
              cleanedDeployments++
            }
          }
          if (cleanedDeployments > 0) {
            logger.success(`Cleaned ${cleanedDeployments} localnet deployment files`)
          }
        } catch (_e) {
          logger.warn('Failed to clean deployment files')
        }
      }

      // Reset kurtosis enclave
      logger.info('Resetting Kurtosis enclave...')
      await $`kurtosis enclave rm -f jeju-localnet`.nothrow().quiet()
      await $`kurtosis engine restart`.nothrow().quiet()
      logger.success('Kurtosis enclave reset')
      logger.newline()
    }

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

    if (options.resetLocalnet) {
      logger.info('Next: jeju dev (localnet will start fresh)')
      logger.newline()
    } else {
      logger.info('Next: jeju build')
      logger.info('Tip: Use --reset-localnet to fix nonce errors')
      logger.newline()
    }
  })
