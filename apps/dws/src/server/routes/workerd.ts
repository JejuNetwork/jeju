/**
 * Workerd API Routes
 * V8 isolate-based serverless worker deployment and invocation
 */

import { Hono } from 'hono'
import type { Address } from 'viem'
import { base, baseSepolia, localhost } from 'viem/chains'
import { z } from 'zod'
import type { BackendManager } from '../../storage/backends'
import {
  DEFAULT_ROUTER_CONFIG,
  DecentralizedWorkerRegistry,
  DecentralizedWorkerRouter,
  type RegistryConfig,
  type RouterConfig,
  type WorkerdConfig,
  WorkerdExecutor,
  type WorkerdWorkerDefinition,
} from '../../workers/workerd'

// ============================================================================
// Schemas
// ============================================================================

const deployRequestSchema = z.object({
  name: z.string().min(1).max(64),
  code: z.string().or(z.instanceof(ArrayBuffer)).optional(),
  codeCid: z.string().optional(),
  handler: z.string().default('index.handler'),
  memoryMb: z.number().int().min(64).max(2048).default(128),
  timeoutMs: z.number().int().min(1000).max(900000).default(30000),
  cpuTimeMs: z.number().int().min(10).max(30000).default(50),
  compatibilityDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .default('2024-01-01'),
  compatibilityFlags: z.array(z.string()).optional(),
  bindings: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['text', 'json', 'data', 'service']),
        value: z.string().or(z.record(z.string(), z.string())).optional(),
        service: z.string().optional(),
      }),
    )
    .optional(),
})

const invokeRequestSchema = z.object({
  method: z.string().default('POST'),
  path: z.string().default('/'),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
})

const workerIdParamsSchema = z.object({
  workerId: z.string().uuid(),
})

// ============================================================================
// Router Factory
// ============================================================================

export interface WorkerdRouterOptions {
  backend: BackendManager
  workerdConfig?: Partial<WorkerdConfig>
  routerConfig?: Partial<RouterConfig>
  registryConfig?: RegistryConfig
  enableDecentralized?: boolean
}

