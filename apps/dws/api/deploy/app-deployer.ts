/**
 * DWS App Deployer
 *
 * Heroku/EKS-like deployment experience for Jeju apps.
 * Reads jeju-manifest.json and provisions all required infrastructure through DWS.
 *
 * Features:
 * - Reads app manifest and provisions databases, caches, queues
 * - Integrates with dstack for TEE (simulator or real hardware)
 * - Manages container lifecycle (Docker locally, k8s in production)
 * - Provides unified deployment API
 */

import { getLocalhostHost, isProductionEnv } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'
import {
  createDatabase,
  getServiceByName,
  listServicesAsync,
  provisionService,
  type ServiceConfig,
  type ServiceInstance,
  type ServiceType,
} from '../services'

// ============================================================================
// Types
// ============================================================================

export interface AppManifest {
  name: string
  displayName?: string
  version: string
  type?: 'core' | 'service' | 'utility' | 'vendor'
  description?: string
  commands?: {
    dev?: string
    build?: string
    start?: string
    test?: string
  }
  ports?: Record<string, number>
  dependencies?: string[]
  dws?: DWSConfig
  decentralization?: DecentralizationConfig
}

export interface DWSConfig {
  backend?: {
    enabled?: boolean
    runtime?: 'bun' | 'node' | 'docker' | 'workerd'
    entrypoint?: string
    memory?: number
    timeout?: number
    minInstances?: number
    maxInstances?: number
    teeRequired?: boolean
    regions?: string[]
  }
  database?: {
    type: 'postgres' | 'sqlit' | 'd1' | 'none'
    name: string
    version?: string
    resources?: ResourceConfig
  }
  services?: ServiceDefinition[]
  tee?: {
    enabled?: boolean
    required?: boolean
    platforms?: ('dstack' | 'intel_tdx' | 'amd_sev' | 'simulator')[]
    attestation?: boolean
  }
  scaling?: {
    minInstances?: number
    maxInstances?: number
    scaleToZero?: boolean
  }
}

export interface DecentralizationConfig {
  database?: {
    type: 'sqlit' | 'sqlit-sync' | 'none'
    databaseId?: string
  }
  cdn?: {
    enabled?: boolean
    regions?: string[]
  }
}

export interface ServiceDefinition {
  type: ServiceType
  name: string
  version?: string
  port?: number
  env?: Record<string, string>
  resources?: ResourceConfig
}

export interface ResourceConfig {
  cpuCores?: number
  memoryMb?: number
  storageMb?: number
}

export interface DeploymentResult {
  appName: string
  status: 'success' | 'partial' | 'failed'
  services: ProvisionedService[]
  database?: {
    type: string
    name: string
    connectionString?: string
    host?: string
    port?: number
  }
  tee?: {
    enabled: boolean
    platform: string
    attestation?: string
  }
  errors: string[]
}

export interface ProvisionedService {
  type: string
  name: string
  status: 'running' | 'stopped' | 'failed'
  endpoint?: string
  port?: number
}

// ============================================================================
// DStack Integration
// ============================================================================

interface DStackStatus {
  available: boolean
  platform: 'intel_tdx' | 'amd_sev' | 'simulator'
  measurement?: string
}

async function checkDStackStatus(): Promise<DStackStatus> {
  // Check for dstack environment indicators
  const cvmId = process.env.DSTACK_CVM_ID
  const tdxEnabled = process.env.TDX_ENABLED === 'true'
  const sevEnabled = process.env.SEV_ENABLED === 'true'

  if (cvmId || tdxEnabled) {
    return {
      available: true,
      platform: 'intel_tdx',
      measurement: cvmId,
    }
  }

  if (sevEnabled) {
    return {
      available: true,
      platform: 'amd_sev',
    }
  }

  // Default to simulator mode for local development
  return {
    available: true,
    platform: 'simulator',
  }
}

