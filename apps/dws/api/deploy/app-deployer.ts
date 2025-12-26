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
    type: 'postgres' | 'covenantsql' | 'd1' | 'none'
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
    type: 'covenantql' | 'cql-sync' | 'none'
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
  if (
    config.required &&
    !status.available &&
    process.env.NODE_ENV === 'production'
  ) {
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
            port: svc.ports[0]?.host,
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

      const port = instance.ports[0]?.host ?? 25432

      return {
        type: 'postgres',
        name: dbName,
        connectionString: `postgres://postgres:postgres@localhost:${port}/${appName.replace(/-/g, '_')}`,
        host: 'localhost',
        port,
      }
    }

    if (config.type === 'covenantsql') {
      // CQL databases are created on-demand
      return {
        type: 'covenantsql',
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
        port: s.ports[0]?.host,
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
            type: z.enum(['postgres', 'covenantsql', 'd1', 'none']),
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

// Deployment record with version history
interface DeploymentRecord {
  id: string
  appName: string
  owner: Address
  domain: string
  status: 'deploying' | 'active' | 'failed' | 'stopped'
  version: string
  commit?: string
  branch?: string
  createdAt: number
  updatedAt: number
  url: string
  framework?: string
  region: string
  previousVersions: Array<{ version: string; commit?: string; deployedAt: number }>
}

// Track deployments in memory (in production, use persistent storage)
const deploymentStore = new Map<string, DeploymentRecord>()

export function createAppDeployerRouter() {
  return new Elysia({ prefix: '/deploy' })
    .get('/health', () => ({
      status: 'healthy',
      service: 'dws-app-deployer',
    }))

    .get('/list', async ({ request }) => {
      const ownerHeader = request.headers.get('x-jeju-address')?.toLowerCase()

      // Get deployments for this owner
      const deployments = Array.from(deploymentStore.values()).filter((d) => {
        if (!ownerHeader) return true
        return d.owner?.toLowerCase() === ownerHeader
      })

      // Also check running services
      const services = await listServicesAsync()
      const serviceDeployments = services
        .filter((s) => {
          if (!ownerHeader) return true
          // Skip services without owner or with non-matching owner
          return s.owner?.toLowerCase() === ownerHeader
        })
        .map((s) => ({
          id: s.id,
          appName: s.name,
          owner: s.owner || ('0x0' as Address),
          domain: `${s.name}.jeju.app`,
          status: s.status === 'running' ? 'active' : ('stopped' as const),
          version: s.config.version || 'v1.0.0',
          createdAt: s.createdAt,
          updatedAt: Date.now(),
          url: `https://${s.name}.jeju.app`,
          region: 'global',
        }))

      return {
        deployments: [...deployments, ...serviceDeployments],
      }
    })

    .post('/', async ({ body, request, set }) => {
      const parsed = DeployRequestSchema.safeParse(body)
      if (!parsed.success) {
        set.status = 400
        return { error: 'Invalid manifest', details: parsed.error.issues }
      }

      const ownerHeader = request.headers.get('x-jeju-address')
      const owner = (ownerHeader ??
        '0x0000000000000000000000000000000000000000') as Address

      const manifest = parsed.data.manifest as AppManifest
      const deployer = new AppDeployer(owner)
      const result = await deployer.deploy(manifest)

      if (result.status === 'failed') {
        set.status = 500
      } else {
        // Track deployment with version history
        const existing = deploymentStore.get(manifest.name)
        const now = Date.now()

        const record: DeploymentRecord = {
          id: existing?.id || `deploy-${now}`,
          appName: manifest.name,
          owner,
          domain: `${manifest.name}.jeju.app`,
          status: result.status === 'success' ? 'active' : 'deploying',
          version: manifest.version,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          url: `https://${manifest.name}.jeju.app`,
          region: 'global',
          previousVersions: existing?.previousVersions || [],
        }

        // Push current version to history if updating
        if (existing && existing.version !== manifest.version) {
          record.previousVersions.push({
            version: existing.version,
            commit: existing.commit,
            deployedAt: existing.updatedAt,
          })
        }

        deploymentStore.set(manifest.name, record)
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
        mode:
          process.env.NODE_ENV === 'production' ? 'production' : 'development',
        simulatorAllowed: process.env.NODE_ENV !== 'production',
      }
    })

    .post('/:appName/rollback', async ({ params, request, set }) => {
      const ownerHeader = request.headers.get('x-jeju-address')?.toLowerCase()
      const deployment = Array.from(deploymentStore.values()).find(
        (d) => d.appName === params.appName && d.owner.toLowerCase() === ownerHeader,
      )

      if (!deployment) {
        set.status = 404
        return { error: 'Deployment not found' }
      }

      if (deployment.previousVersions.length === 0) {
        set.status = 400
        return { error: 'No previous version to rollback to' }
      }

      const previousVersion = deployment.previousVersions.pop()
      if (!previousVersion) {
        set.status = 400
        return { error: 'No previous version available' }
      }

      // Save current version to history before rollback
      deployment.previousVersions.push({
        version: deployment.version,
        commit: deployment.commit,
        deployedAt: deployment.updatedAt,
      })

      // Rollback to previous version
      deployment.version = previousVersion.version
      deployment.commit = previousVersion.commit
      deployment.updatedAt = Date.now()
      deployment.status = 'active'

      console.log(`[Deploy] Rolled back ${params.appName} to ${previousVersion.version}`)

      return {
        success: true,
        appName: deployment.appName,
        rolledBackTo: previousVersion.version,
        previousVersion: deployment.previousVersions[deployment.previousVersions.length - 1]?.version,
      }
    })

    .get('/:appName/versions', async ({ params, request, set }) => {
      const ownerHeader = request.headers.get('x-jeju-address')?.toLowerCase()
      const deployment = Array.from(deploymentStore.values()).find(
        (d) => d.appName === params.appName && (!ownerHeader || d.owner.toLowerCase() === ownerHeader),
      )

      if (!deployment) {
        set.status = 404
        return { error: 'Deployment not found' }
      }

      return {
        current: { version: deployment.version, commit: deployment.commit, deployedAt: deployment.updatedAt },
        history: deployment.previousVersions,
      }
    })
}
