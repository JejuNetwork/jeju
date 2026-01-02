/**
 * Workers API Routes
 * Serverless function deployment and invocation
 */

import {
  expectJson,
  expectValid,
  getFormInt,
  getFormString,
} from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'
import type { JSONValue } from '../../shared/validation'
import { dwsWorkerState } from '../../state'
import type { BackendManager } from '../../storage/backends'
import { WorkerRuntime } from '../../workers/runtime'
import type {
  DeployParams,
  HTTPEvent,
  WorkerRuntime as RuntimeType,
  WorkerFunction,
} from '../../workers/types'

const EnvRecordSchema = z.record(z.string(), z.string())
const RuntimeTypeSchema = z.enum(['bun', 'node', 'deno'])

/** Zod schema for worker deployment */
const DeployWorkerJsonBodySchema = z.object({
  name: z.string().optional(),
  runtime: RuntimeTypeSchema.optional(),
  handler: z.string().optional(),
  code: z.string().optional(),
  codeCid: z.string().optional(), // Deploy from pre-uploaded IPFS CID
  memory: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
  env: EnvRecordSchema.optional(),
})

/** Zod schema for worker update */
const UpdateWorkerJsonBodySchema = z.object({
  code: z.string().optional(),
  memory: z.number().int().positive().optional(),
  timeout: z.number().int().positive().optional(),
  env: EnvRecordSchema.optional(),
  handler: z.string().optional(),
})

// Shared runtime instance for use by other modules
let sharedRuntime: WorkerRuntime | null = null

// Cache for CID -> functionId mapping (for lazy deployment)
const cidToFunctionId = new Map<string, string>()

export function getSharedWorkersRuntime(): WorkerRuntime | null {
  return sharedRuntime
}

/**
 * Check if a string looks like an IPFS CID
 */
function isIPFSCid(str: string): boolean {
  return str.startsWith('Qm') || str.startsWith('bafy')
}

/**
 * Deploy a worker from a CID on-demand
 */
async function deployFromCid(
  runtime: WorkerRuntime,
  backend: BackendManager,
  cid: string,
): Promise<WorkerFunction> {
  // Check cache first
  const cachedId = cidToFunctionId.get(cid)
  if (cachedId) {
    const fn = runtime.getFunction(cachedId)
    if (fn) {
      return fn
    }
    // Cached ID but function not in runtime - remove from cache and redeploy
    cidToFunctionId.delete(cid)
  }

  console.log(`[Workers] Deploying worker from CID: ${cid}`)

  // Verify code exists in storage
  const codeExists = await backend.exists(cid)
  if (!codeExists) {
    throw new Error(`Code CID not found in storage: ${cid}`)
  }

  const functionId = crypto.randomUUID()
  const fn: WorkerFunction = {
    id: functionId,
    name: `worker-${cid.slice(0, 8)}`,
    owner: '0x0000000000000000000000000000000000000000' as Address,
    runtime: 'bun',
    handler: 'fetch',
    codeCid: cid,
    memory: 512,
    timeout: 60000,
    env: {},
    status: 'active',
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    invocationCount: 0,
    avgDurationMs: 0,
    errorCount: 0,
  }

  await runtime.deployFunction(fn)
  cidToFunctionId.set(cid, functionId)
  console.log(`[Workers] Deployed worker ${functionId} from CID ${cid}`)

  return fn
}

/**
 * Load a specific worker from SQLit by ID and deploy to runtime
 * Used for on-demand loading when a function is not found in memory
 */