async function initializeTEE(config: DWSConfig['tee']): Promise<{
  enabled: boolean
  platform: string
  attestation?: string
}> {
  if (!config?.enabled) {
    return { enabled: false, platform: 'none' }
  }

  const status = await checkDStackStatus()

  // In production, if TEE is required but not available, fail
  if (config.required && !status.available && isProductionEnv()) {
    throw new Error('TEE required but not available')
  }

  // Generate simulated attestation for local dev
  const attestation =
    status.platform === 'simulator'
      ? `sim-attestation-${Date.now()}`
      : status.measurement

  console.log(`[AppDeployer] TEE initialized: ${status.platform}`)

  return {
    enabled: true,
    platform: status.platform,
    attestation,
  }
}

// ============================================================================
// App Deployer
// ============================================================================

export class AppDeployer {
  private owner: Address
  private nodeId: string

  constructor(owner: Address, nodeId: string = 'local-node') {
    this.owner = owner
    this.nodeId = nodeId
  }

  /**
   * Deploy an app from its manifest
   */
  async deploy(manifest: AppManifest): Promise<DeploymentResult> {
    const result: DeploymentResult = {
      appName: manifest.name,
      status: 'success',
      services: [],
      errors: [],
    }

    console.log(`[AppDeployer] Deploying ${manifest.name} v${manifest.version}`)

    // 1. Initialize TEE if configured
    if (manifest.dws?.tee?.enabled) {
      try {
        result.tee = await initializeTEE(manifest.dws.tee)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        result.errors.push(`TEE initialization failed: ${message}`)
        if (manifest.dws.tee.required) {
          result.status = 'failed'
          return result
        }
      }
    }

    // 2. Provision database if configured
    if (manifest.dws?.database && manifest.dws.database.type !== 'none') {
      try {
        const dbResult = await this.provisionDatabase(
          manifest.dws.database,
          manifest.name,
        )
        result.database = dbResult
        result.services.push({
          type: 'database',
          name: dbResult.name,
          status: 'running',
          endpoint: dbResult.host,
          port: dbResult.port,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        result.errors.push(`Database provisioning failed: ${message}`)
        result.status = 'partial'
      }
    }

    // 3. Provision additional services
    if (manifest.dws?.services) {
      for (const svcDef of manifest.dws.services) {
        try {
          const svc = await this.provisionInfraService(svcDef, manifest.name)
          result.services.push({
            type: svc.type,
            name: svc.name,
            status: svc.status === 'running' ? 'running' : 'stopped',
            endpoint: svc.endpoint,
            port: svc.ports[0].host,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          result.errors.push(
            `Service ${svcDef.name} provisioning failed: ${message}`,
          )
          result.status = 'partial'
        }
      }
    }

    // 4. Mark as failed if critical services couldn't be provisioned
    if (result.errors.length > 0 && result.services.length === 0) {
      result.status = 'failed'
    }

    console.log(`[AppDeployer] Deployment ${result.status}: ${manifest.name}`)
    return result
  }

  /**
   * Provision database based on type
   */
  private async provisionDatabase(
    config: NonNullable<DWSConfig['database']>,
    appName: string,
  ): Promise<NonNullable<DeploymentResult['database']>> {
    const dbName = config.name || `${appName}-db`

    if (config.type === 'postgres') {
      // Provision postgres via DWS services
      const serviceConfig: ServiceConfig = {
        type: 'postgres',
        name: dbName,
        version: config.version || '15',
        resources: {
          cpuCores: config.resources?.cpuCores ?? 1,
          memoryMb: config.resources?.memoryMb ?? 512,
          storageMb: config.resources?.storageMb ?? 5120,
        },
        ports: [{ container: 5432 }],
      }

      const instance = await provisionService(
        serviceConfig,
        this.owner,
        this.nodeId,
      )

      // Create the app's database
      await createDatabase(instance.id, appName.replace(/-/g, '_'))

      const port = instance.ports[0].host ?? 25432

      return {
        type: 'postgres',
        name: dbName,
        connectionString: `postgres://postgres:postgres@${getLocalhostHost()}:${port}/${appName.replace(/-/g, '_')}`,
        host: getLocalhostHost(),
        port,
      }
    }

    if (config.type === 'sqlit') {
      // SQLit databases are created on-demand
      return {
        type: 'sqlit',
        name: dbName,
      }
    }

    throw new Error(`Unsupported database type: ${config.type}`)
  }

  /**
   * Provision infrastructure service (redis, rabbitmq, minio, etc.)
   */
  private async provisionInfraService(
    def: ServiceDefinition,
    appName: string,
  ): Promise<ServiceInstance> {
    const serviceName = def.name || `${appName}-${def.type}`

    // Check if already exists
    const existing = getServiceByName(def.type, serviceName)
    if (existing && existing.status === 'running') {
      console.log(`[AppDeployer] Service ${serviceName} already running`)
      return existing
    }

    const serviceConfig: ServiceConfig = {
      type: def.type,
      name: serviceName,
      version: def.version,
      resources: {
        cpuCores: def.resources?.cpuCores ?? 1,
        memoryMb: def.resources?.memoryMb ?? 512,
        storageMb: def.resources?.storageMb ?? 5120,
      },
      env: def.env,
      ports: def.port
        ? [{ container: getDefaultPort(def.type), host: def.port }]
        : [{ container: getDefaultPort(def.type) }],
    }

    return provisionService(serviceConfig, this.owner, this.nodeId)
  }

  /**
   * Get deployment status for an app
   */
  async getStatus(appName: string): Promise<{
    deployed: boolean
    services: ProvisionedService[]
  }> {
    const allServices = await listServicesAsync(this.owner)
    const appServices = allServices.filter(
      (s) => s.name.startsWith(appName) || s.name.includes(appName),
    )

    return {
      deployed: appServices.length > 0,
      services: appServices.map((s) => ({
        type: s.type,
        name: s.name,
        status: s.status === 'running' ? 'running' : 'stopped',
        endpoint: s.endpoint,
        port: s.ports[0].host,
      })),
    }
  }
}

function getDefaultPort(type: ServiceType): number {
  switch (type) {
    case 'postgres':
      return 5432
    case 'redis':
      return 6379
    case 'rabbitmq':
      return 5672
    case 'minio':
      return 9000
    default:
      return 8080
  }
}

// ============================================================================
// API Router
// ============================================================================

const DeployRequestSchema = z.object({
  manifest: z.object({
    name: z.string().min(1),
    version: z.string(),
    dws: z
      .object({
        database: z
          .object({
            type: z.enum(['postgres', 'sqlit', 'd1', 'none']),
            name: z.string(),
            version: z.string().optional(),
            resources: z
              .object({
                cpuCores: z.number().optional(),
                memoryMb: z.number().optional(),
                storageMb: z.number().optional(),
              })
              .optional(),
          })
          .optional(),
        services: z
          .array(
            z.object({
              type: z.enum(['postgres', 'redis', 'rabbitmq', 'minio']),
              name: z.string(),
              version: z.string().optional(),
              port: z.number().optional(),
              env: z.record(z.string(), z.string()).optional(),
              resources: z
                .object({
                  cpuCores: z.number().optional(),
                  memoryMb: z.number().optional(),
                  storageMb: z.number().optional(),
                })
                .optional(),
            }),
          )
          .optional(),
        tee: z
          .object({
            enabled: z.boolean().optional(),
            required: z.boolean().optional(),
            platforms: z
              .array(z.enum(['dstack', 'intel_tdx', 'amd_sev', 'simulator']))
              .optional(),
          })
          .optional(),
      })
      .optional(),
  }),
})

export function createAppDeployerRouter() {
  return (
    new Elysia({ prefix: '/deploy' })
      .get('/health', () => ({
        status: 'healthy',
        service: 'dws-app-deployer',
      }))

      .post('/', async ({ body, request, set }) => {
        const parsed = DeployRequestSchema.safeParse(body)
        if (!parsed.success) {
          set.status = 400
          return { error: 'Invalid manifest', details: parsed.error.issues }
        }

        const ownerHeader = request.headers.get('x-jeju-address')
        const owner = (ownerHeader ??
          '0x0000000000000000000000000000000000000000') as Address

        const deployer = new AppDeployer(owner)
        const result = await deployer.deploy(
          parsed.data.manifest as AppManifest,
        )

        if (result.status === 'failed') {
          set.status = 500
        }

        return result
      })

      .get('/status/:appName', async ({ params, request }) => {
        const ownerHeader = request.headers.get('x-jeju-address')
        const owner = (ownerHeader ??
          '0x0000000000000000000000000000000000000000') as Address

        const deployer = new AppDeployer(owner)
        return deployer.getStatus(params.appName)
      })

      .get('/tee/status', async () => {
        const status = await checkDStackStatus()
        return {
          ...status,
          mode: isProductionEnv() ? 'production' : 'development',
          simulatorAllowed: !isProductionEnv(),
        }
      })

      // Worker deployment from CID - allows deploying large workers that were pre-uploaded
      .post('/worker', async ({ request, set }) => {
        const ownerHeader = request.headers.get('x-jeju-address')
        if (!ownerHeader) {
          set.status = 401
          return { error: 'x-jeju-address header required' }
        }
        const owner = ownerHeader as Address

        const contentType = request.headers.get('content-type') ?? ''

        // Parse request - supports JSON (with CID) or form data (with file)
        let name: string
        let codeCid: string | null = null
        let codeBuffer: Buffer | null = null
        let runtime: 'bun' | 'node' | 'deno' = 'bun'
        let handler = 'index.js'
        let memory = 256
        let timeout = 30000
        let routes: string[] = []
        let env: Record<string, string> = {}

        if (contentType.includes('application/json')) {
          const body = (await request.json()) as {
            name: string
            codeCid?: string
            runtime?: 'bun' | 'node' | 'deno'
            handler?: string
            memory?: number
            timeout?: number
            routes?: string[]
            env?: Record<string, string>
          }

          if (!body.name) {
            set.status = 400
            return { error: 'name is required' }
          }

          name = body.name
          codeCid = body.codeCid ?? null
          runtime = body.runtime ?? 'bun'
          handler = body.handler ?? 'index.js'
          memory = body.memory ?? 256
          timeout = body.timeout ?? 30000
          routes = body.routes ?? []
          env = body.env ?? {}
        } else if (contentType.includes('multipart/form-data')) {
          const formData = await request.formData()
          const nameField = formData.get('name')
          if (!nameField || typeof nameField !== 'string') {
            set.status = 400
            return { error: 'name is required' }
          }
          name = nameField

          const codeFile = formData.get('code')
          if (codeFile instanceof File) {
            codeBuffer = Buffer.from(await codeFile.arrayBuffer())
          }

          const codeCidField = formData.get('codeCid')
          if (codeCidField && typeof codeCidField === 'string') {
            codeCid = codeCidField
          }

          const runtimeField = formData.get('runtime')
          if (
            runtimeField &&
            typeof runtimeField === 'string' &&
            ['bun', 'node', 'deno'].includes(runtimeField)
          ) {
            runtime = runtimeField as 'bun' | 'node' | 'deno'
          }

          const handlerField = formData.get('handler')
          if (handlerField && typeof handlerField === 'string') {
            handler = handlerField
          }

          const memoryField = formData.get('memory')
          if (memoryField && typeof memoryField === 'string') {
            memory = parseInt(memoryField, 10) || 256
          }

          const timeoutField = formData.get('timeout')
          if (timeoutField && typeof timeoutField === 'string') {
            timeout = parseInt(timeoutField, 10) || 30000
          }

          const routesField = formData.get('routes')
          if (routesField && typeof routesField === 'string') {
            routes = JSON.parse(routesField) as string[]
          }

          const envField = formData.get('env')
          if (envField && typeof envField === 'string') {
            env = JSON.parse(envField) as Record<string, string>
          }
        } else {
          set.status = 400
          return {
            error:
              'Content-Type must be application/json or multipart/form-data',
          }
        }

        // Setup backend manager
        const { createBackendManager } = await import('../storage/backends')
        const backend = createBackendManager()

        // If codeCid provided, fetch code from storage (with IPFS gateway fallback)
        if (codeCid && !codeBuffer) {
          try {
            const downloadResult = await backend.download(codeCid)
            codeBuffer = downloadResult.content
          } catch (localError) {
            // Fallback: try fetching from IPFS gateway
            try {
              const { getIpfsGatewayUrl } = await import('@jejunetwork/config')
              const gatewayUrl = getIpfsGatewayUrl()
              const ipfsUrl = `${gatewayUrl}/ipfs/${codeCid}`
              console.log(
                `[AppDeployer] Fetching from IPFS gateway: ${ipfsUrl}`,
              )
              const response = await fetch(ipfsUrl)
              if (!response.ok) {
                throw new Error(`IPFS gateway returned ${response.status}`)
              }
              codeBuffer = Buffer.from(await response.arrayBuffer())
            } catch (gatewayError) {
              set.status = 400
              return {
                error: `Code not found in storage or IPFS: ${codeCid}`,
                details: {
                  localError:
                    localError instanceof Error
                      ? localError.message
                      : String(localError),
                  gatewayError:
                    gatewayError instanceof Error
                      ? gatewayError.message
                      : String(gatewayError),
                },
              }
            }
          }
        }

        if (!codeBuffer) {
          set.status = 400
          return { error: 'Either code file or codeCid is required' }
        }

        // Deploy to workers runtime - use shared runtime if available
        const { getSharedWorkersRuntime } = await import(
          '../server/routes/workers'
        )
        const { WorkerRuntime } = await import('../workers/runtime')
        const sharedRuntime = getSharedWorkersRuntime()
        const workerRuntime = sharedRuntime ?? new WorkerRuntime(backend)

        // Upload code to storage if not already uploaded
        let finalCid = codeCid
        if (!finalCid) {
          const uploadResult = await backend.upload(codeBuffer, {
            filename: `${name}.js`,
          })
          finalCid = uploadResult.cid
        }

        const functionId = crypto.randomUUID()
        const fn = {
          id: functionId,
          name,
          owner,
          runtime,
          handler,
          codeCid: finalCid,
          memory,
          timeout,
          env,
          status: 'active' as const,
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          invocationCount: 0,
          avgDurationMs: 0,
          errorCount: 0,
        }

        await workerRuntime.deployFunction(fn)

        // Register with app router if routes specified
        if (routes.length > 0) {
          const { registerDeployedApp } = await import(
            '../server/routes/app-router'
          )
          await registerDeployedApp({
            name,
            jnsName: `${name}.jeju`,
            frontendCid: null,
            staticFiles: null,
            backendWorkerId: functionId,
            backendEndpoint: `http://127.0.0.1:4030/workers/${functionId}/http`,
            apiPaths: routes,
            spa: false,
            enabled: true,
          })
        }

        set.status = 201
        return {
          functionId,
          name,
          codeCid: finalCid,
          status: fn.status,
          runtime,
          routes,
        }
      })

      // App deployment - full app with frontend and backend
      .post('/apps', async ({ request, set }) => {
        const ownerHeader = request.headers.get('x-jeju-address')
        if (!ownerHeader) {
          set.status = 401
          return { error: 'x-jeju-address header required' }
        }
        const ownerAddress = ownerHeader as Address

        const body = (await request.json()) as {
          name: string
          frontendCid?: string
          staticFiles?: Record<string, string>
          backendCid?: string
          backendWorkerId?: string
          backendEndpoint?: string
          jnsName?: string
          apiPaths?: string[]
          spa?: boolean
        }

        if (!body.name) {
          set.status = 400
          return { error: 'name is required' }
        }

        // If backend CID provided, deploy as worker
        // If backendWorkerId provided, use it directly (for pre-deployed workers)
        // If backendEndpoint provided, use it directly (for external services)
        let backendWorkerId: string | null = body.backendWorkerId ?? null
        let backendEndpoint: string | null =
          body.backendEndpoint ??
          (backendWorkerId
            ? `http://127.0.0.1:4030/workers/${backendWorkerId}/http`
            : null)

        if (body.backendCid && !backendWorkerId) {
          const { createBackendManager } = await import('../storage/backends')
          const backend = createBackendManager()
          const { WorkerRuntime } = await import('../workers/runtime')
          const workerRuntime = new WorkerRuntime(backend)

          // Verify code exists in storage
          try {
            await backend.download(body.backendCid)
          } catch {
            set.status = 400
            return {
              error: `Backend code not found in storage: ${body.backendCid}`,
            }
          }

          const functionId = crypto.randomUUID()
          const fn = {
            id: functionId,
            name: `${body.name}-api`,
            owner: ownerAddress,
            runtime: 'bun' as const,
            handler: 'server.js',
            codeCid: body.backendCid,
            memory: 512,
            timeout: 30000,
            env: {},
            status: 'active' as const,
            version: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            invocationCount: 0,
            avgDurationMs: 0,
            errorCount: 0,
          }

          await workerRuntime.deployFunction(fn)
          backendWorkerId = functionId
          backendEndpoint = `http://127.0.0.1:4030/workers/${functionId}/http`
        }

        // Register with app router
        const { registerDeployedApp } = await import(
          '../server/routes/app-router'
        )
        await registerDeployedApp({
          name: body.name,
          jnsName: body.jnsName ?? `${body.name}.jeju`,
          frontendCid: body.frontendCid ?? null,
          staticFiles: body.staticFiles ?? null,
          backendWorkerId,
          backendEndpoint,
          apiPaths: body.apiPaths ?? ['/api'],
          spa: body.spa ?? true,
          enabled: true,
        })

        const appId = `app_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

        return {
          appId,
          name: body.name,
          frontendCid: body.frontendCid,
          backendCid: body.backendCid,
          backendWorkerId,
          jnsName: body.jnsName ?? `${body.name}.jeju`,
          status: 'ready',
        }
      })

      // Next.js app deployment endpoint
      .post('/nextjs', async ({ request, set }) => {
        const ownerHeader = request.headers.get('x-jeju-address')
        const ownerAddress = (ownerHeader ??
          '0x0000000000000000000000000000000000000000') as Address

        const formData = await request.formData()
        const workerTar = formData.get('worker') as File | null
        const configStr = formData.get('config') as string | null

        if (!workerTar || !configStr) {
          set.status = 400
          return { error: 'worker tarball and config required' }
        }

        const config = JSON.parse(configStr) as {
          name: string
          owner: Address
          framework: string
          target: string
          regions: string[]
          manifest: AppManifest
          env: Record<string, string>
          database?: { type: string; name: string }
          services?: ServiceDefinition[]
          scaling?: { minInstances?: number; maxInstances?: number }
          cron?: Array<{ schedule: string; command: string }>
        }

        // Use config.owner if provided, otherwise use header
        const effectiveOwner = config.owner || ownerAddress

        const deploymentId = `dpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const now = new Date().toISOString()

        // Upload worker bundle to storage
        const workerBundle = Buffer.from(await workerTar.arrayBuffer())
        const workerHash = `wrk_${deploymentId}`

        // Store worker bundle for later deployment
        console.log(
          `[Deploy] Storing worker bundle: ${workerBundle.length} bytes for ${config.name}, owner: ${effectiveOwner}`,
        )

        // In production, this would:
        // 1. Upload worker bundle to IPFS
        // 2. Deploy to workerd across regions
        // 3. Register with app router
        // For now, we simulate the deployment

        const workerUrl = `https://${config.name}.${isProductionEnv() ? '' : 'testnet.'}jejunetwork.org`
        const staticUrl = config.env.STATIC_ASSETS_CID
          ? `https://ipfs.io/ipfs/${config.env.STATIC_ASSETS_CID}`
          : workerUrl

        // Register with app router (imported from app-router.ts)
        const { registerDeployedApp } = await import(
          '../server/routes/app-router'
        )
        await registerDeployedApp({
          name: config.name,
          jnsName: `${config.name}.jeju`,
          frontendCid: config.env.STATIC_ASSETS_CID ?? null,
          staticFiles: null,
          backendWorkerId: workerHash,
          backendEndpoint: null,
          apiPaths: [
            '/api',
            '/health',
            '/a2a',
            '/mcp',
            '/oauth',
            '/callback',
            '/webhook',
          ],
          spa: true,
          enabled: true,
        })

        return {
          deploymentId,
          workerUrl,
          staticUrl,
          status: 'ready' as const,
          regions: config.regions,
          createdAt: now,
          frontendCid: config.env.STATIC_ASSETS_CID,
          workerCid: workerHash,
        }
      })
  )
}
