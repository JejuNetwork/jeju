/**
 * Workerd API Routes
 * V8 isolate-based serverless worker deployment and invocation
 */

import { getCurrentNetwork, getRpcUrl } from '@jejunetwork/config'
import {
  expectJson,
  expectValid,
  getFormInt,
  getFormString,
} from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { base, baseSepolia, localhost } from 'viem/chains'
import { z } from 'zod'
import type { BackendManager } from '../../storage/backends'
import {
  DEFAULT_ROUTER_CONFIG,
  type RegistryConfig,
  type RouterConfig,
  type WorkerdConfig,
  WorkerdExecutor,
  type WorkerdWorkerDefinition,
  WorkerRegistry,
  WorkerRouter,
} from '../../workers/workerd'

// Schemas & Validation

const WorkerdBindingsSchema = z.array(
  z.object({
    name: z.string(),
    type: z.enum(['text', 'json', 'data', 'service']),
    value: z.string().or(z.record(z.string(), z.string())).optional(),
    service: z.string().optional(),
  }),
)

/** Zod schema for worker deployment */
const DeployWorkerJsonBodySchema = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  codeCid: z.string().optional(),
  handler: z.string().optional(),
  memoryMb: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  cpuTimeMs: z.number().int().positive().optional(),
  compatibilityDate: z.string().optional(),
  compatibilityFlags: z.array(z.string()).optional(),
  bindings: WorkerdBindingsSchema.optional(),
})

/** Zod schema for worker updates */
const UpdateWorkerBodySchema = z.object({
  code: z.string().optional(),
  memoryMb: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  cpuTimeMs: z.number().int().positive().optional(),
  bindings: WorkerdBindingsSchema.optional(),
})

/** Zod schema for worker invocation */
const InvokeWorkerBodySchema = z.object({
  method: z.string().optional(),
  path: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
})

/** Zod schema for replication */
const ReplicateWorkerBodySchema = z.object({
  targetCount: z.number().int().positive().optional(),
})

/** Zod schema for registry deployment */
const DeployFromRegistryBodySchema = z.object({
  agentId: z.string().min(1),
})

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isValidUUID(str: string): boolean {
  return UUID_REGEX.test(str)
}

// Router Factory

export interface WorkerdRouterOptions {
  backend: BackendManager
  workerdConfig?: Partial<WorkerdConfig>
  routerConfig?: Partial<RouterConfig>
  registryConfig?: RegistryConfig
  enableDecentralized?: boolean
}