export function createWorkerdRouter(options: WorkerdRouterOptions): Hono {
  const {
    backend,
    workerdConfig = {},
    routerConfig = {},
    registryConfig,
    enableDecentralized = false,
  } = options

  const router = new Hono()

  // Error handler for proper status codes
  router.onError((error, c) => {
    const message = error.message
    const lowerMessage = message.toLowerCase()

    // Check for auth-related errors (401)
    const isAuthError =
      lowerMessage.includes('x-jeju-address') ||
      lowerMessage.includes('authentication')

    // Check for not found errors (404)
    const isNotFound = lowerMessage.includes('not found')

    // Check for permission errors (403)
    const isForbidden =
      lowerMessage.includes('not authorized') ||
      lowerMessage.includes('access denied')

    // Check for validation errors (400)
    const isBadRequest =
      lowerMessage.includes('invalid') ||
      lowerMessage.includes('required') ||
      error.name === 'ZodError'

    const statusCode = isAuthError
      ? 401
      : isNotFound
        ? 404
        : isForbidden
          ? 403
          : isBadRequest
            ? 400
            : 500

    return c.json({ error: message }, statusCode)
  })

  // Initialize executor
  const executor = new WorkerdExecutor(backend, workerdConfig)

  // Initialize decentralized components if configured
  let registry: DecentralizedWorkerRegistry | null = null
  let workerRouter: DecentralizedWorkerRouter | null = null

  if (enableDecentralized && registryConfig) {
    registry = new DecentralizedWorkerRegistry(registryConfig)
    workerRouter = new DecentralizedWorkerRouter(registry, routerConfig)
    workerRouter.start()
  }

  // ============================================================================
  // Health & Stats
  // ============================================================================

  router.get('/health', (c) => {
    const stats = executor.getStats()
    const routerStats = workerRouter?.getStats()

    return c.json({
      status: 'healthy',
      service: 'dws-workerd',
      runtime: 'workerd',
      ...stats,
      decentralized: enableDecentralized,
      router: routerStats,
    })
  })

  router.get('/stats', (c) => {
    const poolMetrics = executor.getPoolMetrics()
    const routerStats = workerRouter?.getStats()

    return c.json({
      pool: poolMetrics,
      router: routerStats,
    })
  })

  // ============================================================================
  // Worker Deployment
  // ============================================================================

  router.post('/', async (c) => {
    // Validate auth first
    const ownerHeader = c.req.header('x-jeju-address')
    if (!ownerHeader) {
      return c.json({ error: 'x-jeju-address header required' }, 401)
    }
    const owner = ownerHeader as Address

    const contentType = c.req.header('content-type') || ''

    let params: z.infer<typeof deployRequestSchema>
    let codeBuffer: Buffer | null = null

    try {
      if (contentType.includes('multipart/form-data')) {
        const formData = await c.req.formData()
        const codeFile = formData.get('code')

        params = deployRequestSchema.parse({
          name: formData.get('name'),
          handler: formData.get('handler') || 'index.handler',
          memoryMb: parseInt(formData.get('memoryMb') as string, 10) || 128,
          timeoutMs: parseInt(formData.get('timeoutMs') as string, 10) || 30000,
          cpuTimeMs: parseInt(formData.get('cpuTimeMs') as string, 10) || 50,
          compatibilityDate: formData.get('compatibilityDate') || '2024-01-01',
          bindings: JSON.parse((formData.get('bindings') as string) || '[]'),
        })

        if (codeFile instanceof File) {
          codeBuffer = Buffer.from(await codeFile.arrayBuffer())
        }
      } else {
        const body = await c.req.json()
        params = deployRequestSchema.parse(body)

        if (typeof params.code === 'string') {
          codeBuffer = Buffer.from(params.code, 'base64')
        }
      }
    } catch (error) {
      // Handle Zod validation errors
      if (error instanceof z.ZodError) {
        const issues = error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join(', ')
        return c.json({ error: `Validation failed: ${issues}` }, 400)
      }
      throw error
    }

    // Upload code to storage if provided
    let codeCid = params.codeCid
    if (codeBuffer && !codeCid) {
      const uploadResult = await backend.upload(codeBuffer, {
        filename: `${params.name}.js`,
      })
      codeCid = uploadResult.cid
    }

    if (!codeCid) {
      return c.json({ error: 'Code or codeCid required' }, 400)
    }

    // Create worker definition
    const workerId = crypto.randomUUID()
    const worker: WorkerdWorkerDefinition = {
      id: workerId,
      name: params.name,
      owner,
      modules: [], // Will be populated during deployment
      bindings: (params.bindings || []).map((b) => ({
        name: b.name,
        type: b.type as 'text' | 'json' | 'data' | 'service',
        value: b.value,
        service: b.service,
      })),
      compatibilityDate: params.compatibilityDate,
      compatibilityFlags: params.compatibilityFlags,
      mainModule: 'worker.js',
      memoryMb: params.memoryMb,
      cpuTimeMs: params.cpuTimeMs,
      timeoutMs: params.timeoutMs,
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
        routerConfig?.localEndpoint || DEFAULT_ROUTER_CONFIG.localEndpoint
      await registry.registerWorker(worker, endpoint).catch((err: Error) => {
        console.warn(`[Workerd] Failed to register on-chain: ${err.message}`)
      })
    }

    return c.json(
      {
        workerId: worker.id,
        name: worker.name,
        codeCid: worker.codeCid,
        status: worker.status,
        runtime: 'workerd',
      },
      201,
    )
  })

  // List workers
  router.get('/', (c) => {
    const owner = c.req.header('x-jeju-address')
    let workers = executor.listWorkers()

    if (owner) {
      workers = workers.filter(
        (w) => w.owner.toLowerCase() === owner.toLowerCase(),
      )
    }

    return c.json({
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
    })
  })

  // Get worker
  router.get('/:workerId', (c) => {
    const { workerId } = workerIdParamsSchema.parse({
      workerId: c.req.param('workerId'),
    })
    const worker = executor.getWorker(workerId)

    if (!worker) {
      return c.json({ error: 'Worker not found' }, 404)
    }

    const instance = executor.getInstance(workerId)
    const metrics = executor.getMetrics(workerId)

    return c.json({
      ...worker,
      instance: instance
        ? {
            port: instance.port,
            status: instance.status,
            activeRequests: instance.activeRequests,
            totalRequests: instance.totalRequests,
            memoryUsedMb: instance.memoryUsedMb,
          }
        : null,
      metrics,
    })
  })

  // Update worker
  router.put('/:workerId', async (c) => {
    // Validate auth first
    const ownerHeader = c.req.header('x-jeju-address')
    if (!ownerHeader) {
      return c.json({ error: 'x-jeju-address header required' }, 401)
    }
    const owner = ownerHeader as Address

    const { workerId } = workerIdParamsSchema.parse({
      workerId: c.req.param('workerId'),
    })

    const worker = executor.getWorker(workerId)
    if (!worker) {
      return c.json({ error: 'Worker not found' }, 404)
    }

    if (worker.owner.toLowerCase() !== owner.toLowerCase()) {
      return c.json({ error: 'Not authorized' }, 403)
    }

    const body = await c.req.json()
    const updates = deployRequestSchema.partial().parse(body)

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
        type: b.type as 'text' | 'json' | 'data' | 'service',
        value: b.value,
        service: b.service,
      }))
    }
    worker.updatedAt = Date.now()

    // Redeploy
    await executor.undeployWorker(workerId)
    await executor.deployWorker(worker)

    return c.json({ success: true, version: worker.version })
  })

  // Delete worker
  router.delete('/:workerId', async (c) => {
    // Validate auth first
    const ownerHeader = c.req.header('x-jeju-address')
    if (!ownerHeader) {
      return c.json({ error: 'x-jeju-address header required' }, 401)
    }
    const owner = ownerHeader as Address

    const { workerId } = workerIdParamsSchema.parse({
      workerId: c.req.param('workerId'),
    })

    const worker = executor.getWorker(workerId)
    if (!worker) {
      return c.json({ error: 'Worker not found' }, 404)
    }

    if (worker.owner.toLowerCase() !== owner.toLowerCase()) {
      return c.json({ error: 'Not authorized' }, 403)
    }

    await executor.undeployWorker(workerId)
    return c.json({ success: true })
  })

  // ============================================================================
  // Worker Invocation
  // ============================================================================

  // Synchronous invocation
  router.post('/:workerId/invoke', async (c) => {
    const { workerId } = workerIdParamsSchema.parse({
      workerId: c.req.param('workerId'),
    })
    const body = await c.req.json()
    const request = invokeRequestSchema.parse(body)

    // Use router for decentralized mode, otherwise invoke directly
    if (workerRouter && enableDecentralized) {
      const response = await workerRouter.route(workerId, {
        method: request.method,
        url: request.path,
        headers: request.headers || {},
        body: request.body,
      })

      return c.json({
        status: response.status,
        headers: response.headers,
        body:
          typeof response.body === 'string'
            ? response.body
            : response.body.toString(),
      })
    }

    const response = await executor.invoke(workerId, {
      method: request.method,
      url: request.path,
      headers: request.headers || {},
      body: request.body,
    })

    const bodyStr =
      typeof response.body === 'string'
        ? response.body
        : Buffer.isBuffer(response.body)
          ? response.body.toString('utf-8')
          : String(response.body)

    return c.json({
      status: response.status,
      headers: response.headers,
      body: bodyStr,
    })
  })

  // HTTP handler (Cloudflare Workers style)
  router.all('/:workerId/http/*', async (c) => {
    const workerId = c.req.param('workerId')
    const worker = executor.getWorker(workerId)

    if (!worker) {
      return c.json({ error: 'Worker not found' }, 404)
    }

    const url = new URL(c.req.url)
    const path = url.pathname.replace(`/workerd/${workerId}/http`, '') || '/'

    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((value, key) => {
      headers[key] = value
    })

    const body =
      c.req.method !== 'GET' && c.req.method !== 'HEAD'
        ? await c.req.text()
        : undefined

    const response = await executor.invoke(workerId, {
      method: c.req.method,
      url: `${path}${url.search}`,
      headers,
      body,
    })

    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    })
  })

  // ============================================================================
  // Metrics & Logs
  // ============================================================================

  router.get('/:workerId/metrics', (c) => {
    const { workerId } = workerIdParamsSchema.parse({
      workerId: c.req.param('workerId'),
    })
    const metrics = executor.getMetrics(workerId)

    return c.json(metrics)
  })

  router.get('/:workerId/invocations/:invocationId', (c) => {
    const invocationId = c.req.param('invocationId')
    const invocation = executor.getInvocation(invocationId)

    if (!invocation) {
      return c.json({ error: 'Invocation not found' }, 404)
    }

    return c.json(invocation)
  })

  // ============================================================================
  // Decentralized Operations
  // ============================================================================

  if (enableDecentralized && registry) {
    // Discover registered workers
    router.get('/registry/workers', async (c) => {
      const workers = await registry.getWorkers()
      return c.json({ workers })
    })

    // Discover worker nodes
    router.get('/registry/nodes', async (c) => {
      const nodes = await registry.getNodes()
      return c.json({ nodes })
    })

    // Replicate worker to other nodes
    router.post('/:workerId/replicate', async (c) => {
      const { workerId } = workerIdParamsSchema.parse({
        workerId: c.req.param('workerId'),
      })
      const body = (await c.req.json()) as { targetCount?: number }
      const targetCount = body.targetCount || 3

      const worker = await registry.getWorker(BigInt(workerId))
      if (!worker) {
        return c.json({ error: 'Worker not registered' }, 404)
      }

      const replicatedTo = await workerRouter?.replicateWorker(
        worker,
        targetCount,
      )

      return c.json({
        success: true,
        replicatedTo,
      })
    })

    // Deploy from registry (pull worker code from another node)
    router.post('/deploy-from-registry', async (c) => {
      const body = (await c.req.json()) as { agentId: string }
      const agentId = BigInt(body.agentId)

      const worker = await registry.getWorker(agentId)
      if (!worker) {
        return c.json({ error: 'Worker not found in registry' }, 404)
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

      return c.json({
        success: true,
        workerId,
        fromAgentId: agentId.toString(),
      })
    })
  }

  return router
}

// ============================================================================
// Network Configuration
// ============================================================================

type NetworkType = 'localnet' | 'testnet' | 'mainnet'

function getNetworkType(): NetworkType {
  const network = process.env.NETWORK?.toLowerCase()
  if (network === 'mainnet' || network === 'production') return 'mainnet'
  if (network === 'testnet' || network === 'staging') return 'testnet'
  return 'localnet'
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
const NETWORK_DEFAULTS: Record<
  NetworkType,
  {
    rpcUrl: string
    identityRegistry: Address
  }
> = {
  localnet: {
    rpcUrl: 'http://localhost:9545',
    identityRegistry: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
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

// ============================================================================
// Default Export for Standalone Use
// ============================================================================

export function createDefaultWorkerdRouter(backend: BackendManager): Hono {
  const network = getNetworkType()
  const defaults = NETWORK_DEFAULTS[network]
  const chain = getChainForNetwork(network)

  const rpcUrl = process.env.RPC_URL || defaults.rpcUrl
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