async function loadWorkerById(runtime: WorkerRuntime, functionId: string): Promise<WorkerFunction | null> {
  try {
    const worker = await dwsWorkerState.get(functionId)
    if (!worker) return null
    
    const fn: WorkerFunction = {
      id: worker.id,
      name: worker.name,
      owner: worker.owner as Address,
      runtime: worker.runtime,
      handler: worker.handler,
      codeCid: worker.codeCid,
      memory: worker.memory,
      timeout: worker.timeout,
      env: worker.env,
      status: worker.status,
      version: worker.version,
      createdAt: worker.createdAt,
      updatedAt: worker.updatedAt,
      invocationCount: worker.invocationCount,
      avgDurationMs: worker.avgDurationMs,
      errorCount: worker.errorCount,
    }
    
    await runtime.deployFunction(fn)
    console.log(`[Workers] On-demand loaded worker from SQLit: ${worker.name} (${worker.id})`)
    return fn
  } catch (err) {
    console.warn(`[Workers] Failed to load worker ${functionId} from SQLit: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * Load persisted workers from SQLit and deploy them to the runtime
 */
async function loadPersistedWorkers(runtime: WorkerRuntime): Promise<void> {
  try {
    const workers = await dwsWorkerState.listActive()
    console.log(
      `[Workers] Loading ${workers.length} persisted workers from SQLit`,
    )

    for (const worker of workers) {
      try {
        const fn: WorkerFunction = {
          id: worker.id,
          name: worker.name,
          owner: worker.owner as Address,
          runtime: worker.runtime,
          handler: worker.handler,
          codeCid: worker.codeCid,
          memory: worker.memory,
          timeout: worker.timeout,
          env: worker.env,
          status: worker.status,
          version: worker.version,
          createdAt: worker.createdAt,
          updatedAt: worker.updatedAt,
          invocationCount: worker.invocationCount,
          avgDurationMs: worker.avgDurationMs,
          errorCount: worker.errorCount,
        }
        await runtime.deployFunction(fn)
        console.log(`[Workers] Loaded worker: ${worker.name} (${worker.id})`)
      } catch (err) {
        console.warn(
          `[Workers] Failed to load worker ${worker.name}: ${err instanceof Error ? err.message : String(err)}`,
        )
        // Mark as inactive if load fails
        await dwsWorkerState.updateStatus(worker.id, 'error')
      }
    }
  } catch (err) {
    // SQLit might not be available - that's okay for development
    console.log(
      `[Workers] SQLit not available for worker persistence: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

export function createWorkersRouter(backend: BackendManager) {
  const runtime = new WorkerRuntime(backend)
  sharedRuntime = runtime // Store reference for shared access

  // Load persisted workers from SQLit on startup (async, non-blocking)
  loadPersistedWorkers(runtime).catch((err) => {
    console.warn(
      `[Workers] Failed to load persisted workers: ${err instanceof Error ? err.message : String(err)}`,
    )
  })

  return (
    new Elysia({ name: 'workers', prefix: '/workers' })
      // Health check
      .get('/health', () => {
        const stats = runtime.getStats()
        return {
          status: 'healthy',
          service: 'dws-workers',
          ...stats,
        }
      })

      // Function Management

      // Deploy function
      .post(
        '/',
        async ({ headers, body, set }) => {
          const owner = headers['x-jeju-address']
          if (!owner) {
            set.status = 401
            return { error: 'x-jeju-address header required' }
          }

          const contentType = headers['content-type'] ?? ''
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

            const formName = getFormString(formData, 'name')
            if (!formName) {
              set.status = 400
              return { error: 'name is required' }
            }
            params = {
              name: formName,
              runtime:
                (getFormString(formData, 'runtime') as RuntimeType) ?? 'bun',
              handler: getFormString(formData, 'handler') ?? 'index.handler',
              code: Buffer.from(await codeFile.arrayBuffer()),
              memory: getFormInt(formData, 'memory', 256),
              timeout: getFormInt(formData, 'timeout', 30000),
              env: expectJson(
                getFormString(formData, 'env') ?? '{}',
                EnvRecordSchema,
                'worker env',
              ),
            }
          } else {
            const jsonBody = expectValid(
              DeployWorkerJsonBodySchema,
              body,
              'Deploy worker body',
            )

            // Support deploying from pre-uploaded CID
            if (jsonBody.codeCid) {
              // Verify code exists in storage
              const codeExists = await backend.exists(jsonBody.codeCid)
              if (!codeExists) {
                set.status = 400
                return {
                  error: `Code CID not found in storage: ${jsonBody.codeCid}`,
                }
              }

              const functionId = crypto.randomUUID()
              const fn: WorkerFunction = {
                id: functionId,
                name: jsonBody.name ?? `worker-${functionId.slice(0, 8)}`,
                owner: owner as Address,
                runtime: jsonBody.runtime ?? 'bun',
                handler: jsonBody.handler ?? 'index.handler',
                codeCid: jsonBody.codeCid,
                memory: jsonBody.memory ?? 256,
                timeout: jsonBody.timeout ?? 30000,
                env: jsonBody.env ?? {},
                status: 'active',
                version: 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                invocationCount: 0,
                avgDurationMs: 0,
                errorCount: 0,
              }

              await runtime.deployFunction(fn)

              // Persist to SQLit for recovery across pod restarts
              try {
                await dwsWorkerState.save({
                  id: fn.id,
                  name: fn.name,
                  owner: fn.owner,
                  runtime: fn.runtime as 'bun' | 'node' | 'deno',
                  handler: fn.handler,
                  codeCid: fn.codeCid,
                  memory: fn.memory,
                  timeout: fn.timeout,
                  env: fn.env,
                  status: fn.status as 'active' | 'inactive' | 'error',
                  version: fn.version,
                  invocationCount: fn.invocationCount,
                  avgDurationMs: fn.avgDurationMs,
                  errorCount: fn.errorCount,
                  createdAt: fn.createdAt,
                  updatedAt: fn.updatedAt,
                })
              } catch (persistError) {
                console.warn(
                  `[Workers] Failed to persist worker to SQLit: ${persistError instanceof Error ? persistError.message : String(persistError)}`,
                )
              }

              set.status = 201
              return {
                functionId: fn.id,
                name: fn.name,
                codeCid: fn.codeCid,
                status: fn.status,
              }
            }

            params = {
              name: jsonBody.name ?? '',
              runtime: jsonBody.runtime,
              handler: jsonBody.handler,
              code:
                typeof jsonBody.code === 'string'
                  ? Buffer.from(jsonBody.code, 'base64')
                  : ArrayBuffer.isView(jsonBody.code)
                    ? Buffer.from(jsonBody.code as ArrayBufferLike)
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
            params.code instanceof Buffer
              ? params.code
              : Buffer.from(params.code)
          const uploadResult = await backend.upload(codeBuffer, {
            filename: `${params.name}.js`,
          })

          const functionId = crypto.randomUUID()
          const fn: WorkerFunction = {
            id: functionId,
            name: params.name,
            owner: owner as Address,
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

          // Persist to SQLit for recovery across pod restarts
          try {
            await dwsWorkerState.save({
              id: fn.id,
              name: fn.name,
              owner: fn.owner,
              runtime: fn.runtime as 'bun' | 'node' | 'deno',
              handler: fn.handler,
              codeCid: fn.codeCid,
              memory: fn.memory,
              timeout: fn.timeout,
              env: fn.env,
              status: fn.status as 'active' | 'inactive' | 'error',
              version: fn.version,
              invocationCount: fn.invocationCount,
              avgDurationMs: fn.avgDurationMs,
              errorCount: fn.errorCount,
              createdAt: fn.createdAt,
              updatedAt: fn.updatedAt,
            })
          } catch (persistError) {
            console.warn(
              `[Workers] Failed to persist worker to SQLit: ${persistError instanceof Error ? persistError.message : String(persistError)}`,
            )
          }

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

          const updates = expectValid(
            UpdateWorkerJsonBodySchema,
            body,
            'Update worker body',
          )

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

      // Invocation

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
            payload: body.payload as JSONValue,
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
              payload: body.payload as JSONValue,
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
      // Define handler once, then apply to all HTTP methods
      // Note: Elysia's .all() doesn't include GET, so we explicitly register each method
      .route(
        'GET',
        '/:functionId/http/*',
        async ({ params, request, set }) => {
          let fn = runtime.getFunction(params.functionId)

          // If not found in memory, try to load from SQLit (on-demand for multi-pod)
          if (!fn) {
            const loadedFn = await loadWorkerById(runtime, params.functionId)
            if (loadedFn) {
              fn = loadedFn
            }
          }

          // If still not found, check if the ID is a CID and deploy on-demand
          if (!fn && isIPFSCid(params.functionId)) {
            console.log(
              `[Workers] Function ${params.functionId} not found, attempting CID deployment`,
            )
            try {
              const deployed = await deployFromCid(
                runtime,
                backend,
                params.functionId,
              )
              fn = deployed
            } catch (err) {
              console.error(
                `[Workers] Failed to deploy from CID: ${err instanceof Error ? err.message : String(err)}`,
              )
            }
          }

          if (!fn) {
            set.status = 404
            return { error: 'Function not found' }
          }

          const url = new URL(request.url)
          // Use params.functionId (could be CID or UUID) for path extraction
          const path =
            url.pathname.replace(`/workers/${params.functionId}/http`, '') ||
            '/'

          const requestHeaders: Record<string, string> = {}
          request.headers.forEach((value, key) => {
            requestHeaders[key] = value
          })

          const event: HTTPEvent = {
            method: request.method,
            path,
            headers: requestHeaders,
            query: Object.fromEntries(url.searchParams),
            body: null,
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
      .post(
        '/:functionId/http/*',
        async ({ params, request, set }) => {
          let fn = runtime.getFunction(params.functionId)

          // If not found in memory, try to load from SQLit (on-demand for multi-pod)
          if (!fn) {
            const loadedFn = await loadWorkerById(runtime, params.functionId)
            if (loadedFn) fn = loadedFn
          }

          if (!fn && isIPFSCid(params.functionId)) {
            console.log(`[Workers] Function ${params.functionId} not found, attempting CID deployment`)
            try {
              const deployed = await deployFromCid(runtime, backend, params.functionId)
              fn = deployed
            } catch (err) {
              console.error(`[Workers] Failed to deploy from CID: ${err instanceof Error ? err.message : String(err)}`)
            }
          }

          if (!fn) {
            set.status = 404
            return { error: 'Function not found' }
          }

          const url = new URL(request.url)
          const path = url.pathname.replace(`/workers/${params.functionId}/http`, '') || '/'

          const requestHeaders: Record<string, string> = {}
          request.headers.forEach((value, key) => {
            requestHeaders[key] = value
          })

          const event: HTTPEvent = {
            method: request.method,
            path,
            headers: requestHeaders,
            query: Object.fromEntries(url.searchParams),
            body: await request.text(),
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
      .put(
        '/:functionId/http/*',
        async ({ params, request, set }) => {
          let fn = runtime.getFunction(params.functionId)

          // If not found in memory, try to load from SQLit (on-demand for multi-pod)
          if (!fn) {
            const loadedFn = await loadWorkerById(runtime, params.functionId)
            if (loadedFn) fn = loadedFn
          }

          if (!fn && isIPFSCid(params.functionId)) {
            try {
              const deployed = await deployFromCid(runtime, backend, params.functionId)
              fn = deployed
            } catch (err) {
              console.error(`[Workers] Failed to deploy from CID: ${err instanceof Error ? err.message : String(err)}`)
            }
          }

          if (!fn) {
            set.status = 404
            return { error: 'Function not found' }
          }

          const url = new URL(request.url)
          const path = url.pathname.replace(`/workers/${params.functionId}/http`, '') || '/'

          const requestHeaders: Record<string, string> = {}
          request.headers.forEach((value, key) => {
            requestHeaders[key] = value
          })

          const event: HTTPEvent = {
            method: request.method,
            path,
            headers: requestHeaders,
            query: Object.fromEntries(url.searchParams),
            body: await request.text(),
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
      .patch(
        '/:functionId/http/*',
        async ({ params, request, set }) => {
          let fn = runtime.getFunction(params.functionId)

          // If not found in memory, try to load from SQLit (on-demand for multi-pod)
          if (!fn) {
            const loadedFn = await loadWorkerById(runtime, params.functionId)
            if (loadedFn) fn = loadedFn
          }

          if (!fn && isIPFSCid(params.functionId)) {
            try {
              const deployed = await deployFromCid(runtime, backend, params.functionId)
              fn = deployed
            } catch (err) {
              console.error(`[Workers] Failed to deploy from CID: ${err instanceof Error ? err.message : String(err)}`)
            }
          }

          if (!fn) {
            set.status = 404
            return { error: 'Function not found' }
          }

          const url = new URL(request.url)
          const path = url.pathname.replace(`/workers/${params.functionId}/http`, '') || '/'

          const requestHeaders: Record<string, string> = {}
          request.headers.forEach((value, key) => {
            requestHeaders[key] = value
          })

          const event: HTTPEvent = {
            method: request.method,
            path,
            headers: requestHeaders,
            query: Object.fromEntries(url.searchParams),
            body: await request.text(),
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
      .delete(
        '/:functionId/http/*',
        async ({ params, request, set }) => {
          let fn = runtime.getFunction(params.functionId)

          // If not found in memory, try to load from SQLit (on-demand for multi-pod)
          if (!fn) {
            const loadedFn = await loadWorkerById(runtime, params.functionId)
            if (loadedFn) fn = loadedFn
          }

          if (!fn && isIPFSCid(params.functionId)) {
            try {
              const deployed = await deployFromCid(runtime, backend, params.functionId)
              fn = deployed
            } catch (err) {
              console.error(`[Workers] Failed to deploy from CID: ${err instanceof Error ? err.message : String(err)}`)
            }
          }

          if (!fn) {
            set.status = 404
            return { error: 'Function not found' }
          }

          const url = new URL(request.url)
          const path = url.pathname.replace(`/workers/${params.functionId}/http`, '') || '/'

          const requestHeaders: Record<string, string> = {}
          request.headers.forEach((value, key) => {
            requestHeaders[key] = value
          })

          const event: HTTPEvent = {
            method: request.method,
            path,
            headers: requestHeaders,
            query: Object.fromEntries(url.searchParams),
            body: await request.text(),
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

      // Logs and Metrics

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
  )
}

export type WorkersRoutes = ReturnType<typeof createWorkersRouter>
