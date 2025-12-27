/**
 * EQLite Service Manager for DWS
 *
 * Manages EQLite as a DWS-native service:
 * - Auto-provisions EQLite cluster on DWS startup
 * - Uses DWS storage for data persistence
 * - Integrates with KMS for encryption
 * - Provides database provisioning API for apps
 *
 * EQLite runs ON DWS, not as a separate deployment.
 */

import { INFRA_PORTS } from '@jejunetwork/config'
import type { Address } from 'viem'
import {
  getServiceByName,
  provisionService,
  type ServiceConfig,
  type ServiceInstance,
} from '../services'

// EQLite service configuration
const EQLITE_SERVICE_NAME = 'eqlite-primary'
const EQLITE_HTTP_PORT = INFRA_PORTS.EQLite.get()

// EQLite service state
let eqliteServiceInstance: ServiceInstance | null = null
let initializationPromise: Promise<ServiceInstance> | null = null

/**
 * Get or initialize the EQLite service
 * Called automatically when DWS starts
 */
export async function ensureEQLiteService(): Promise<ServiceInstance> {
  // Return existing if healthy
  if (eqliteServiceInstance?.status === 'running') {
    return eqliteServiceInstance
  }

  // Wait for any in-progress initialization
  if (initializationPromise) {
    return initializationPromise
  }

  // Check if already provisioned
  const existing = getServiceByName('eqlite', EQLITE_SERVICE_NAME)
  if (existing?.status === 'running') {
    eqliteServiceInstance = existing
    return existing
  }

  // Start initialization
  initializationPromise = initializeEQLite()
  const result = await initializationPromise
  initializationPromise = null
  return result
}

/**
 * Initialize EQLite cluster
 */
async function initializeEQLite(): Promise<ServiceInstance> {
  console.log('[EQLite Service] Initializing EQLite as DWS-managed service...')

  const config: ServiceConfig = {
    type: 'eqlite',
    name: EQLITE_SERVICE_NAME,
    version: 'latest',
    resources: {
      cpuCores: 2,
      memoryMb: 1024,
      storageMb: 10240,
    },
    ports: [
      { container: 4661, host: 4661 }, // Client connections
      { container: 8546, host: EQLITE_HTTP_PORT }, // HTTP API
    ],
    env: {
      EQLITE_ROLE: 'blockproducer',
      EQLITE_DATA_DIR: '/data',
      EQLITE_LOG_LEVEL: process.env.EQLITE_LOG_LEVEL ?? 'info',
    },
    volumes: [
      { name: 'eqlite-data', mountPath: '/data' },
      { name: 'eqlite-config', mountPath: '/config' },
    ],
    healthCheck: {
      command: ['curl', '-sf', 'http://localhost:8546/v1/status'],
      interval: 10000,
      timeout: 5000,
      retries: 5,
    },
  }

  // DWS owns the EQLite service
  const dwsOwner = '0x0000000000000000000000000000000000000001' as Address

  const instance = await provisionService(config, dwsOwner, 'dws-node')

  if (instance.status !== 'running') {
    throw new Error(`EQLite service failed to start: ${instance.status}`)
  }

  eqliteServiceInstance = instance
  console.log(`[EQLite Service] EQLite running on port ${EQLITE_HTTP_PORT}`)

  return instance
}

/**
 * Get EQLite service endpoint for clients
 */
export function getEQLiteEndpoint(): string {
  if (!eqliteServiceInstance) {
    // Return default endpoint - service may not be initialized yet
    return `http://127.0.0.1:${EQLITE_HTTP_PORT}`
  }

  const httpPort = eqliteServiceInstance.ports.find((p) => p.container === 8546)
  return `http://127.0.0.1:${httpPort?.host ?? EQLITE_HTTP_PORT}`
}

/**
 * Get EQLite service client port for direct connections
 */
export function getEQLiteClientPort(): number {
  if (!eqliteServiceInstance) {
    return 4661
  }

  const clientPort = eqliteServiceInstance.ports.find(
    (p) => p.container === 4661,
  )
  return clientPort?.host ?? 4661
}

/**
 * Check if EQLite service is healthy
 */
export async function isEQLiteHealthy(): Promise<boolean> {
  const endpoint = getEQLiteEndpoint()

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
 * Get EQLite service status
 */
export function getEQLiteStatus(): {
  running: boolean
  endpoint: string
  clientPort: number
  healthStatus: string
} {
  return {
    running: eqliteServiceInstance?.status === 'running',
    endpoint: getEQLiteEndpoint(),
    clientPort: getEQLiteClientPort(),
    healthStatus: eqliteServiceInstance?.healthStatus ?? 'unknown',
  }
}

/**
 * Provision a new database for an app
 * This creates an isolated database within EQLite
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
  // Ensure EQLite is running
  await ensureEQLiteService()

  // Generate unique database ID
  const databaseId = `${params.appName.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`

  // EQLite creates databases on-demand when first accessed
  // Just return the connection info - the provisioning module handles ACL

  return {
    databaseId,
    endpoint: getEQLiteEndpoint(),
    clientPort: getEQLiteClientPort(),
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
    endpoint: getEQLiteEndpoint(),
    clientPort: getEQLiteClientPort(),
    databaseId,
    httpUrl: `${getEQLiteEndpoint()}/v1`,
  }
}
