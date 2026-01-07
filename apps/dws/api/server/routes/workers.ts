/**
 * Workers API Routes
 * Serverless function deployment and invocation
 *
 * Features:
 * - Multi-tier worker lookup (memory → cache → SQLit)
 * - Cross-pod synchronization via WorkerRegistryService
 * - Background sync to keep workers loaded across pods
 * - Retry logic with exponential backoff for reliability
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
import { dwsWorkerCronState, dwsWorkerState } from '../../state'
import type { BackendManager } from '../../storage/backends'
import {
  getWorkerRegistry,
  type WorkerRegistryService,
} from '../../workers/registry-service'
import { WorkerRuntime } from '../../workers/runtime'
import type {
  DeployParams,
  HTTPEvent,
  WorkerRuntime as RuntimeType,
  WorkerFunction,
} from '../../workers/types'

const EnvRecordSchema = z.record(z.string(), z.string())
const RuntimeTypeSchema = z.enum(['bun', 'node', 'deno'])

/** Zod schema for cron schedule */
const CronScheduleSchema = z.object({
  name: z.string().min(1).max(64),
  schedule: z.string().min(9).max(64), // e.g., "*/5 * * * *" is 11 chars
  endpoint: z.string().min(1).max(256),
  timezone: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().min(0).max(5).optional(),
})

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
  crons: z.array(CronScheduleSchema).optional(), // Cron schedules to register
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

// Shared registry instance
let sharedRegistry: WorkerRegistryService | null = null

// Shared backend manager instance
let sharedBackend: BackendManager | null = null

// Cache for CID -> functionId mapping (for lazy deployment)
const cidToFunctionId = new Map<string, string>()

export function getSharedWorkersRuntime(): WorkerRuntime | null {
  return sharedRuntime
}

export function getSharedWorkerRegistry(): WorkerRegistryService | null {
  return sharedRegistry
}

/**
 * Public interface to getOrLoadWorker for use by other modules (e.g., app-router)
 * Handles both UUID and CID-based worker IDs
 */
export async function getOrLoadWorkerPublic(
  functionId: string,
): Promise<WorkerFunction | null> {
  if (!sharedRuntime || !sharedBackend) {
    console.error('[Workers] Runtime or backend not initialized')
    return null
  }

  return getOrLoadWorker(functionId, sharedBackend)
}

/**
 * Check if a string looks like an IPFS CID
 */
function isIPFSCid(str: string): boolean {
  return str.startsWith('Qm') || str.startsWith('bafy')
}

/**
 * Get or load a worker with multi-tier fallback
 *
 * This is the primary entry point for worker lookup. It uses the registry
 * service to check all tiers (memory, cache, SQLit) and handles cold starts.
 *
 * @param functionId - Worker UUID or CID
 * @returns Worker function if found, null otherwise
 */
async function getOrLoadWorker(
  functionId: string,
  backend: BackendManager,
): Promise<WorkerFunction | null> {
  const registry = getWorkerRegistry()
  const runtime = sharedRuntime

  if (!runtime) {
    console.error('[Workers] Runtime not initialized')
    return null
  }

  // First check local runtime memory (fastest path)
  const localFn = runtime.getFunction(functionId)
  if (localFn) {
    return localFn
  }

  // Use registry for multi-tier lookup
  const result = await registry.getWorker(functionId)
  if (result) {
    console.log(
      `[Workers] Loaded worker ${result.worker.name} from ${result.source} (${result.loadTimeMs}ms, coldStart=${result.coldStart})`,
    )
    return result.worker
  }

  // If functionId looks like a CID, try CID-based lookup
  if (isIPFSCid(functionId)) {
    const cidResult = await registry.getWorkerByCid(functionId)
    if (cidResult) {
      console.log(
        `[Workers] Loaded worker by CID from ${cidResult.source} (${cidResult.loadTimeMs}ms)`,
      )
      return cidResult.worker
    }

    // CID not in database - deploy fresh from IPFS
    console.log(`[Workers] Deploying new worker from CID: ${functionId}`)
    const deployed = await deployFromCid(runtime, backend, functionId)
    return deployed
  }

  return null
}

/**
 * Deploy a worker from a CID on-demand
 * Uses registry for lookup and persists for cross-pod recovery
 */
