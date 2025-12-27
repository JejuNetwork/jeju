/**
 * EQLite Proxy Route
 *
 * Proxies EQLite requests to the DWS-managed EQLite service.
 * EQLite runs as a DWS service, not a separate deployment.
 *
 * Endpoints:
 * - POST /eqlite/v1/query - Execute SELECT queries
 * - POST /eqlite/v1/exec - Execute write operations
 * - GET /eqlite/v1/status - Health check
 * - POST /eqlite/api/v1/databases - Database management
 */

import { Elysia } from 'elysia'
import {
  ensureEQLiteService,
  getEQLiteEndpoint,
  getEQLiteStatus,
  isEQLiteHealthy,
} from '../../database'

/**
 * Create EQLite proxy router
 */
export function createEQLiteProxyRouter() {
  return (
    new Elysia({ prefix: '/eqlite' })
      .get('/status', async () => {
        const status = getEQLiteStatus()
        const healthy = await isEQLiteHealthy()

        return {
          status: healthy ? 'healthy' : 'unhealthy',
          service: 'eqlite',
          running: status.running,
          endpoint: status.endpoint,
          healthStatus: status.healthStatus,
        }
      })

      .get('/v1/status', async ({ set }) => {
        // Ensure EQLite is running
        try {
          await ensureEQLiteService()
        } catch (err) {
          set.status = 503
          return {
            status: 'error',
            error:
              err instanceof Error ? err.message : 'EQLite service unavailable',
          }
        }

        const endpoint = getEQLiteEndpoint()
        const response = await fetch(`${endpoint}/v1/status`, {
          signal: AbortSignal.timeout(5000),
        }).catch(() => null)

        if (!response?.ok) {
          set.status = 503
          return { status: 'error', error: 'EQLite not responding' }
        }

        const data = await response.json()
        return data
      })

      .post('/v1/query', async ({ body, set }) => {
        // Ensure EQLite is running
        try {
          await ensureEQLiteService()
        } catch (err) {
          set.status = 503
          return {
            error:
              err instanceof Error ? err.message : 'EQLite service unavailable',
          }
        }

        const endpoint = getEQLiteEndpoint()
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
        // Ensure EQLite is running
        try {
          await ensureEQLiteService()
        } catch (err) {
          set.status = 503
          return {
            error:
              err instanceof Error ? err.message : 'EQLite service unavailable',
          }
        }

        const endpoint = getEQLiteEndpoint()
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

      // Proxy all other /api/v1/* requests to EQLite
      .all('/api/v1/*', async ({ request, params, set }) => {
        // Ensure EQLite is running
        try {
          await ensureEQLiteService()
        } catch (err) {
          set.status = 503
          return {
            error:
              err instanceof Error ? err.message : 'EQLite service unavailable',
          }
        }

        const endpoint = getEQLiteEndpoint()
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
            JSON.stringify({ error: `EQLite proxy error: ${err.message}` }),
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
