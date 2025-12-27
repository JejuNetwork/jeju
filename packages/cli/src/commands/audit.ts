/**
 * Audit log viewing commands
 *
 * View and manage key audit logs for security compliance
 */

import { Command } from 'commander'
import { initializeKeyAudit, keyAudit } from '../lib/key-audit'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

export const auditCommand = new Command('audit')
  .description('View key audit logs')
  .addCommand(createListCommand())
  .addCommand(createKeyHistoryCommand())
  .addCommand(createExportCommand())

function createListCommand(): Command {
  return new Command('list')
    .description('List recent audit events')
    .option('-d, --days <days>', 'Number of days to show', '7')
    .option('-t, --type <type>', 'Filter by event type')
    .option('-n, --network <network>', 'Filter by network')
    .action((options) => {
      // Initialize audit logger
      try {
        const rootDir = findMonorepoRoot()
        initializeKeyAudit(rootDir)
      } catch (_error) {
        logger.error('Not in a Jeju project directory')
        process.exit(1)
      }

      const days = parseInt(options.days, 10)
      let events = keyAudit.getRecentEvents(days)

      // Apply filters
      if (options.type) {
        events = events.filter((e) => e.eventType === options.type)
      }
      if (options.network) {
        events = events.filter((e) => e.network === options.network)
      }

      logger.header('KEY AUDIT LOG')
      logger.keyValue('Period', `Last ${days} days`)
      logger.keyValue('Total Events', String(events.length))
      logger.newline()

      if (events.length === 0) {
        logger.info('No audit events found')
        return
      }

      // Group by day
      const byDay = new Map<string, typeof events>()
      for (const event of events) {
        const day = event.timestamp.split('T')[0]
        if (!byDay.has(day)) {
          byDay.set(day, [])
        }
        byDay.get(day)?.push(event)
      }

      for (const [day, dayEvents] of byDay) {
        logger.subheader(day)

        for (const event of dayEvents) {
          const time = event.timestamp.split('T')[1].slice(0, 8)
          const status = event.success ? '✓' : '✗'
          const keyShort = `${event.keyIdentifier.slice(0, 10)}...`

          console.log(
            `  ${time} ${status} ${event.eventType.padEnd(20)} ${keyShort} [${event.network}]`,
          )

          if (event.metadata) {
            const meta = Object.entries(event.metadata)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')
            console.log(`           ${meta}`)
          }

          if (!event.success && event.errorMessage) {
            console.log(`           Error: ${event.errorMessage}`)
          }
        }
        logger.newline()
      }
    })
}

function createKeyHistoryCommand(): Command {
  return new Command('key')
    .description('View audit history for a specific key')
    .argument('<address>', 'Key address (0x...)')
    .option('-d, --days <days>', 'Number of days to search', '30')
    .action((address: string, options) => {
      // Initialize audit logger
      try {
        const rootDir = findMonorepoRoot()
        initializeKeyAudit(rootDir)
      } catch (_error) {
        logger.error('Not in a Jeju project directory')
        process.exit(1)
      }

      const days = parseInt(options.days, 10)
      const events = keyAudit.getEventsForKey(address, days)

      logger.header('KEY AUDIT HISTORY')
      logger.keyValue('Address', address)
      logger.keyValue('Period', `Last ${days} days`)
      logger.keyValue('Total Events', String(events.length))
      logger.newline()

      if (events.length === 0) {
        logger.info('No audit events found for this key')
        return
      }

      // Show event timeline
      for (const event of events) {
        const date = event.timestamp.split('T')[0]
        const time = event.timestamp.split('T')[1].slice(0, 8)
        const status = event.success ? '✓' : '✗'

        console.log(`${date} ${time} ${status} ${event.eventType}`)
        console.log(`  Network: ${event.network}`)
        console.log(`  Machine: ${event.machineId}`)

        if (event.metadata) {
          for (const [key, value] of Object.entries(event.metadata)) {
            console.log(`  ${key}: ${value}`)
          }
        }

        if (!event.success && event.errorMessage) {
          console.log(`  Error: ${event.errorMessage}`)
        }

        logger.newline()
      }
    })
}

function createExportCommand(): Command {
  return new Command('export')
    .description('Export audit logs as JSON')
    .option('-d, --days <days>', 'Number of days to export', '30')
    .option('-o, --output <path>', 'Output file path')
    .action((options) => {
      // Initialize audit logger
      try {
        const rootDir = findMonorepoRoot()
        initializeKeyAudit(rootDir)
      } catch (_error) {
        logger.error('Not in a Jeju project directory')
        process.exit(1)
      }

      const { writeFileSync } = require('node:fs')

      const days = parseInt(options.days, 10)
      const events = keyAudit.getRecentEvents(days)

      const exportData = {
        exportedAt: new Date().toISOString(),
        periodDays: days,
        eventCount: events.length,
        events,
      }

      if (options.output) {
        writeFileSync(options.output, JSON.stringify(exportData, null, 2))
        logger.success(`Exported ${events.length} events to ${options.output}`)
      } else {
        console.log(JSON.stringify(exportData, null, 2))
      }
    })
}
