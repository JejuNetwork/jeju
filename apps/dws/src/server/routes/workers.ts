/**
 * Workers API Routes
 * Serverless function deployment and invocation
 */

import { Hono } from 'hono'
import {
  contentTypeHeaderSchema,
  jejuAddressHeaderSchema,
  validateBody,
  validateHeaders,
  validateParams,
  validateQuery,
  z,
} from '../../shared'
import {
  deployWorkerRequestSchema,
  invokeWorkerRequestSchema,
  workerParamsSchema,
} from '../../shared/schemas/workers'
import type { BackendManager } from '../../storage/backends'
import { WorkerRuntime } from '../../workers/runtime'
import type {
  DeployParams,
  HTTPEvent,
  WorkerRuntime as RuntimeType,
  WorkerFunction,
} from '../../workers/types'

export function createWorkersRouter(backend: BackendManager): Hono {
  const router = new Hono()
  const runtime = new WorkerRuntime(backend)

  // Health check
  router.get('/health', (c) => {
    const stats = runtime.getStats()
    return c.json({
      status: 'healthy',
      service: 'dws-workers',
      ...stats,
    })
  })

  // ============================================================================
  // Function Management
  // ============================================================================

  // Deploy function
  router.post('/', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(
      jejuAddressHeaderSchema,
      c,
    )
    const { 'content-type': contentType } = validateHeaders(
      contentTypeHeaderSchema,
      c,
    )
    let params: DeployParams

    if (contentType?.includes('multipart/form-data')) {
      const formData = await c.req.formData()
      const codeFile = formData.get('code')
      if (!(codeFile instanceof File)) {
        return c.json({ error: 'Code file required' }, 400)
      }

      params = {
        name: formData.get('name') as string,
        runtime: (formData.get('runtime') as RuntimeType) ?? 'bun',
        handler: (formData.get('handler') as string) ?? 'index.handler',
        code: Buffer.from(await codeFile.arrayBuffer()),
        memory: parseInt(formData.get('memory') as string, 10) || 256,
        timeout: parseInt(formData.get('timeout') as string, 10) || 30000,
        env: JSON.parse((formData.get('env') as string) || '{}'),
      }
    } else {
      const body = await validateBody(deployWorkerRequestSchema, c)
      params = {
        ...body,
        code:
          typeof body.code === 'string'
            ? Buffer.from(body.code, 'base64')
            : body.code instanceof ArrayBuffer
              ? Buffer.from(body.code)
              : (body.code ?? Buffer.alloc(0)),
      }
    }

    if (!params.name) {
      throw new Error('Function name required')
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

    return c.json(
      {
        functionId: fn.id,
        name: fn.name,
        codeCid: fn.codeCid,
        status: fn.status,
      },
      201,
    )
  })

  // List functions
  router.get('/', (c) => {
    const owner = c.req.header('x-jeju-address')
    let functions = runtime.listFunctions()

    if (owner) {
      functions = functions.filter(
        (f) => f.owner.toLowerCase() === owner.toLowerCase(),
      )
    }

    return c.json({
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
    })
  })

  // Get function
  router.get('/:functionId', (c) => {
    const { functionId } = validateParams(workerParamsSchema, c)
    const fn = runtime.getFunction(functionId)
    if (!fn) {
      throw new Error('Function not found')
    }

    return c.json({
      ...fn,
      metrics: runtime.getMetrics(fn.id),
    })
  })

  // Update function
  router.put('/:functionId', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(
      jejuAddressHeaderSchema,
      c,
    )
    const { functionId } = validateParams(workerParamsSchema, c)
    const fn = runtime.getFunction(functionId)

    if (!fn) {
      throw new Error('Function not found')
    }

    if (fn.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized')
    }

    const updates = await validateBody(deployWorkerRequestSchema.partial(), c)

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

    return c.json({ success: true, version: fn.version })
  })

  // Delete function
  router.delete('/:functionId', async (c) => {
    const { 'x-jeju-address': owner } = validateHeaders(
      jejuAddressHeaderSchema,
      c,
    )
    const { functionId } = validateParams(workerParamsSchema, c)
    const fn = runtime.getFunction(functionId)

    if (!fn) {
      throw new Error('Function not found')
    }

    if (fn.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized')
    }

    await runtime.undeployFunction(fn.id)
    return c.json({ success: true })
  })

  // ============================================================================
  // Invocation
  // ============================================================================

  // Synchronous invocation
  router.post('/:functionId/invoke', async (c) => {
    const { functionId } = validateParams(workerParamsSchema, c)
    const fn = runtime.getFunction(functionId)
    if (!fn) {
      throw new Error('Function not found')
    }

    const { payload } = await validateBody(invokeWorkerRequestSchema, c)

    const result = await runtime.invoke({
      functionId: fn.id,
      payload,
      type: 'sync',
    })

    return c.json(result)
  })

  // Async invocation (fire and forget)
  router.post('/:functionId/invoke-async', async (c) => {
    const { functionId } = validateParams(workerParamsSchema, c)
    const fn = runtime.getFunction(functionId)
    if (!fn) {
      throw new Error('Function not found')
    }

    const { payload } = await validateBody(invokeWorkerRequestSchema, c)

    // Start invocation but don't wait
    runtime
      .invoke({
        functionId: fn.id,
        payload,
        type: 'async',
      })
      .catch(console.error)

    return c.json(
      {
        status: 'accepted',
        functionId: fn.id,
      },
      202,
    )
  })

  // HTTP handler (for web functions)
  router.all('/:functionId/http/*', async (c) => {
    const { functionId } = validateParams(workerParamsSchema, c)
    const fn = runtime.getFunction(functionId)
    if (!fn) {
      throw new Error('Function not found')
    }

    const url = new URL(c.req.url)
    const path = url.pathname.replace(`/workers/${fn.id}/http`, '') || '/'

    const requestHeaders: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      requestHeaders[key] = value
    })

    const event: HTTPEvent = {
      method: c.req.method,
      path,
      headers: requestHeaders,
      query: Object.fromEntries(url.searchParams),
      body:
        c.req.method !== 'GET' && c.req.method !== 'HEAD'
          ? await c.req.text()
          : null,
    }

    const response = await runtime.invokeHTTP(fn.id, event)

    return new Response(response.body, {
      status: response.statusCode,
      headers: response.headers,
    })
  })

  // ============================================================================
  // Logs and Metrics
  // ============================================================================

  router.get('/:functionId/logs', (c) => {
    const { functionId } = validateParams(workerParamsSchema, c)
    const fn = runtime.getFunction(functionId)
    if (!fn) {
      throw new Error('Function not found')
    }

    const { limit, since } = validateQuery(
      z.object({
        limit: z.coerce.number().int().positive().max(1000).default(100),
        since: z.coerce.number().int().nonnegative().default(0),
      }),
      c,
    )

    const logs = runtime.getLogs(fn.id, { limit, since })

    return c.json({
      functionId: fn.id,
      logs,
      count: logs.length,
    })
  })

  router.get('/:functionId/metrics', (c) => {
    const { functionId } = validateParams(workerParamsSchema, c)
    const fn = runtime.getFunction(functionId)
    if (!fn) {
      throw new Error('Function not found')
    }

    return c.json(runtime.getMetrics(fn.id))
  })

  return router
}
