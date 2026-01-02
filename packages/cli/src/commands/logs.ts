/**
 * Jeju Logs Command - View application and worker logs
 *
 * Like `vercel logs` or `wrangler tail`:
 * - jeju logs - View recent logs
 * - jeju logs --tail - Stream logs in real-time
 * - jeju logs --filter error - Filter by level
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDWSUrl, getLocalhostHost } from '@jejunetwork/config'
import { Command } from 'commander'
import type { Address } from 'viem'
import { logger } from '../lib/logger'
import type { AppManifest, NetworkType } from '../types'
import { requireLogin } from './login'

interface LogEntry {
  timestamp: number
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  message: string
  source: 'worker' | 'frontend' | 'system'
  workerId?: string
  invocationId?: string
  requestId?: string
  metadata?: Record<string, string>
}

interface LogQueryOptions {
  since?: string
  until?: string
  limit?: number
  level?: string
  source?: string
  workerId?: string
}

/**
 * Get DWS URL for network
 */
function getDWSUrlForNetwork(network: NetworkType): string {
  switch (network) {
    case 'mainnet':
      return process.env.MAINNET_DWS_URL ?? 'https://dws.jejunetwork.org'
    case 'testnet':
      return (
        process.env.TESTNET_DWS_URL ?? 'https://dws.testnet.jejunetwork.org'
      )
    default:
      return (
        process.env.DWS_URL ??
        getDWSUrl() ??
        `http://${getLocalhostHost()}:4020`
      )
  }
}

/**
 * Load manifest from directory
 */
function loadManifest(dir: string): AppManifest | null {
  const manifestPath = join(dir, 'jeju-manifest.json')
  if (!existsSync(manifestPath)) {
    return null
  }
  return JSON.parse(readFileSync(manifestPath, 'utf-8'))
}

/**
 * Parse time string to timestamp
 */
function parseTimeString(timeStr: string): number {
  const now = Date.now()

  // Relative time: 1h, 30m, 2d
  const match = timeStr.match(/^(\d+)([smhd])$/)
  if (match) {
    const value = parseInt(match[1], 10)
    const unit = match[2]
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    }
    return now - value * multipliers[unit]
  }

  // ISO date string
  const parsed = Date.parse(timeStr)
  if (!Number.isNaN(parsed)) {
    return parsed
  }

  return now - 60 * 60 * 1000 // Default to 1 hour ago
}

/**
 * Format log entry for display
 */
function formatLogEntry(
  log: LogEntry,
  options: { json?: boolean; verbose?: boolean },
): string {
  if (options.json) {
    return JSON.stringify(log)
  }

  const time = new Date(log.timestamp).toISOString()
  const level = log.level.toUpperCase().padEnd(5)

  // Level coloring via icons
  let icon: string
  switch (log.level) {
    case 'error':
      icon = '✗'
      break
    case 'warn':
      icon = '⚠'
      break
    case 'info':
      icon = 'ℹ'
      break
    case 'debug':
      icon = '🔍'
      break
    default:
      icon = ' '
  }

  let output = `${icon} [${time}] ${level} ${log.message}`

  if (options.verbose && log.metadata) {
    output += `\n    ${JSON.stringify(log.metadata)}`
  }

  return output
}

/**
 * Query logs from DWS
 */
