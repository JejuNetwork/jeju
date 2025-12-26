/**
 * Unified API server entry point
 *
 * Modes: postgres (full), cql-only (read), degraded (minimal)
 */

import { startA2AServer } from './a2a-server'
import { startMCPServer } from './mcp-server'
import { startRestServer } from './rest-server'
import { getCQLSync } from './utils/cql-sync'
import {
  closeDataSource,
  getDataSourceWithRetry,
  getIndexerMode,
  isPostgresAvailable,
  setSchemaVerified,
  verifyDatabaseSchema,
} from './utils/db'

async function main(): Promise<void> {
  console.log('🚀 Starting Indexer API servers...')

  const mode = getIndexerMode()
  console.log(`[Indexer] Mode: ${mode}`)

  let schemaReady = false

  // Initialize PostgreSQL if not in CQL-only mode
  if (mode !== 'cql-only') {
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

      if (schemaReady && process.env.CQL_SYNC_ENABLED === 'true') {
        const cqlSync = getCQLSync()
        await cqlSync.initialize(dataSource)
        await cqlSync.start()
        console.log('[Indexer] CQL sync enabled')
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
  console.log(`
┌──────────────────────────────────────────┐
│   Indexer API Servers Running    │
├──────────────────────────────────────────┤
│  Mode:    ${currentMode.padEnd(30)}│
│  GraphQL: http://localhost:4350/graphql  │
│  REST:    http://localhost:4352          │
│  A2A:     http://localhost:4351          │
│  MCP:     http://localhost:4353          │
└──────────────────────────────────────────┘`)
}

async function shutdown(): Promise<void> {
  console.log('\n[Indexer] Shutting down...')

  // Stop CQL sync
  const cqlSync = getCQLSync()
  await cqlSync.stop()

  // Close PostgreSQL
  await closeDataSource()

  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

main().catch((error: Error) => {
  console.error('[Indexer] Startup failed:', error.message)

  // Log more details in development
  if (process.env.NODE_ENV !== 'production') {
    console.error(error.stack)
  }

  process.exit(1)
})
