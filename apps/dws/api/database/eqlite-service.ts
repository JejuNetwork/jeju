import {
  getLocalhostHost,
  getSQLitBlockProducerUrl,
  INFRA_PORTS,
} from '@jejunetwork/config'
import type { Address } from 'viem'
import {
  getServiceByName,
  provisionService,
  type ServiceConfig,
  type ServiceInstance,
} from '../services'

// SQLit service configuration
const SQLIT_SERVICE_NAME = 'sqlit-primary'
const SQLIT_HTTP_PORT = INFRA_PORTS.SQLit.get()

// SQLit service state
let sqlitServiceInstance: ServiceInstance | null = null
let initializationPromise: Promise<ServiceInstance> | null = null

/**
 * Get or initialize the SQLit service
 * Called automatically when DWS starts
 */
export async function ensureSQLitService(): Promise<ServiceInstance> {
  // Return existing if healthy
  if (sqlitServiceInstance?.status === 'running') {
    return sqlitServiceInstance
  }

  // Wait for any in-progress initialization
  if (initializationPromise) {
    return initializationPromise
  }

  // Check if already provisioned
  const existing = getServiceByName('sqlit', SQLIT_SERVICE_NAME)
  if (existing?.status === 'running') {
    sqlitServiceInstance = existing
    return existing
  }

  // Start initialization
  initializationPromise = initializeSQLit()
  const result = await initializationPromise
  initializationPromise = null
  return result
}

/**
 * Initialize SQLit cluster
 */
async function initializeSQLit(): Promise<ServiceInstance> {
  console.log('[SQLit Service] Initializing SQLit as DWS-managed service...')

  const config: ServiceConfig = {
    type: 'sqlit',
    name: SQLIT_SERVICE_NAME,
    version: 'latest',
    resources: {
      cpuCores: 2,
      memoryMb: 1024,
      storageMb: 10240,
    },
    ports: [
      { container: 4661, host: 4661 }, // Client connections
      { container: 8546, host: SQLIT_HTTP_PORT }, // HTTP API
    ],
    env: {
      SQLIT_ROLE: 'blockproducer',
      SQLIT_DATA_DIR: '/data',
      SQLIT_LOG_LEVEL: process.env.SQLIT_LOG_LEVEL ?? 'info',
    },
    volumes: [
      { name: 'sqlit-data', mountPath: '/data' },
      { name: 'sqlit-config', mountPath: '/config' },
    ],
    healthCheck: {
      command: ['curl', '-sf', `${getSQLitBlockProducerUrl()}/v1/status`],
      interval: 10000,
      timeout: 5000,
      retries: 5,
    },
  }

  // DWS owns the SQLit service
  const dwsOwner = '0x0000000000000000000000000000000000000001' as Address

  const instance = await provisionService(config, dwsOwner, 'dws-node')

  if (instance.status !== 'running') {
    throw new Error(`SQLit service failed to start: ${instance.status}`)
  }

  sqlitServiceInstance = instance
  console.log(`[SQLit Service] SQLit running on port ${SQLIT_HTTP_PORT}`)

  return instance
}

/**
 * Get SQLit service endpoint for clients
 */
export function getSQLitEndpoint(): string {
  if (!sqlitServiceInstance) {
    // Return default endpoint - service may not be initialized yet
    return getSQLitBlockProducerUrl()
  }

  const httpPort = sqlitServiceInstance.ports.find((p) => p.container === 8546)
  const localhost = getLocalhostHost()
  return `http://${localhost}:${httpPort?.host ?? SQLIT_HTTP_PORT}`
}

/**
 * Get SQLit service client port for direct connections
 */
export function getSQLitClientPort(): number {
  if (!sqlitServiceInstance) {
    return 4661
  }

  const clientPort = sqlitServiceInstance.ports.find(
    (p) => p.container === 4661,
  )
  return clientPort?.host ?? 4661
}

/**
 * Check if SQLit service is healthy
 */
export async function isSQLitHealthy(): Promise<boolean> {
  const endpoint = getSQLitEndpoint()

  try {
    const response = await fetch(`${endpoint}/v1/status`, {
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Get SQLit service status
 */
export function getSQLitStatus(): {
  running: boolean
  endpoint: string
  clientPort: number
  healthStatus: string
} {
  return {
    running: sqlitServiceInstance?.status === 'running',
    endpoint: getSQLitEndpoint(),
    clientPort: getSQLitClientPort(),
    healthStatus: sqlitServiceInstance?.healthStatus ?? 'unknown',
  }
}

/**
 * Provision a new database for an app
 * This creates an isolated database within SQLit
 */
export async function provisionAppDatabase(params: {
  appName: string
  owner: Address
  schema?: string
}): Promise<{
  databaseId: string
  endpoint: string
  clientPort: number
}> {
  // Ensure SQLit is running
  await ensureSQLitService()

  // Generate unique database ID
  const databaseId = `${params.appName.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`

  // SQLit creates databases on-demand when first accessed
  // Just return the connection info - the provisioning module handles ACL

  return {
    databaseId,
    endpoint: getSQLitEndpoint(),
    clientPort: getSQLitClientPort(),
  }
}

/**
 * Get connection info for a database
 */
export function getDatabaseConnectionInfo(databaseId: string): {
  endpoint: string
  clientPort: number
  databaseId: string
  httpUrl: string
} {
  return {
    endpoint: getSQLitEndpoint(),
    clientPort: getSQLitClientPort(),
    databaseId,
    httpUrl: `${getSQLitEndpoint()}/v1`,
  }
}
