/**
 * SQLit Proxy Route
 *
 * Proxies SQLit requests to the DWS-managed SQLit service.
 * SQLit runs as a DWS service, not a separate deployment.
 *
 * Endpoints:
 * - POST /sqlit/v1/query - Execute SELECT queries
 * - POST /sqlit/v1/exec - Execute write operations
 * - GET /sqlit/v1/status - Health check
 * - POST /sqlit/api/v1/databases - Database management
 */

import { Elysia } from 'elysia'
import {
  ensureSQLitService,
  getSQLitEndpoint,
  getSQLitStatus,
  isSQLitHealthy,
} from '../../database'

/**
 * Create SQLit proxy router
 */
export function createSQLitProxyRouter() {
  return (
    new Elysia({ prefix: '/sqlit' })
      .get('/status', async () => {
        const status = getSQLitStatus()
        const healthy = await isSQLitHealthy()

        return {
          status: healthy ? 'healthy' : 'unhealthy',
          service: 'sqlit',
          running: status.running,
          endpoint: status.endpoint,
          healthStatus: status.healthStatus,
        }
      })

      .get('/v1/status', async ({ set }) => {
        // Ensure SQLit is running
        try {
          await ensureSQLitService()
        } catch (err) {
          set.status = 503
          return {
            status: 'error',
            error:
              err instanceof Error ? err.message : 'SQLit service unavailable',
          }
        }

        const endpoint = getSQLitEndpoint()
        const response = await fetch(`${endpoint}/v1/status`, {
          signal: AbortSignal.timeout(5000),
        }).catch(() => null)

        if (!response?.ok) {
          set.status = 503
          return { status: 'error', error: 'SQLit not responding' }
        }

        const data = await response.json()
        return data
      })

      .post('/v1/query', async ({ body, set }) => {
        // Ensure SQLit is running
        try {
          await ensureSQLitService()
        } catch (err) {
          set.status = 503
          return {
            error:
              err instanceof Error ? err.message : 'SQLit service unavailable',
          }
        }

        const endpoint = getSQLitEndpoint()
        const response = await fetch(`${endpoint}/v1/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        })

        if (!response.ok) {
          set.status = response.status
          return { error: await response.text() }
        }

        return await response.json()
      })

      .post('/v1/exec', async ({ body, set }) => {
        // Ensure SQLit is running
        try {
          await ensureSQLitService()
        } catch (err) {
          set.status = 503
          return {
            error:
              err instanceof Error ? err.message : 'SQLit service unavailable',
          }
        }

        const endpoint = getSQLitEndpoint()
        const response = await fetch(`${endpoint}/v1/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        })

        if (!response.ok) {
          set.status = response.status
          return { error: await response.text() }
        }

        return await response.json()
      })

      // Proxy all other /api/v1/* requests to SQLit
      .all('/api/v1/*', async ({ request, params, set }) => {
        // Ensure SQLit is running
        try {
          await ensureSQLitService()
        } catch (err) {
          set.status = 503
          return {
            error:
              err instanceof Error ? err.message : 'SQLit service unavailable',
          }
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
        }).catch((err) => {
          set.status = 502
          return new Response(
            JSON.stringify({ error: `SQLit proxy error: ${err.message}` }),
            { status: 502, headers: { 'Content-Type': 'application/json' } },
          )
        })

        if (response instanceof Response) {
          set.status = response.status
          const contentType = response.headers.get('content-type')
          if (contentType?.includes('application/json')) {
            return await response.json()
          }
          return await response.text()
        }

        return response
      })
  )
}
