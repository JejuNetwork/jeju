/**
 * DWS Infrastructure Services
 * Persistent service provisioning for databases, caches, message queues, etc.
 *
 * Unlike serverless containers, infrastructure services:
 * - Run persistently (not ephemeral)
 * - Have volume mounts for data persistence
 * - Have health checks and auto-restart
 * - Are billed based on uptime, not execution time
 *
 * Service registry is persisted to CQL for recovery across DWS restarts.
 */

import { isProductionEnv } from '@jejunetwork/config'
import { type CQLClient, getCQL } from '@jejunetwork/db'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'

// CQL persistence for service registry
const SERVICES_DATABASE_ID = 'dws-infrastructure-services'
let cqlClient: CQLClient | null = null

async function getCQLClient(): Promise<CQLClient> {
  if (!cqlClient) {
    cqlClient = getCQL()
    await ensureServicesTables()
  }
  return cqlClient
}

async function ensureServicesTables(): Promise<void> {
  if (!cqlClient) return

  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS infrastructure_services (
      service_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      container_name TEXT NOT NULL,
      owner TEXT NOT NULL,
      node_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      ports TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      config TEXT NOT NULL
    )
  `

  await cqlClient.exec(createTableSQL, [], SERVICES_DATABASE_ID)
}

async function persistService(instance: ServiceInstance): Promise<void> {
  const client = await getCQLClient()

  const sql = `
    INSERT OR REPLACE INTO infrastructure_services 
    (service_id, type, name, container_name, owner, node_id, endpoint, ports, created_at, config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `

  await client.exec(
    sql,
    [
      instance.id,
      instance.type,
      instance.name,
      instance.containerName,
      instance.owner,
      instance.nodeId,
      instance.endpoint,
      JSON.stringify(instance.ports),
      instance.createdAt,
      JSON.stringify(instance.config),
    ],
    SERVICES_DATABASE_ID,
  )
}

async function loadPersistedServices(): Promise<void> {
  try {
    const client = await getCQLClient()

    interface ServiceRow {
      service_id: string
      type: ServiceType
      name: string
      container_name: string
      owner: string
      node_id: string
      endpoint: string
      ports: string
      created_at: number
      config: string
    }

    const result = await client.query(
      'SELECT * FROM infrastructure_services',
      [],
      SERVICES_DATABASE_ID,
    )
    const rows = (result.rows ?? result ?? []) as ServiceRow[]

    for (const row of rows) {
      const ports = JSON.parse(row.ports) as {
        container: number
        host: number
      }[]
      const config = JSON.parse(row.config) as ServiceConfig

      const instance: ServiceInstance = {
        id: row.service_id,
        type: row.type,
        name: row.name,
        containerName: row.container_name,
        status: 'unknown',
        owner: row.owner as Address,
        nodeId: row.node_id,
        endpoint: row.endpoint,
        ports,
        createdAt: row.created_at,
        startedAt: null,
        lastHealthCheck: null,
        healthStatus: 'unknown',
        config,
      }

      // Only add if not already in memory
      const existingByName = getServiceByName(instance.type, instance.name)
      if (!existingByName) {
        services.set(instance.id, instance)
        console.log(
          `[Services] Loaded persisted service: ${instance.type}/${instance.name}`,
        )
      }
    }

    if (rows.length > 0) {
      console.log(
        `[Services] Loaded ${rows.length} persisted services from CQL`,
      )
    }
  } catch (_error) {
    // CQL may not be available yet, that's ok
    console.log(
      '[Services] CQL not available for persistence, using memory only',
    )
  }
}

async function removePersistedService(serviceId: string): Promise<void> {
  try {
    const client = await getCQLClient()
    await client.exec(
      'DELETE FROM infrastructure_services WHERE service_id = ?',
      [serviceId],
      SERVICES_DATABASE_ID,
    )
  } catch {
    // Ignore CQL errors
  }
}

// Service Types

export type ServiceType = 'postgres' | 'redis' | 'rabbitmq' | 'minio'
export type ServiceStatus =
  | 'provisioning'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'unknown'

export interface ServiceConfig {
  type: ServiceType
  name: string
  version?: string
  resources: {
    cpuCores: number
    memoryMb: number
    storageMb: number
  }
  env?: Record<string, string>
  ports: { container: number; host?: number }[]
  healthCheck?: {
    command: string[]
    interval: number
    timeout: number
    retries: number
  }
  volumes?: { name: string; mountPath: string }[]
}

export interface ServiceInstance {
  id: string
  type: ServiceType
  name: string
  containerName: string
  status: ServiceStatus
  owner: Address
  nodeId: string
  endpoint: string
  ports: { container: number; host: number }[]
  createdAt: number
  startedAt: number | null
  lastHealthCheck: number | null
  healthStatus: 'healthy' | 'unhealthy' | 'unknown'
  config: ServiceConfig
}

// SECURITY: Get service password with production enforcement
function getServicePassword(envVar: string, serviceName: string): string {
  const password = process.env[envVar]
  if (!password) {
    if (isProductionEnv()) {
      throw new Error(
        `CRITICAL: ${envVar} must be set in production. ${serviceName} cannot be deployed with default credentials.`,
      )
    }
    console.warn(
      `[Services] WARNING: ${envVar} not set. Using dev-only default for ${serviceName}.`,
    )
    return `dev_${serviceName}_password`
  }
  return password
}

// Default service configurations
const SERVICE_DEFAULTS: Record<ServiceType, Partial<ServiceConfig>> = {
  postgres: {
    version: '15',
    resources: { cpuCores: 1, memoryMb: 512, storageMb: 5120 },
    ports: [{ container: 5432 }],
    healthCheck: {
      command: ['pg_isready', '-U', 'postgres'],
      interval: 10000,
      timeout: 5000,
      retries: 3,
    },
    env: {
      POSTGRES_PASSWORD: getServicePassword(
        'DEFAULT_POSTGRES_PASSWORD',
        'postgres',
      ),
    },
  },
  redis: {
    version: '7',
    resources: { cpuCores: 1, memoryMb: 256, storageMb: 1024 },
    ports: [{ container: 6379 }],
    healthCheck: {
      command: ['redis-cli', 'ping'],
      interval: 10000,
      timeout: 5000,
      retries: 3,
    },
  },
  rabbitmq: {
    version: '3-management',
    resources: { cpuCores: 1, memoryMb: 512, storageMb: 2048 },
    ports: [{ container: 5672 }, { container: 15672 }],
    healthCheck: {
      command: ['rabbitmq-diagnostics', 'check_running'],
      interval: 30000,
      timeout: 10000,
      retries: 3,
    },
  },
  minio: {
    version: 'latest',
    resources: { cpuCores: 1, memoryMb: 512, storageMb: 10240 },
    ports: [{ container: 9000 }, { container: 9001 }],
    env: {
      MINIO_ROOT_USER: process.env.DEFAULT_MINIO_USER || 'minioadmin',
      MINIO_ROOT_PASSWORD: getServicePassword(
        'DEFAULT_MINIO_PASSWORD',
        'minio',
      ),
    },
  },
}

// In-memory service registry (populated on startup from Docker state)
const services = new Map<string, ServiceInstance>()
let discoveryComplete = false

function resetDiscovery(): void {
  services.clear()
  discoveryComplete = false
}

// Docker image mappings
const SERVICE_IMAGES: Record<ServiceType, string> = {
  postgres: 'postgres',
  redis: 'redis',
  rabbitmq: 'rabbitmq',
  minio: 'minio/minio',
}

// Container naming convention: dws-{type}-{name}
const DWS_CONTAINER_PREFIX = 'dws-'

// Service Provisioning

async function dockerCommand(
  args: string[],
): Promise<{ success: boolean; output: string }> {
  const proc = Bun.spawn(['docker', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  return {
    success: exitCode === 0,
    output: stdout || stderr,
  }
}

/**
 * Discover existing DWS-managed containers on startup
 * This ensures services persist across DWS restarts
 *
 * Sources:
 * 1. CQL persistence (for services we created)
 * 2. Docker state (for containers that exist)
 */
export async function discoverExistingServices(): Promise<void> {
  if (discoveryComplete) return

  console.log('[Services] Discovering existing DWS-managed containers...')

  // First, load from CQL persistence
  await loadPersistedServices()

  // List all containers with dws- prefix (including stopped ones)
  const result = await dockerCommand([
    'ps',
    '-a',
    '--filter',
    `name=${DWS_CONTAINER_PREFIX}`,
    '--format',
    '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}',
  ])

  if (!result.success || !result.output.trim()) {
    console.log('[Services] No existing DWS containers found')
    discoveryComplete = true
    return
  }

  const lines = result.output.trim().split('\n').filter(Boolean)

  for (const line of lines) {
    const [containerName, _image, status, portsStr] = line.split('|')
    if (!containerName.startsWith(DWS_CONTAINER_PREFIX)) continue

    // Parse container name: dws-{type}-{name}
    const nameParts = containerName
      .slice(DWS_CONTAINER_PREFIX.length)
      .split('-')
    const type = nameParts[0] as ServiceType
    const name = nameParts.slice(1).join('-')

    if (!['postgres', 'redis', 'rabbitmq', 'minio'].includes(type)) {
      continue
    }

    // Parse ports: "0.0.0.0:23798->5432/tcp, ..."
    const ports: { container: number; host: number }[] = []
    if (portsStr) {
      const portMatches = portsStr.matchAll(/(\d+)->(\d+)/g)
      for (const match of portMatches) {
        ports.push({
          host: parseInt(match[1], 10),
          container: parseInt(match[2], 10),
        })
      }
    }

    const isRunning = status.toLowerCase().includes('up')
    const serviceId = `${type}-${name}-discovered`

    const instance: ServiceInstance = {
      id: serviceId,
      type,
      name,
      containerName,
      status: isRunning ? 'running' : 'stopped',
      owner: '0x0000000000000000000000000000000000000000' as Address,
      nodeId: 'local-node',
      endpoint: 'localhost',
      ports,
      createdAt: Date.now(), // Unknown, use now
      startedAt: isRunning ? Date.now() : null,
      lastHealthCheck: null,
      healthStatus: 'unknown',
      config: {
        type,
        name,
        resources: { cpuCores: 1, memoryMb: 512, storageMb: 5120 },
        ports,
      },
    }

    // Only add if not already tracked (from CQL persistence)
    const existingByName = getServiceByName(type, name)
    if (!existingByName) {
      services.set(serviceId, instance)
      console.log(
        `[Services] Discovered ${type} service: ${containerName} (${isRunning ? 'running' : 'stopped'})`,
      )
    } else {
      // Update existing with current runtime status
      existingByName.status = isRunning ? 'running' : 'stopped'
      existingByName.ports = ports.length > 0 ? ports : existingByName.ports
    }
  }

  // Run health checks on discovered services
  for (const [serviceId] of services) {
    await checkServiceHealth(serviceId)
  }

  discoveryComplete = true
  console.log(`[Services] Discovery complete. Found ${services.size} services.`)
}

export async function provisionService(
  config: ServiceConfig,
  owner: Address,
  nodeId: string,
): Promise<ServiceInstance> {
  // Ensure discovery is complete
  await discoverExistingServices()

  const defaults = SERVICE_DEFAULTS[config.type]
  const mergedConfig: ServiceConfig = {
    ...defaults,
    ...config,
    resources: { ...defaults.resources, ...config.resources },
    env: { ...defaults.env, ...config.env },
    ports: config.ports.length > 0 ? config.ports : (defaults.ports ?? []),
  }

  const containerName = `dws-${config.type}-${config.name}`
  const image = `${SERVICE_IMAGES[config.type]}:${mergedConfig.version ?? 'latest'}`

  // Check if we already have this service tracked
  const existingService = getServiceByName(config.type, config.name)
  if (existingService) {
    // Service already tracked - check if container actually exists and is healthy
    await checkServiceHealth(existingService.id)

    // If the service is running and healthy, return it
    if (
      existingService.status === 'running' &&
      existingService.healthStatus === 'healthy'
    ) {
      return existingService
    }

    // Service is stopped/unhealthy - try to start or recreate the container
    console.log(
      `[Services] Existing service ${existingService.id} is ${existingService.status}/${existingService.healthStatus}, attempting recovery...`,
    )

    // Check if container exists
    const existsResult = await dockerCommand([
      'ps',
      '-aq',
      '-f',
      `name=${containerName}`,
    ])

    if (existsResult.output.trim()) {
      // Container exists - try to start it
      console.log(`[Services] Starting stopped container: ${containerName}`)
      await dockerCommand(['start', containerName])
    } else {
      // Container doesn't exist - need to create it
      console.log(
        `[Services] Container ${containerName} missing, recreating...`,
      )

      // Remove stale service entry
      services.delete(existingService.id)

      // Fall through to create new container below
    }

    // If container was started, wait for health and return
    if (existsResult.output.trim()) {
      const healthResult = await waitForServiceHealth(
        containerName,
        existingService.config,
      )
      existingService.status = healthResult ? 'running' : 'failed'
      existingService.healthStatus = healthResult ? 'healthy' : 'unhealthy'
      existingService.lastHealthCheck = Date.now()
      return existingService
    }
  }

  const serviceId =
    existingService?.id ??
    `${config.type}-${config.name}-${crypto.randomUUID().slice(0, 8)}`

  // Check if container already exists in Docker
  const existsResult = await dockerCommand([
    'ps',
    '-aq',
    '-f',
    `name=${containerName}`,
  ])

  if (existsResult.output.trim()) {
    // Container exists - check if running
    const runningResult = await dockerCommand([
      'ps',
      '-q',
      '-f',
      `name=${containerName}`,
    ])

    if (!runningResult.output.trim()) {
      // Container exists but not running - start it
      console.log(`[Services] Starting existing container: ${containerName}`)
      await dockerCommand(['start', containerName])
    } else {
      console.log(`[Services] Container already running: ${containerName}`)
    }
  } else {
    // Create new container
    console.log(
      `[Services] Provisioning new ${config.type} service: ${containerName}`,
    )

    const dockerArgs = ['run', '-d', '--name', containerName]

    // Add environment variables
    for (const [key, value] of Object.entries(mergedConfig.env ?? {})) {
      dockerArgs.push('-e', `${key}=${value}`)
    }

    // Add port mappings
    const assignedPorts: { container: number; host: number }[] = []
    for (const port of mergedConfig.ports) {
      const hostPort = port.host ?? port.container + 20000 // Default offset for host ports
      dockerArgs.push('-p', `${hostPort}:${port.container}`)
      assignedPorts.push({ container: port.container, host: hostPort })
    }

    // Add resource limits
    dockerArgs.push('--memory', `${mergedConfig.resources.memoryMb}m`)
    dockerArgs.push('--cpus', String(mergedConfig.resources.cpuCores))

    // Add SHM size for postgres
    if (config.type === 'postgres') {
      dockerArgs.push('--shm-size', '256m')
    }

    // Add image
    dockerArgs.push(image)

    // Add command for minio
    if (config.type === 'minio') {
      dockerArgs.push('server', '/data', '--console-address', ':9001')
    }

    const createResult = await dockerCommand(dockerArgs)

    if (!createResult.success) {
      throw new Error(`Failed to create container: ${createResult.output}`)
    }

    mergedConfig.ports = assignedPorts
  }

  // Wait for service to be healthy
  const healthResult = await waitForServiceHealth(containerName, mergedConfig)

  const instance: ServiceInstance = {
    id: serviceId,
    type: config.type,
    name: config.name,
    containerName,
    status: healthResult ? 'running' : 'failed',
    owner,
    nodeId,
    endpoint: `localhost`,
    ports: mergedConfig.ports as { container: number; host: number }[],
    createdAt: Date.now(),
    startedAt: healthResult ? Date.now() : null,
    lastHealthCheck: Date.now(),
    healthStatus: healthResult ? 'healthy' : 'unhealthy',
    config: mergedConfig,
  }

  services.set(serviceId, instance)

  // Persist to CQL for recovery
  await persistService(instance).catch((err) =>
    console.log(`[Services] Failed to persist service to CQL: ${err}`),
  )

  console.log(
    `[Services] ${config.type} service ${config.name} provisioned: ${healthResult ? 'healthy' : 'unhealthy'}`,
  )

  return instance
}

async function waitForServiceHealth(
  containerName: string,
  config: ServiceConfig,
  maxWaitMs: number = 60000,
): Promise<boolean> {
  const healthCheck = config.healthCheck
  if (!healthCheck) {
    // No health check defined, just wait a bit
    await new Promise((r) => setTimeout(r, 2000))
    return true
  }

  const startTime = Date.now()
  let attempts = 0

  while (Date.now() - startTime < maxWaitMs) {
    attempts++
    const result = await dockerCommand([
      'exec',
      containerName,
      ...healthCheck.command,
    ])

    if (result.success) {
      console.log(
        `[Services] Health check passed for ${containerName} after ${attempts} attempts`,
      )
      return true
    }

    await new Promise((r) => setTimeout(r, healthCheck.interval))
  }

  console.log(
    `[Services] Health check failed for ${containerName} after ${attempts} attempts`,
  )
  return false
}

export async function stopService(serviceId: string): Promise<boolean> {
  const instance = services.get(serviceId)
  if (!instance) {
    return false
  }

  const result = await dockerCommand(['stop', instance.containerName])
  if (result.success) {
    instance.status = 'stopped'
    instance.healthStatus = 'unknown'
  }

  return result.success
}

export async function removeService(serviceId: string): Promise<boolean> {
  const instance = services.get(serviceId)
  if (!instance) {
    return false
  }

  // Try to stop and remove container (may already be gone)
  await dockerCommand(['stop', instance.containerName])
  await dockerCommand(['rm', instance.containerName])

  // Always remove from registry and CQL (even if container doesn't exist)
  services.delete(serviceId)
  await removePersistedService(serviceId)

  return true
}

export function getService(serviceId: string): ServiceInstance | null {
  return services.get(serviceId) ?? null
}

export function getServiceByName(
  type: ServiceType,
  name: string,
): ServiceInstance | null {
  for (const instance of services.values()) {
    if (instance.type === type && instance.name === name) {
      return instance
    }
  }
  return null
}

export async function listServicesAsync(
  owner?: Address,
): Promise<ServiceInstance[]> {
  await discoverExistingServices()
  const all = [...services.values()]
  if (owner) {
    return all.filter((s) => s.owner.toLowerCase() === owner.toLowerCase())
  }
  return all
}

export function listServices(owner?: Address): ServiceInstance[] {
  const all = [...services.values()]
  if (owner) {
    return all.filter((s) => s.owner.toLowerCase() === owner.toLowerCase())
  }
  return all
}

export async function checkServiceHealth(
  serviceId: string,
): Promise<ServiceInstance | null> {
  const instance = services.get(serviceId)
  if (!instance) {
    return null
  }

  // Check if container is running
  const runningResult = await dockerCommand([
    'ps',
    '-q',
    '-f',
    `name=${instance.containerName}`,
  ])

  if (!runningResult.output.trim()) {
    instance.status = 'stopped'
    instance.healthStatus = 'unknown'
    return instance
  }

  // Run health check if defined
  if (instance.config.healthCheck) {
    const healthResult = await dockerCommand([
      'exec',
      instance.containerName,
      ...instance.config.healthCheck.command,
    ])

    instance.healthStatus = healthResult.success ? 'healthy' : 'unhealthy'
    instance.status = healthResult.success ? 'running' : 'failed'
  } else {
    instance.status = 'running'
    instance.healthStatus = 'healthy'
  }

  instance.lastHealthCheck = Date.now()
  return instance
}

// Database-specific utilities

export async function createDatabase(
  serviceId: string,
  databaseName: string,
): Promise<boolean> {
  const instance = services.get(serviceId)
  if (!instance || instance.type !== 'postgres') {
    return false
  }

  // Check if database exists
  const checkResult = await dockerCommand([
    'exec',
    instance.containerName,
    'psql',
    '-U',
    'postgres',
    '-lqt',
  ])

  if (checkResult.output.includes(databaseName)) {
    console.log(`[Services] Database ${databaseName} already exists`)
    return true
  }

  // Create database
  const createResult = await dockerCommand([
    'exec',
    instance.containerName,
    'psql',
    '-U',
    'postgres',
    '-c',
    `CREATE DATABASE ${databaseName};`,
  ])

  if (createResult.success) {
    console.log(`[Services] Database ${databaseName} created`)
  }

  return createResult.success
}

// Request schemas

const provisionRequestSchema = z.object({
  type: z.enum(['postgres', 'redis', 'rabbitmq', 'minio']),
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  version: z.string().optional(),
  resources: z
    .object({
      cpuCores: z.number().min(0.25).max(16).optional(),
      memoryMb: z.number().min(128).max(32768).optional(),
      storageMb: z.number().min(256).max(102400).optional(),
    })
    .optional(),
  env: z.record(z.string(), z.string()).optional(),
  ports: z
    .array(
      z.object({
        container: z.number(),
        host: z.number().optional(),
      }),
    )
    .optional(),
})

const createDatabaseRequestSchema = z.object({
  databaseName: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/),
})

// API Router

export function createServicesRouter() {
  // Run discovery on router creation
  discoverExistingServices().catch(console.error)

  return (
    new Elysia({ prefix: '/services' })
      .get('/health', async () => {
        await discoverExistingServices()
        return {
          status: 'healthy',
          service: 'dws-infrastructure-services',
          activeServices: services.size,
        }
      })

      .post('/discover', async () => {
        // Force re-discovery
        resetDiscovery()
        await discoverExistingServices()
        return {
          discovered: services.size,
          services: [...services.values()].map((s) => ({
            id: s.id,
            type: s.type,
            name: s.name,
            status: s.status,
          })),
        }
      })

      .get('/', async ({ query }) => {
        const owner = query.owner as Address | undefined
        const all = await listServicesAsync(owner)
        return {
          services: all.map((s) => ({
            id: s.id,
            type: s.type,
            name: s.name,
            status: s.status,
            healthStatus: s.healthStatus,
            endpoint: s.endpoint,
            ports: s.ports,
            createdAt: s.createdAt,
          })),
        }
      })

      .post('/provision', async ({ body, request, set }) => {
        const parsed = provisionRequestSchema.safeParse(body)
        if (!parsed.success) {
          set.status = 400
          return { error: 'Invalid request', details: parsed.error.issues }
        }

        const ownerHeader = request.headers.get('x-jeju-address')
        const owner = (ownerHeader ??
          '0x0000000000000000000000000000000000000000') as Address
        const nodeId = 'local-node' // In production, get from node registry

        const config: ServiceConfig = {
          type: parsed.data.type,
          name: parsed.data.name,
          version: parsed.data.version,
          resources: {
            cpuCores: parsed.data.resources?.cpuCores ?? 1,
            memoryMb: parsed.data.resources?.memoryMb ?? 512,
            storageMb: parsed.data.resources?.storageMb ?? 5120,
          },
          env: parsed.data.env,
          ports: parsed.data.ports ?? [],
        }

        const instance = await provisionService(config, owner, nodeId)

        return {
          id: instance.id,
          type: instance.type,
          name: instance.name,
          status: instance.status,
          healthStatus: instance.healthStatus,
          endpoint: instance.endpoint,
          ports: instance.ports,
        }
      })

      .get('/:id', async ({ params, set }) => {
        const instance = await checkServiceHealth(params.id)
        if (!instance) {
          set.status = 404
          return { error: 'Service not found' }
        }

        return {
          id: instance.id,
          type: instance.type,
          name: instance.name,
          status: instance.status,
          healthStatus: instance.healthStatus,
          endpoint: instance.endpoint,
          ports: instance.ports,
          createdAt: instance.createdAt,
          lastHealthCheck: instance.lastHealthCheck,
        }
      })

      .post('/:id/stop', async ({ params, set }) => {
        const success = await stopService(params.id)
        if (!success) {
          set.status = 404
          return { error: 'Service not found or could not be stopped' }
        }
        return { status: 'stopped' }
      })

      .delete('/:id', async ({ params, set }) => {
        const success = await removeService(params.id)
        if (!success) {
          set.status = 404
          return { error: 'Service not found or could not be removed' }
        }
        return { status: 'removed' }
      })

      // Database-specific endpoints
      .post('/:id/databases', async ({ params, body, set }) => {
        const instance = services.get(params.id)
        if (!instance) {
          set.status = 404
          return { error: 'Service not found' }
        }

        if (instance.type !== 'postgres') {
          set.status = 400
          return {
            error: 'Database creation only supported for postgres services',
          }
        }

        const parsed = createDatabaseRequestSchema.safeParse(body)
        if (!parsed.success) {
          set.status = 400
          return { error: 'Invalid request', details: parsed.error.issues }
        }

        const success = await createDatabase(
          params.id,
          parsed.data.databaseName,
        )
        if (!success) {
          set.status = 500
          return { error: 'Failed to create database' }
        }

        return {
          status: 'created',
          database: parsed.data.databaseName,
          connectionString: `postgres://postgres:postgres@${instance.endpoint}:${instance.ports[0].host}/${parsed.data.databaseName}`,
        }
      })
  )
}