async function deployFromCid(
  runtime: WorkerRuntime,
  backend: BackendManager,
  cid: string,
): Promise<WorkerFunction> {
  const registry = getWorkerRegistry()

  // Check local cache first
  const cachedId = cidToFunctionId.get(cid)
  if (cachedId) {
    const fn = runtime.getFunction(cachedId)
    if (fn) {
      return fn
    }
    cidToFunctionId.delete(cid)
  }

  // Try registry lookup by CID
  const registryResult = await registry.getWorkerByCid(cid)
  if (registryResult) {
    cidToFunctionId.set(cid, registryResult.worker.id)
    return registryResult.worker
  }

  console.log(`[Workers] Deploying new worker from CID: ${cid}`)

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

  // Register with registry
  registry.registerLocalWorker(fn)

  // Persist to SQLit for multi-pod recovery
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

  // Update location in shared cache
  registry.updateWorkerLocation(fn.id)

  console.log(`[Workers] Deployed worker ${functionId} from CID ${cid}`)

  return fn
}

/**
 * Load persisted workers from SQLit and deploy them to the runtime
 * Also registers them with the WorkerRegistryService for cross-pod discovery
 */
async function loadPersistedWorkers(
  runtime: WorkerRuntime,
  registry: WorkerRegistryService,
): Promise<{ loaded: number; failed: number }> {
  let loaded = 0
  const failed = 0

  const workers = await dwsWorkerState.listActive()
  console.log(
    `[Workers] Loading ${workers.length} persisted workers from SQLit`,
  )

  for (const worker of workers) {
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

    // Register with registry for cross-pod discovery
    registry.registerLocalWorker(fn)

    console.log(`[Workers] Loaded worker: ${worker.name} (${worker.id})`)
    loaded++
  }

  console.log(
    `[Workers] Startup load complete: ${loaded} loaded, ${failed} failed`,
  )
  return { loaded, failed }
}

