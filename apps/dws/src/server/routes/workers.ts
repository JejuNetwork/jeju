/**
 * Workers API Routes
 * Serverless function deployment and invocation
 */

import { expectJson } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import { z } from 'zod'
import type { BackendManager } from '../../storage/backends'
import { WorkerRuntime } from '../../workers/runtime'
import type {
  DeployParams,
  HTTPEvent,
  WorkerRuntime as RuntimeType,
  WorkerFunction,
} from '../../workers/types'

const EnvRecordSchema = z.record(z.string(), z.string())

export function createWorkersRouter(backend: BackendManager): Elysia {
  const runtime = new WorkerRuntime(backend)

  const router = new Elysia({ name: 'workers', prefix: '/workers' })
    // Health check
    .get('/health', () => {
      const stats = runtime.getStats()
      return {
        status: 'healthy',
        service: 'dws-workers',
        ...stats,
      }
    })

    // ============================================================================
    // Function Management
    // ============================================================================

    // Deploy function
    .post(
      '/',
      async ({ headers, body, set }) => {
        const owner = headers['x-jeju-address']
        if (!owner) {
          set.status = 401
          return { error: 'x-jeju-address header required' }
        }

        const contentType = headers['content-type'] || ''
        let params: DeployParams

        if (contentType.includes('multipart/form-data')) {
          // Handle form data - but Elysia doesn't auto-parse this yet
          // For multipart, the body comes as FormData
          const formData = body as FormData
          const codeFile = formData.get('code')
          if (!(codeFile instanceof File)) {
            set.status = 400
            return { error: 'Code file required' }
          }

          params = {
            name: formData.get('name') as string,
            runtime: (formData.get('runtime') as RuntimeType) ?? 'bun',
            handler: (formData.get('handler') as string) ?? 'index.handler',
            code: Buffer.from(await codeFile.arrayBuffer()),
            memory: parseInt(formData.get('memory') as string, 10) || 256,
            timeout: parseInt(formData.get('timeout') as string, 10) || 30000,
            env: expectJson(
              (formData.get('env') as string) || '{}',
              EnvRecordSchema,
              'worker env',
            ),
          }
        } else {
          const jsonBody = body as {
            name?: string
            runtime?: RuntimeType
            handler?: string
            code?: string | ArrayBuffer
            memory?: number
            timeout?: number
            env?: Record<string, string>
          }
          params = {
            name: jsonBody.name,
            runtime: jsonBody.runtime,
            handler: jsonBody.handler,
            code:
              typeof jsonBody.code === 'string'
                ? Buffer.from(jsonBody.code, 'base64')
                : jsonBody.code instanceof ArrayBuffer
                  ? Buffer.from(jsonBody.code)
                  : (jsonBody.code ?? Buffer.alloc(0)),
            memory: jsonBody.memory,
            timeout: jsonBody.timeout,
            env: jsonBody.env,
          }
        }

        if (!params.name) {
          set.status = 400
          return { error: 'Function name required' }
        }

        // Upload code to storage
        const codeBuffer =
          params.code instanceof Buffer ? params.code : Buffer.from(params.code)
        const uploadResult = await backend.upload(codeBuffer, {
          filename: `${params.name}.js`,
        })

        const functionId = crypto.randomUUID()
        const fn: WorkerFunction = {
          id: functionId,
          name: params.name,
          owner,
          runtime: params.runtime ?? 'bun',
          handler: params.handler ?? 'index.handler',
          codeCid: uploadResult.cid,
          memory: params.memory ?? 256,
          timeout: params.timeout ?? 30000,
          env: params.env ?? {},
          status: 'active',
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          invocationCount: 0,
          avgDurationMs: 0,
          errorCount: 0,
        }

        await runtime.deployFunction(fn)

        set.status = 201
        return {
          functionId: fn.id,
          name: fn.name,
          codeCid: fn.codeCid,
          status: fn.status,
        }
      },
      {
        headers: t.Object({
          'x-jeju-address': t.Optional(t.String()),
          'content-type': t.Optional(t.String()),
        }),
      },
    )

    // List functions
    .get(
      '/',
      ({ headers }) => {
        const owner = headers['x-jeju-address']
        let functions = runtime.listFunctions()

        if (owner) {
          functions = functions.filter(
            (f) => f.owner.toLowerCase() === owner.toLowerCase(),
          )
        }

        return {
          functions: functions.map((f) => ({
            id: f.id,
            name: f.name,
            runtime: f.runtime,
            memory: f.memory,
            timeout: f.timeout,
            status: f.status,
            version: f.version,
            invocationCount: f.invocationCount,
            avgDurationMs: f.avgDurationMs,
            createdAt: f.createdAt,
            updatedAt: f.updatedAt,
          })),
        }
      },
      {
        headers: t.Object({
          'x-jeju-address': t.Optional(t.String()),
        }),
      },
    )

    // Get function
    .get(
      '/:functionId',
      ({ params, set }) => {
        const fn = runtime.getFunction(params.functionId)
        if (!fn) {
          set.status = 404
          return { error: 'Function not found' }
        }

        return {
          ...fn,
          metrics: runtime.getMetrics(fn.id),
        }
      },
      {
        params: t.Object({
          functionId: t.String(),
        }),
      },
    )

    // Update function
    .put(
      '/:functionId',
      async ({ params, headers, body, set }) => {
        const owner = headers['x-jeju-address']
        if (!owner) {
          set.status = 401
          return { error: 'x-jeju-address header required' }
        }

        const fn = runtime.getFunction(params.functionId)

        if (!fn) {
          set.status = 404
          return { error: 'Function not found' }
        }

        if (fn.owner.toLowerCase() !== owner.toLowerCase()) {
          set.status = 403
          return { error: 'Not authorized' }
        }

        const updates = body as {
          code?: string | ArrayBuffer
          memory?: number
          timeout?: number
          env?: Record<string, string>
          handler?: string
        }

        // If code is updated, upload new version
        if (updates.code) {
          const codeBuffer =
            typeof updates.code === 'string'
              ? Buffer.from(updates.code, 'base64')
              : Buffer.isBuffer(updates.code)
                ? updates.code
                : Buffer.from(new Uint8Array(updates.code as ArrayBuffer))

          const uploadResult = await backend.upload(codeBuffer, {
            filename: `${fn.name}.js`,
          })

          fn.codeCid = uploadResult.cid
          fn.version++
        }

        if (updates.memory) fn.memory = updates.memory
        if (updates.timeout) fn.timeout = updates.timeout
        if (updates.env) fn.env = { ...fn.env, ...updates.env }
        if (updates.handler) fn.handler = updates.handler
        fn.updatedAt = Date.now()

        // Redeploy
        await runtime.undeployFunction(fn.id)
        await runtime.deployFunction(fn)

        return { success: true, version: fn.version }
      },
      {
        params: t.Object({
          functionId: t.String(),
        }),
        headers: t.Object({
          'x-jeju-address': t.Optional(t.String()),
        }),
        body: t.Object({
          code: t.Optional(t.String()),
          memory: t.Optional(t.Number()),
          timeout: t.Optional(t.Number()),
          env: t.Optional(t.Record(t.String(), t.String())),
          handler: t.Optional(t.String()),
        }),
      },
    )

    // Delete function
    .delete(
      '/:functionId',
      async ({ params, headers, set }) => {
        const owner = headers['x-jeju-address']
        if (!owner) {
          set.status = 401
          return { error: 'x-jeju-address header required' }
        }

        const fn = runtime.getFunction(params.functionId)

        if (!fn) {
          set.status = 404
          return { error: 'Function not found' }
        }

        if (fn.owner.toLowerCase() !== owner.toLowerCase()) {
          set.status = 403
          return { error: 'Not authorized' }
        }

        await runtime.undeployFunction(fn.id)
        return { success: true }
      },
      {
        params: t.Object({
          functionId: t.String(),
        }),
        headers: t.Object({
          'x-jeju-address': t.Optional(t.String()),
        }),
      },
    )

    // ============================================================================
    // Invocation
    // ============================================================================

    // Synchronous invocation
    .post(
      '/:functionId/invoke',
      async ({ params, body, set }) => {
        const fn = runtime.getFunction(params.functionId)
        if (!fn) {
          set.status = 404
          return { error: 'Function not found' }
        }

        const result = await runtime.invoke({
          functionId: fn.id,
          payload: body.payload,
          type: 'sync',
        })

        return result
      },
      {
        params: t.Object({
          functionId: t.String(),
        }),
        body: t.Object({
          payload: t.Unknown(),
        }),
      },
    )

    // Async invocation (fire and forget)
    .post(
      '/:functionId/invoke-async',
      async ({ params, body, set }) => {
        const fn = runtime.getFunction(params.functionId)
        if (!fn) {
          set.status = 404
          return { error: 'Function not found' }
        }

        // Start invocation but don't wait
        runtime
          .invoke({
            functionId: fn.id,
            payload: body.payload,
            type: 'async',
          })
          .catch(console.error)

        set.status = 202
        return {
          status: 'accepted',
          functionId: fn.id,
        }
      },
      {
        params: t.Object({
          functionId: t.String(),
        }),
        body: t.Object({
          payload: t.Unknown(),
        }),
      },
    )

    // HTTP handler (for web functions)
    .all(
      '/:functionId/http/*',
      async ({ params, request, set }) => {
        const fn = runtime.getFunction(params.functionId)
        if (!fn) {
          set.status = 404
          return { error: 'Function not found' }
        }

        const url = new URL(request.url)
        const path = url.pathname.replace(`/workers/${fn.id}/http`, '') || '/'

        const requestHeaders: Record<string, string> = {}
        request.headers.forEach((value, key) => {
          requestHeaders[key] = value
        })

        const event: HTTPEvent = {
          method: request.method,
          path,
          headers: requestHeaders,
          query: Object.fromEntries(url.searchParams),
          body:
            request.method !== 'GET' && request.method !== 'HEAD'
              ? await request.text()
              : null,
        }

        const response = await runtime.invokeHTTP(fn.id, event)

        return new Response(response.body, {
          status: response.statusCode,
          headers: response.headers,
        })
      },
      {
        params: t.Object({
          functionId: t.String(),
          '*': t.String(),
        }),
      },
    )

    // ============================================================================
    // Logs and Metrics
    // ============================================================================

    .get(
      '/:functionId/logs',
      ({ params, query, set }) => {
        const fn = runtime.getFunction(params.functionId)
        if (!fn) {
          set.status = 404
          return { error: 'Function not found' }
        }

        const limit = parseInt(query.limit ?? '100', 10)
        const since = parseInt(query.since ?? '0', 10)

        const logs = runtime.getLogs(fn.id, { limit, since })

        return {
          functionId: fn.id,
          logs,
          count: logs.length,
        }
      },
      {
        params: t.Object({
          functionId: t.String(),
        }),
        query: t.Object({
          limit: t.Optional(t.String()),
          since: t.Optional(t.String()),
        }),
      },
    )

    .get(
      '/:functionId/metrics',
      ({ params, set }) => {
        const fn = runtime.getFunction(params.functionId)
        if (!fn) {
          set.status = 404
          return { error: 'Function not found' }
        }

        return runtime.getMetrics(fn.id)
      },
      {
        params: t.Object({
          functionId: t.String(),
        }),
      },
    )

  return router
}

export type WorkersRoutes = ReturnType<typeof createWorkersRouter>
