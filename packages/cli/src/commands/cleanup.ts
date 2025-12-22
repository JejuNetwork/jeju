/**
 * jeju cleanup - Cleanup orphaned processes
 */

import { $ } from 'bun'
import { Command } from 'commander'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

export const cleanupCommand = new Command('cleanup')
  .description('Cleanup orphaned network processes from previous dev runs')
  .action(async () => {
    logger.header('CLEANUP ORPHANED PROCESSES')

    const rootDir = findMonorepoRoot()

    // Stop any running Kurtosis enclaves
    logger.step('Stopping Kurtosis localnet...')
    await $`cd ${rootDir} && bun run localnet:stop`.nothrow().quiet()
    logger.success('Kurtosis stopped')
    logger.newline()

    // Stop Docker containers
    logger.step('Stopping Docker containers...')
    await $`cd ${rootDir}/apps/indexer && npm run db:down`.nothrow().quiet()
    await $`cd ${rootDir}/apps/monitoring && docker-compose down`
      .nothrow()
      .quiet()
    logger.success('Docker containers stopped')
    logger.newline()

    // Kill processes on known ports
    logger.step('Killing processes on known ports...')

    const portsToKill = [
      4001, // Paymaster Dashboard
      4002, // Node Explorer API
      4003, // Node Explorer UI
      4004, // Documentation
      4005, // Predimarket
      4010, // Grafana
      4350, // Indexer GraphQL
      5001,
      5002, // Hyperscape
      5003,
      5004, // Launchpad
      5005, // TheDesk
      5006, // Cloud
      5007,
      5008,
      5009, // Caliguland
      5010, // redteam
      8545,
      9545, // RPC
      9090, // Prometheus
    ]

    let killed = 0
    for (const port of portsToKill) {
      const result = await $`lsof -ti:${port}`.nothrow().quiet()
      if (result.exitCode === 0) {
        const pids = result.stdout.toString().trim().split('\n').filter(Boolean)
        for (const pid of pids) {
          await $`kill -9 ${pid}`.nothrow().quiet()
          killed++
        }
      }
    }

    logger.success(`Killed ${killed} processes on known ports`)
    logger.newline()

    // Clean databases
    logger.step('Cleaning databases...')
    await $`rm -f ${rootDir}/apps/node-explorer/node-explorer.db`
      .nothrow()
      .quiet()
    logger.success('Databases cleaned')
    logger.newline()

    // Kill orphaned bun dev processes
    logger.step('Killing orphaned bun/node processes...')

    const bunProcs =
      await $`pgrep -f "bun run dev|bun run scripts/dev|npm run dev|next dev"`
        .nothrow()
        .quiet()
    if (bunProcs.exitCode === 0) {
      const pids = bunProcs.stdout.toString().trim().split('\n').filter(Boolean)
      let orphanedKilled = 0
      for (const pid of pids) {
        if (pid !== process.pid.toString()) {
          await $`kill -9 ${pid}`.nothrow().quiet()
          orphanedKilled++
        }
      }
      logger.success(`Killed ${orphanedKilled} orphaned dev processes`)
    } else {
      logger.success('No orphaned dev processes found')
    }
    logger.newline()

    // Show remaining processes
    const remaining =
      await $`ps aux | grep -E "(bun|node)" | grep -v grep | wc -l`.text()
    logger.info(`Remaining node/bun processes: ${remaining.trim()}`)
    logger.info('(This includes system processes and is normal)')
    logger.newline()

    logger.separator()
    logger.success('Cleanup complete!')
    logger.info('You can now run: jeju dev')
    logger.newline()
  })