export function createWorkerdRouter(options: WorkerdRouterOptions) {
  const {
    backend,
    workerdConfig = {},
    routerConfig = {},
    registryConfig,
    enableDecentralized = false,
  } = options

  // Initialize executor
  const executor = new WorkerdExecutor(backend, workerdConfig)

  // Initialize decentralized components if configured
  let registry: WorkerRegistry | null = null
  let workerRouter: WorkerRouter | null = null

  if (enableDecentralized && registryConfig) {
    registry = new WorkerRegistry(registryConfig)
    workerRouter = new WorkerRouter(registry, routerConfig)

    // Connect router to local executor for direct invocation
    workerRouter.setLocalExecutor(executor)

    workerRouter.start()
  }

  const router = new Elysia({ name: 'workerd', prefix: '/workerd' })

    // Health & Stats

    .get('/health', () => {
      const stats = executor.getStats()
      const routerStats = workerRouter?.getStats()

      return {
        status: 'healthy',
        service: 'dws-workerd',
        runtime: 'workerd',
        ...stats,
        decentralized: enableDecentralized,
        router: routerStats,
      }
    })

    .get('/stats', () => {
      const poolMetrics = executor.getPoolMetrics()
      const routerStats = workerRouter?.getStats()

      return {
        pool: poolMetrics,
        router: routerStats,
      }
    })

    // Worker Deployment

    .post(
      '/',
      async ({ headers, body, set }) => {
        // Validate auth first
        const ownerHeader = headers['x-jeju-address']
        if (!ownerHeader) {
          set.status = 401
          return { error: 'x-jeju-address header required' }
        }
        const owner = ownerHeader as Address

        const contentType = headers['content-type'] ?? ''

        let name: string
        let memoryMb = 128
        let timeoutMs = 30000
        let cpuTimeMs = 50
        let compatibilityDate = '2024-01-01'
        let compatibilityFlags: string[] | undefined
        let bindings: Array<{
          name: string
          type: 'text' | 'json' | 'data' | 'service'
          value?: string | Record<string, string>
          service?: string
        }> = []
        let codeBuffer: Buffer | null = null
        let codeCid: string | undefined

        if (contentType.includes('multipart/form-data')) {
          const formData = body as FormData
          const codeFile = formData.get('code')

          const formName = getFormString(formData, 'name')
          if (!formName) {
            return { success: false, error: 'name is required' }
          }
          name = formName
          memoryMb = getFormInt(formData, 'memoryMb', 128)
          timeoutMs = getFormInt(formData, 'timeoutMs', 30000)
          cpuTimeMs = getFormInt(formData, 'cpuTimeMs', 50)
          compatibilityDate =
            getFormString(formData, 'compatibilityDate') ?? '2024-01-01'
          bindings = expectJson(
            getFormString(formData, 'bindings') ?? '[]',
            WorkerdBindingsSchema,
            'form data bindings',
          )

          if (codeFile instanceof File) {
            codeBuffer = Buffer.from(await codeFile.arrayBuffer())
          }
        } else {
          const parseResult = DeployWorkerJsonBodySchema.safeParse(body)
          if (!parseResult.success) {
            set.status = 400
            return {
              error: 'Validation failed',
              details: parseResult.error.issues.map((e) => ({
                path: e.path.join('.'),
                message: e.message,
              })),
            }
          }
          const jsonBody = parseResult.data
          name = jsonBody.name
          memoryMb = jsonBody.memoryMb ?? 128
          timeoutMs = jsonBody.timeoutMs ?? 30000
          cpuTimeMs = jsonBody.cpuTimeMs ?? 50
          compatibilityDate = jsonBody.compatibilityDate ?? '2024-01-01'
          compatibilityFlags = jsonBody.compatibilityFlags
          bindings = jsonBody.bindings ?? []
          codeCid = jsonBody.codeCid

          if (typeof jsonBody.code === 'string') {
            codeBuffer = Buffer.from(jsonBody.code, 'base64')
          }
        }

        if (!name) {
          set.status = 400
          return { error: 'Worker name required' }
        }

        // Validate limits
        if (memoryMb < 64 || memoryMb > 2048) {
          set.status = 400
          return { error: 'memoryMb must be between 64 and 2048' }
        }

        if (timeoutMs < 1000 || timeoutMs > 900000) {
          set.status = 400
          return { error: 'timeoutMs must be between 1000 and 900000' }
        }

        if (cpuTimeMs < 10 || cpuTimeMs > 30000) {
          set.status = 400
          return { error: 'cpuTimeMs must be between 10 and 30000' }
        }

        // Upload code to storage if provided
        if (codeBuffer && !codeCid) {
          const uploadResult = await backend.upload(codeBuffer, {
            filename: `${name}.js`,
          })
          codeCid = uploadResult.cid
        }

        if (!codeCid) {
          set.status = 400
          return { error: 'Code or codeCid required' }
        }

        // Create worker definition
        const workerId = crypto.randomUUID()
        const worker: WorkerdWorkerDefinition = {
          id: workerId,
          name,
          owner,
          modules: [], // Will be populated during deployment
          bindings: bindings.map((b) => ({
            name: b.name,
            type: b.type,
            value: b.value,
            service: b.service,
          })),
          compatibilityDate,
          compatibilityFlags,
          mainModule: 'worker.js',
          memoryMb,
          cpuTimeMs,
          timeoutMs,
          codeCid,
          version: 1,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        // Deploy worker
        await executor.deployWorker(worker)

        // Register on-chain if decentralized
        if (registry && enableDecentralized) {
          const endpoint =
            routerConfig.localEndpoint ?? DEFAULT_ROUTER_CONFIG.localEndpoint
          await registry
            .registerWorker(worker, endpoint)
            .catch((err: Error) => {
              console.warn(
                `[Workerd] Failed to register on-chain: ${err.message}`,
              )
            })
        }

        set.status = 201
        return {
          workerId: worker.id,
          name: worker.name,
          codeCid: worker.codeCid,
          status: worker.status,
          runtime: 'workerd',
        }
      },
      {
        headers: t.Object({
          'x-jeju-address': t.Optional(t.String()),
          'content-type': t.Optional(t.String()),
        }),
      },
    )

    // List workers
    .get(
      '/',
      ({ headers }) => {
        const owner = headers['x-jeju-address']
        let workers = executor.listWorkers()

        if (owner) {
          workers = workers.filter(
            (w) => w.owner.toLowerCase() === owner.toLowerCase(),
          )
        }

        return {
          workers: workers.map((w) => ({
            id: w.id,
            name: w.name,
            memoryMb: w.memoryMb,
            timeoutMs: w.timeoutMs,
            status: w.status,
            version: w.version,
            codeCid: w.codeCid,
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
          })),
          runtime: 'workerd',
        }
      },
      {
        headers: t.Object({
          'x-jeju-address': t.Optional(t.String()),
        }),
      },
    )

    // Get worker
    .get(
      '/:workerId',
      ({ params, set }) => {
        if (!isValidUUID(params.workerId)) {
          set.status = 400
          return { error: 'Invalid worker ID format' }
        }

        const worker = executor.getWorker(params.workerId)

        if (!worker) {
          set.status = 404
          return { error: 'Worker not found' }
        }

        const instance = executor.getInstance(params.workerId)
        const metrics = executor.getMetrics(params.workerId)

        return {
          ...worker,
          instance: instance
            ? {
                port: instance.port,
                status: instance.status,
                endpoint: instance.endpoint,
                totalRequests: metrics.invocations,
                memoryUsedMb: metrics.memoryUsedMb,
              }
            : null,
          metrics,
        }
      },
      {
        params: t.Object({
          workerId: t.String(),
        }),
      },
    )

    // Update worker
    .put(
      '/:workerId',
      async ({ params, headers, body, set }) => {
        // Validate auth first
        const ownerHeader = headers['x-jeju-address']
        if (!ownerHeader) {
          set.status = 401
          return { error: 'x-jeju-address header required' }
        }
        const owner = ownerHeader as Address

        const worker = executor.getWorker(params.workerId)
        if (!worker) {
          set.status = 404
          return { error: 'Worker not found' }
        }

        if (worker.owner.toLowerCase() !== owner.toLowerCase()) {
          set.status = 403
          return { error: 'Not authorized' }
        }

        const updates = expectValid(
          UpdateWorkerBodySchema,
          body,
          'Update worker body',
        )

        // Update code if provided
        if (updates.code) {
          const codeBuffer =
            typeof updates.code === 'string'
              ? Buffer.from(updates.code, 'base64')
              : Buffer.from(updates.code)

          const uploadResult = await backend.upload(codeBuffer, {
            filename: `${worker.name}.js`,
          })

          worker.codeCid = uploadResult.cid
          worker.version++
        }

        if (updates.memoryMb) worker.memoryMb = updates.memoryMb
        if (updates.timeoutMs) worker.timeoutMs = updates.timeoutMs
        if (updates.cpuTimeMs) worker.cpuTimeMs = updates.cpuTimeMs
        if (updates.bindings) {
          worker.bindings = updates.bindings.map((b) => ({
            name: b.name,
            type: b.type,
            value: b.value,
            service: b.service,
          }))
        }
        worker.updatedAt = Date.now()

        // Redeploy
        await executor.undeployWorker(params.workerId)
        await executor.deployWorker(worker)

        return { success: true, version: worker.version }
      },
      {
        params: t.Object({
          workerId: t.String(),
        }),
        headers: t.Object({
          'x-jeju-address': t.Optional(t.String()),
        }),
        body: t.Object({
          code: t.Optional(t.String()),
          memoryMb: t.Optional(t.Number()),
          timeoutMs: t.Optional(t.Number()),
          cpuTimeMs: t.Optional(t.Number()),
          bindings: t.Optional(
            t.Array(
              t.Object({
                name: t.String(),
                type: t.Union([
                  t.Literal('text'),
                  t.Literal('json'),
                  t.Literal('data'),
                  t.Literal('service'),
                ]),
                value: t.Optional(
                  t.Union([t.String(), t.Record(t.String(), t.String())]),
                ),
                service: t.Optional(t.String()),
              }),
            ),
          ),
        }),
      },
    )

    // Delete worker
    .delete(
      '/:workerId',
      async ({ params, headers, set }) => {
        // Validate auth first
        const ownerHeader = headers['x-jeju-address']
        if (!ownerHeader) {
          set.status = 401
          return { error: 'x-jeju-address header required' }
        }
        const owner = ownerHeader as Address

        const worker = executor.getWorker(params.workerId)
        if (!worker) {
          set.status = 404
          return { error: 'Worker not found' }
        }

        if (worker.owner.toLowerCase() !== owner.toLowerCase()) {
          set.status = 403
          return { error: 'Not authorized' }
        }

        await executor.undeployWorker(params.workerId)
        return { success: true }
      },
      {
        params: t.Object({
          workerId: t.String(),
        }),
        headers: t.Object({
          'x-jeju-address': t.Optional(t.String()),
        }),
      },
    )

    // Worker Invocation

    // Synchronous invocation
    .post(
      '/:workerId/invoke',
      async ({ params, body }) => {
        const request = expectValid(
          InvokeWorkerBodySchema,
          body,
          'Invoke worker body',
        )

        // Use decentralized router if enabled (it checks local executor first)
        if (workerRouter && enableDecentralized) {
          const response = await workerRouter.route(params.workerId, {
            method: request.method ?? 'POST',
            url: request.path ?? '/',
            headers: request.headers ?? {},
            body: request.body,
          })

          return {
            status: response.status,
            headers: response.headers,
            body:
              typeof response.body === 'string'
                ? response.body
                : response.body.toString(),
          }
        }

        // Direct invocation when decentralized mode is disabled
        const response = await executor.invoke(params.workerId, {
          method: request.method ?? 'POST',
          url: request.path ?? '/',
          headers: request.headers ?? {},
          body: request.body,
        })

        const bodyStr =
          typeof response.body === 'string'
            ? response.body
            : Buffer.isBuffer(response.body)
              ? response.body.toString('utf-8')
              : String(response.body)

        return {
          status: response.status,
          headers: response.headers,
          body: bodyStr,
        }
      },
      {
        params: t.Object({
          workerId: t.String(),
        }),
        body: t.Object({
          method: t.Optional(t.String()),
          path: t.Optional(t.String()),
          headers: t.Optional(t.Record(t.String(), t.String())),
          body: t.Optional(t.String()),
        }),
      },
    )

    // HTTP handler (Cloudflare Workers style)
    .all(
      '/:workerId/http/*',
      async ({ params, request, set }) => {
        const worker = executor.getWorker(params.workerId)

        if (!worker) {
          set.status = 404
          return { error: 'Worker not found' }
        }

        const url = new URL(request.url)
        const path =
          url.pathname.replace(`/workerd/${params.workerId}/http`, '') ?? '/'

        const requestHeaders: Record<string, string> = {}
        request.headers.forEach((value, key) => {
          requestHeaders[key] = value
        })

        const body =
          request.method !== 'GET' && request.method !== 'HEAD'
            ? await request.text()
            : undefined

        const response = await executor.invoke(params.workerId, {
          method: request.method,
          url: `${path}${url.search}`,
          headers: requestHeaders,
          body,
        })

        // Convert body to string for Response constructor
        const responseBody: string =
          typeof response.body === 'string'
            ? response.body
            : new TextDecoder().decode(response.body)

        return new Response(responseBody, {
          status: response.status,
          headers: response.headers,
        })
      },
      {
        params: t.Object({
          workerId: t.String(),
          '*': t.String(),
        }),
      },
    )

    // Metrics & Logs

    .get(
      '/:workerId/metrics',
      ({ params }) => {
        const metrics = executor.getMetrics(params.workerId)
        return metrics
      },
      {
        params: t.Object({
          workerId: t.String(),
        }),
      },
    )

    .get(
      '/:workerId/invocations/:invocationId',
      ({ params, set }) => {
        const invocation = executor.getInvocation(params.invocationId)

        if (!invocation) {
          set.status = 404
          return { error: 'Invocation not found' }
        }

        return invocation
      },
      {
        params: t.Object({
          workerId: t.String(),
          invocationId: t.String(),
        }),
      },
    )

  // Decentralized Operations

  if (enableDecentralized && registry) {
    router
      // Discover registered workers
      .get('/registry/workers', async () => {
        const workers = await registry.getWorkers()
        return { workers }
      })

      // Discover worker nodes
      .get('/registry/nodes', async () => {
        const nodes = await registry.getNodes()
        return { nodes }
      })

      // Replicate worker to other nodes
      .post(
        '/:workerId/replicate',
        async ({ params, body, set }) => {
          const validatedBody = expectValid(
            ReplicateWorkerBodySchema,
            body,
            'Replicate worker body',
          )
          const targetCount = validatedBody.targetCount ?? 3

          const worker = await registry.getWorker(BigInt(params.workerId))
          if (!worker) {
            set.status = 404
            return { error: 'Worker not registered' }
          }

          const replicatedTo = await workerRouter?.replicateWorker(
            worker,
            targetCount,
          )

          return {
            success: true,
            replicatedTo,
          }
        },
        {
          params: t.Object({
            workerId: t.String(),
          }),
          body: t.Object({
            targetCount: t.Optional(t.Number()),
          }),
        },
      )

      // Deploy from registry (pull worker code from another node)
      .post(
        '/deploy-from-registry',
        async ({ body, set }) => {
          const validatedBody = expectValid(
            DeployFromRegistryBodySchema,
            body,
            'Deploy from registry body',
          )
          const agentId = BigInt(validatedBody.agentId)

          const worker = await registry.getWorker(agentId)
          if (!worker) {
            set.status = 404
            return { error: 'Worker not found in registry' }
          }

          // Create worker definition from registration
          const workerId = crypto.randomUUID()
          const workerDef: WorkerdWorkerDefinition = {
            id: workerId,
            name: `worker-${agentId}`,
            owner: worker.owner,
            modules: [],
            bindings: [],
            compatibilityDate: '2024-01-01',
            mainModule: 'worker.js',
            memoryMb: worker.memoryMb,
            cpuTimeMs: 50,
            timeoutMs: worker.timeoutMs,
            codeCid: worker.codeCid,
            version: worker.version,
            status: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }

          await executor.deployWorker(workerDef)

          return {
            success: true,
            workerId,
            fromAgentId: agentId.toString(),
          }
        },
        {
          body: t.Object({
            agentId: t.String(),
          }),
        },
      )
  }

  return router
}

export type WorkerdRoutes = ReturnType<typeof createWorkerdRouter>

// Network Configuration

type NetworkType = 'localnet' | 'testnet' | 'mainnet'

function getNetworkType(): NetworkType {
  return getCurrentNetwork()
}

function getChainForNetwork(network: NetworkType) {
  switch (network) {
    case 'mainnet':
      return base
    case 'testnet':
      return baseSepolia
    default:
      return localhost
  }
}

// Default contract addresses per network
// Note: For localnet, contracts are deployed fresh on each chain restart
// The identityRegistry address should come from config or env vars
const NETWORK_DEFAULTS: Record<
  NetworkType,
  {
    rpcUrl: string
    identityRegistry: Address
  }
> = {
  localnet: {
    rpcUrl: getRpcUrl('localnet'),
    // Default to zero address - decentralized mode disabled unless contract is deployed
    identityRegistry: (process.env.IDENTITY_REGISTRY_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
  },
  testnet: {
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    identityRegistry: (process.env.TESTNET_IDENTITY_REGISTRY_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
  },
  mainnet: {
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    identityRegistry: (process.env.MAINNET_IDENTITY_REGISTRY_ADDRESS ||
      '0x0000000000000000000000000000000000000000') as Address,
  },
}

// Default Export for Standalone Use

export function createDefaultWorkerdRouter(backend: BackendManager) {
  const network = getNetworkType()
  const defaults = NETWORK_DEFAULTS[network]
  const chain = getChainForNetwork(network)

  const rpcUrl = getRpcUrl() || defaults.rpcUrl
  const registryAddress = (process.env.IDENTITY_REGISTRY_ADDRESS ||
    defaults.identityRegistry) as Address
  const privateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined

  // Enable decentralized mode if we have a valid registry address
  const enableDecentralized =
    registryAddress !== '0x0000000000000000000000000000000000000000'

  const dwsEndpoint =
    process.env.DWS_ENDPOINT ||
    process.env.DWS_BASE_URL ||
    `http://localhost:${process.env.DWS_PORT || process.env.PORT || '4030'}`

  console.log(`[Workerd] Network: ${network}`)
  console.log(`[Workerd] RPC URL: ${rpcUrl}`)
  console.log(`[Workerd] Identity Registry: ${registryAddress}`)
  console.log(`[Workerd] Decentralized: ${enableDecentralized}`)

  return createWorkerdRouter({
    backend,
    workerdConfig: {
      binaryPath: process.env.WORKERD_PATH || '/usr/local/bin/workerd',
      workDir: process.env.WORKERD_WORK_DIR || '/tmp/dws-workerd',
      portRange: {
        min: parseInt(process.env.WORKERD_PORT_MIN || '30000', 10),
        max: parseInt(process.env.WORKERD_PORT_MAX || '35000', 10),
      },
    },
    routerConfig: {
      localEndpoint: dwsEndpoint,
      region: process.env.DWS_REGION || 'global',
      geoRouting: process.env.WORKERD_GEO_ROUTING !== 'false',
    },
    registryConfig: enableDecentralized
      ? {
          rpcUrl,
          chain,
          identityRegistryAddress: registryAddress,
          privateKey,
        }
      : undefined,
    enableDecentralized,
  })
}