async function queryLogs(
  appName: string,
  network: NetworkType,
  authToken: string,
  address: Address,
  queryOptions: LogQueryOptions,
): Promise<LogEntry[]> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const params = new URLSearchParams()
  params.set('app', appName)

  if (queryOptions.since) {
    params.set('since', String(parseTimeString(queryOptions.since)))
  }
  if (queryOptions.until) {
    params.set('until', String(parseTimeString(queryOptions.until)))
  }
  if (queryOptions.limit) {
    params.set('limit', String(queryOptions.limit))
  }
  if (queryOptions.level) {
    params.set('level', queryOptions.level)
  }
  if (queryOptions.source) {
    params.set('source', queryOptions.source)
  }
  if (queryOptions.workerId) {
    params.set('workerId', queryOptions.workerId)
  }

  const response = await fetch(`${dwsUrl}/logs/query?${params}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'X-Jeju-Address': address,
    },
  })

  if (!response.ok) {
    return []
  }

  const data = await response.json()
  return data.logs ?? []
}

/**
 * Stream logs in real-time
 */
async function streamLogs(
  appName: string,
  network: NetworkType,
  authToken: string,
  address: Address,
  onLog: (log: LogEntry) => void,
  queryOptions: LogQueryOptions,
): Promise<() => void> {
  const dwsUrl = getDWSUrlForNetwork(network)

  const params = new URLSearchParams()
  params.set('app', appName)
  if (queryOptions.level) {
    params.set('level', queryOptions.level)
  }
  if (queryOptions.source) {
    params.set('source', queryOptions.source)
  }

  const response = await fetch(`${dwsUrl}/logs/stream?${params}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'X-Jeju-Address': address,
      Accept: 'text/event-stream',
    },
  })

  if (!response.ok || !response.body) {
    throw new Error(`Failed to stream logs: ${response.statusText}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let cancelled = false

  const readLoop = async () => {
    while (!cancelled) {
      const { done, value } = await reader.read()
      if (done) break

      const text = decoder.decode(value)
      const lines = text.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6))
          onLog(data as LogEntry)
        }
      }
    }
  }

  readLoop().catch(console.error)

  return () => {
    cancelled = true
    reader.cancel()
  }
}

export const logsCommand = new Command('logs')
  .description('View application logs')
  .argument('[app]', 'App name (default: from manifest)')
  .option('--since <time>', 'Show logs since (e.g., 1h, 30m, 2d)', '1h')
  .option('--until <time>', 'Show logs until')
  .option('-n, --limit <n>', 'Maximum number of logs', '100')
  .option('-l, --level <level>', 'Filter by level: debug, info, warn, error')
  .option('-s, --source <source>', 'Filter by source: worker, frontend, system')
  .option('-w, --worker <id>', 'Filter by worker ID')
  .option('-t, --tail', 'Stream logs in real-time')
  .option('-f, --follow', 'Stream logs in real-time (alias for --tail)')
  .option('--json', 'Output as JSON')
  .option('-v, --verbose', 'Show metadata')
  .action(async (appArg, options) => {
    const credentials = requireLogin()
    const network = credentials.network as NetworkType
    const cwd = process.cwd()

    // Get app name
    let appName = appArg
    if (!appName) {
      const manifest = loadManifest(cwd)
      appName = manifest?.name
    }

    if (!appName) {
      logger.error(
        'App name required. Use argument or create jeju-manifest.json',
      )
      return
    }

    const queryOptions: LogQueryOptions = {
      since: options.since,
      until: options.until,
      limit: parseInt(options.limit, 10),
      level: options.level,
      source: options.source,
      workerId: options.worker,
    }

    // Stream mode
    if (options.tail || options.follow) {
      logger.info(`Tailing logs for ${appName}...`)
      logger.info('Press Ctrl+C to stop\n')

      const cancel = await streamLogs(
        appName,
        network,
        credentials.authToken,
        credentials.address as Address,
        (log) => {
          console.log(
            formatLogEntry(log, {
              json: options.json,
              verbose: options.verbose,
            }),
          )
        },
        queryOptions,
      )

      process.on('SIGINT', () => {
        cancel()
        logger.newline()
        logger.info('Stopped tailing logs')
        process.exit(0)
      })

      // Keep process alive
      await new Promise(() => {})
    }

    // Query mode
    const logs = await queryLogs(
      appName,
      network,
      credentials.authToken,
      credentials.address as Address,
      queryOptions,
    )

    if (logs.length === 0) {
      logger.info('No logs found')
      return
    }

    for (const log of logs) {
      console.log(
        formatLogEntry(log, { json: options.json, verbose: options.verbose }),
      )
    }
  })
