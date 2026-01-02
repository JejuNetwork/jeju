/**
 * SQLIT Proxy Route
 *
 * Provides SQLit database access via HTTP.
 * Supports both external SQLit endpoints and embedded Bun SQLite.
 *
 * Endpoints:
 * - POST /sqlit/v1/query - Execute SELECT queries
 * - POST /sqlit/v1/exec - Execute write operations
 * - GET /sqlit/v1/status - Health check
 * - POST /sqlit/v1/admin/create - Create database
 * - DELETE /sqlit/v1/admin/drop - Drop database
 */

import { Elysia, t } from 'elysia'
import {
  ensureSQLitService,
  getSQLitEndpoint,
  getSQLitStatus,
  isSQLitHealthy,
  sqlitCreateDatabase,
  sqlitDropDatabase,
  sqlitExec,
  sqlitQuery,
} from '../../database/sqlit-service'

const QueryBodySchema = t.Object({
  database: t.String(),
  query: t.String(),
  args: t.Optional(t.Array(t.Any())),
  assoc: t.Optional(t.Boolean()),
})

const ExecBodySchema = t.Object({
  database: t.String(),
  query: t.String(),
  args: t.Optional(t.Array(t.Any())),
})

/**
 * Create SQLIT proxy router
 */
export function createSQLitProxyRouter() {
  return (
    new Elysia({ prefix: '/sqlit' })
      // Health check
      .get('/status', async () => {
        const status = getSQLitStatus()
        const healthy = await isSQLitHealthy()

        return {
          status: healthy ? 'healthy' : 'unhealthy',
          service: 'sqlit',
          mode: status.mode,
          running: status.running,
          endpoint: status.endpoint,
          healthStatus: status.healthStatus,
        }
      })

      // Status endpoint (compatible with SQLit adapter)
      .get('/v1/status', async ({ set }) => {
        try {
          const { endpoint, mode } = await ensureSQLitService()
          const _status = getSQLitStatus()

          return {
            status: 'ok',
            success: true,
            data: {
              storage: mode === 'embedded' ? 'sqlite3-embedded' : 'sqlit',
              mode,
              endpoint,
              databases: 0, // Would need to track this
            },
          }
        } catch (err) {
          set.status = 503
          return {
            status: 'error',
            success: false,
            error:
              err instanceof Error ? err.message : 'SQLIT service unavailable',
          }
        }
      })

      // Execute SELECT query
      .post(
        '/v1/query',
        async ({ body, set }) => {
          try {
            const result = await sqlitQuery(
              body.database,
              body.query,
              body.args,
            )
            if (!result.success) {
              set.status = 400
            }
            return result
          } catch (err) {
            set.status = 503
            return {
              success: false,
              status: err instanceof Error ? err.message : 'Query failed',
              data: null,
            }
          }
        },
        { body: QueryBodySchema },
      )

      // Execute write query (INSERT, UPDATE, DELETE)
      .post(
        '/v1/exec',
        async ({ body, set }) => {
          try {
            const result = await sqlitExec(body.database, body.query, body.args)
            if (!result.success) {
              set.status = 400
            }
            return result
          } catch (err) {
            set.status = 503
            return {
              success: false,
              status: err instanceof Error ? err.message : 'Exec failed',
              data: null,
            }
          }
        },
        { body: ExecBodySchema },
      )

      // Create a new database
      .post('/v1/admin/create', async ({ query, set }) => {
        try {
          const nodeCount = parseInt(query.node ?? '1', 10)
          if (Number.isNaN(nodeCount) || nodeCount <= 0) {
            set.status = 400
            return { success: false, status: 'Invalid node count', data: null }
          }

          const result = await sqlitCreateDatabase(nodeCount)
          return result
        } catch (err) {
          set.status = 503
          return {
            success: false,
            status: err instanceof Error ? err.message : 'Create failed',
            data: null,
          }
        }
      })

      // Drop a database
      .delete('/v1/admin/drop', async ({ query, set }) => {
        const dbID = query.database
        if (!dbID) {
          set.status = 400
          return {
            success: false,
            status: 'Missing database parameter',
            data: null,
          }
        }

        try {
          const result = await sqlitDropDatabase(dbID)
          return { ...result, data: {} }
        } catch (err) {
          set.status = 503
          return {
            success: false,
            status: err instanceof Error ? err.message : 'Drop failed',
            data: null,
          }
        }
      })

      // Proxy all other /api/v1/* requests to external SQLIT (only in external mode)
      .all('/api/v1/*', async ({ request, params, set }) => {
        try {
          const { mode } = await ensureSQLitService()

          if (mode === 'embedded') {
            set.status = 501
            return { error: 'API v1 endpoints not supported in embedded mode' }
          }

          const endpoint = getSQLitEndpoint()
          const wildcardPath = (params as Record<string, string>)['*'] ?? ''
          const targetUrl = `${endpoint}/api/v1/${wildcardPath}`

          const headers = new Headers()
          request.headers.forEach((value, key) => {
            if (key.toLowerCase() !== 'host') {
              headers.set(key, value)
            }
          })

          const response = await fetch(targetUrl, {
            method: request.method,
            headers,
            body:
              request.method !== 'GET' && request.method !== 'HEAD'
                ? await request.text()
                : undefined,
            signal: AbortSignal.timeout(30000),
          })

          set.status = response.status
          const contentType = response.headers.get('content-type')
          if (contentType?.includes('application/json')) {
            return await response.json()
          }
          return await response.text()
        } catch (err) {
          set.status = 502
          return {
            error: `SQLIT proxy error: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      })
  )
}