export function createWorkersRouter(backend: BackendManager) {
  const runtime = new WorkerRuntime(backend)
  const registry = getWorkerRegistry()

  sharedRuntime = runtime // Store reference for shared access
  sharedRegistry = registry // Store registry reference
  sharedBackend = backend // Store backend reference for getOrLoadWorkerPublic

  // Set up registry callback for deploying workers loaded from cache/SQLit
  registry.setWorkerLoadedCallback(async (worker: WorkerFunction) => {
    const existingFn = runtime.getFunction(worker.id)
    if (!existingFn) {
      await runtime.deployFunction(worker)
      console.log(
        `[Workers] Registry callback: deployed ${worker.name} (${worker.id})`,
      )
    }
  })

  // Load persisted workers from SQLit on startup
  loadPersistedWorkers(runtime, registry)
    .then(({ loaded, failed }) => {
      console.log(
        `[Workers] Initial load complete: ${loaded} workers loaded, ${failed} failed`,
      )
      // Start background sync after initial load
      registry.startBackgroundSync()
    })
    .catch((err) => {
      console.error(
        `[Workers] Failed to load persisted workers: ${err instanceof Error ? err.message : String(err)}`,
      )
      // Start background sync even if initial load fails - it will retry
      registry.startBackgroundSync()
    })

  return (
    new Elysia({ name: 'workers', prefix: '/workers' })
      // Health check with registry stats
      .get('/health', () => {
        const runtimeStats = runtime.getStats()
        const registryStats = registry.getStats()
        return {
          status: 'healthy',
          service: 'dws-workers',
          ...runtimeStats,
          registry: registryStats,
        }
      })

      // Sync endpoint - forces reload from persistence
      // Use this after deployments to ensure all pods have the worker
      .post('/sync', async () => {
        const result = await registry.syncFromPersistence()
        return {
          success: true,
          podId: registry.getPodId(),
          region: registry.getPodRegion(),
          ...result,
          stats: registry.getStats(),
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

            // Parse crons from FormData if present
            const cronsJson = getFormString(formData, 'crons')
            const crons = cronsJson
              ? expectJson(
                  cronsJson,
                  z.array(CronScheduleSchema),
                  'worker crons',
                )
              : undefined

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
              crons,
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

              // Register with registry for cross-pod discovery
              registry.registerLocalWorker(fn)

              // Persist to SQLit for recovery across pod restarts
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

              // Update worker location in shared cache
              registry.updateWorkerLocation(fn.id)

              // Register cron schedules if provided
              let cronsRegistered = 0
              if (jsonBody.crons && jsonBody.crons.length > 0) {
                for (const cron of jsonBody.crons) {
                  await dwsWorkerCronState.register({
                    workerId: fn.id,
                    name: cron.name,
                    schedule: cron.schedule,
                    endpoint: cron.endpoint,
                    timezone: cron.timezone,
                    timeoutMs: cron.timeoutMs,
                    retries: cron.retries,
                  })
                  cronsRegistered++
                }
                console.log(
                  `[Workers] Registered ${cronsRegistered} cron schedule(s) for worker ${fn.name} (${fn.id})`,
                )
              }

              set.status = 201
              return {
                functionId: fn.id,
                name: fn.name,
                codeCid: fn.codeCid,
                status: fn.status,
                cronsRegistered,
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
              crons: jsonBody.crons,
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

          // Register with registry for cross-pod discovery
          registry.registerLocalWorker(fn)

          // Persist to SQLit for recovery across pod restarts
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

          // Update worker location in shared cache
          registry.updateWorkerLocation(fn.id)

          // Register cron schedules if provided
          let cronsRegistered = 0
          if (params.crons && params.crons.length > 0) {
            for (const cron of params.crons) {
              await dwsWorkerCronState.register({
                workerId: fn.id,
                name: cron.name,
                schedule: cron.schedule,
                endpoint: cron.endpoint,
                timezone: cron.timezone,
                timeoutMs: cron.timeoutMs,
                retries: cron.retries,
              })
              cronsRegistered++
            }
            console.log(
              `[Workers] Registered ${cronsRegistered} cron schedule(s) for worker ${fn.name} (${fn.id})`,
            )
          }

          set.status = 201
          return {
            functionId: fn.id,
            name: fn.name,
            codeCid: fn.codeCid,
            status: fn.status,
            cronsRegistered,
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

      // Get function (with multi-tier lookup)
      .get(
        '/:functionId',
        async ({ params, set }) => {
          const fn = await getOrLoadWorker(params.functionId, backend)
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

          const fn = await getOrLoadWorker(params.functionId, backend)

          if (!fn) {
            set.status = 404
            return { error: 'Function not found' }
          }

          if (fn.owner.toLowerCase() !== owner.toLowerCase()) {
            set.status = 403
            return { error: 'Not authorized' }
          }

          // Undeploy from runtime
          await runtime.undeployFunction(fn.id)

          // Unregister from registry
          registry.unregisterLocalWorker(fn.id)

          // Delete associated cron schedules
          const deletedCrons = await dwsWorkerCronState.deleteByWorker(fn.id)
          if (deletedCrons > 0) {
            console.log(
              `[Workers] Deleted ${deletedCrons} cron schedule(s) for worker ${fn.name} (${fn.id})`,
            )
          }

          // Mark as inactive in persistence
          await dwsWorkerState.updateStatus(fn.id, 'inactive')

          return { success: true, cronsDeleted: deletedCrons }
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
      // Uses getOrLoadWorker for multi-tier lookup with retry
      .route(
        'GET',
        '/:functionId/http/*',
        async ({ params, request, set }) => {
          const fn = await getOrLoadWorker(params.functionId, backend)

          if (!fn) {
            set.status = 404
            return { error: 'Function not found' }
          }

          const url = new URL(request.url)
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
          const fn = await getOrLoadWorker(params.functionId, backend)

          if (!fn) {
            set.status = 404
            return { error: 'Function not found' }
          }

          const url = new URL(request.url)
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
          const fn = await getOrLoadWorker(params.functionId, backend)

          if (!fn) {
            set.status = 404
            return { error: 'Function not found' }
          }

          const url = new URL(request.url)
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
          const fn = await getOrLoadWorker(params.functionId, backend)

          if (!fn) {
            set.status = 404
            return { error: 'Function not found' }
          }

          const url = new URL(request.url)
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
          const fn = await getOrLoadWorker(params.functionId, backend)

          if (!fn) {
            set.status = 404
            return { error: 'Function not found' }
          }

          const url = new URL(request.url)
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
