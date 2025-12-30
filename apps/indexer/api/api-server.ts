/**
 * Unified API server entry point
 *
 * Modes: postgres (full), sqlit-only (read), degraded (minimal)
 */

import { getLocalhostHost } from '@jejunetwork/config'
import { startA2AServer } from './a2a-server'
import { config } from './config'
import { startMCPServer } from './mcp-server'
import { startRestServer } from './rest-server'
import {
  closeDataSource,
  getDataSourceWithRetry,
  getIndexerMode,
  isPostgresAvailable,
  setSchemaVerified,
  verifyDatabaseSchema,
} from './utils/db'
import { getSQLitSync } from './utils/sqlit-sync'

async function main(): Promise<void> {
  console.log('🚀 Starting Indexer API servers...')

  const mode = getIndexerMode()
  console.log(`[Indexer] Mode: ${mode}`)

  let schemaReady = false

  // Initialize PostgreSQL if not in SQLit-only mode
  if (mode !== 'sqlit-only') {
    const dataSource = await getDataSourceWithRetry(3, 2000)

    if (dataSource) {
      // Verify schema exists before proceeding
      schemaReady = await verifyDatabaseSchema(dataSource)
      setSchemaVerified(schemaReady)

      if (!schemaReady) {
        console.warn(
          '[Indexer] Database schema not ready - REST API will return 503 for data queries',
        )
        console.warn(
          '[Indexer] Run the processor (sqd process:dev) to create schema',
        )
      }

      if (schemaReady && config.sqlitSyncEnabled) {
        const sqlitSync = getSQLitSync()
        await sqlitSync.initialize(dataSource)
        await sqlitSync.start()
        console.log('[Indexer] SQLit sync enabled')
      }
    }
  }

  // Start all API servers
  await Promise.all([startRestServer(), startA2AServer(), startMCPServer()])

  const currentMode = isPostgresAvailable()
    ? schemaReady
      ? 'postgres'
      : 'postgres (no schema)'
    : 'degraded'
  const host = getLocalhostHost()
  console.log(`
┌──────────────────────────────────────────┐
│   Indexer API Servers Running    │
├──────────────────────────────────────────┤
│  Mode:    ${currentMode.padEnd(30)}│
│  GraphQL: http://${host}:4350/graphql  │
│  REST:    http://${host}:4352          │
│  A2A:     http://${host}:4351          │
│  MCP:     http://${host}:4353          │
└──────────────────────────────────────────┘`)
}

async function shutdown(): Promise<void> {
  console.log('\n[Indexer] Shutting down...')

  // Stop SQLit sync
  const sqlitSync = getSQLitSync()
  await sqlitSync.stop()

  // Close PostgreSQL
  await closeDataSource()

  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

main().catch((error: Error) => {
  console.error('[Indexer] Startup failed:', error.message)

  // Log more details in development
  if (!config.isProduction) {
    console.error(error.stack)
  }

  process.exit(1)
})
