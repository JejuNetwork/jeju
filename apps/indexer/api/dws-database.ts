/**
 * DWS Database Connector
 *
 * Handles database provisioning and connectivity via DWS for the indexer.
 * Supports:
 * - Automatic provisioning on first run
 * - Connection pooling
 * - Health monitoring
 * - Reconnection on failure
 */

import { getCurrentNetwork, getDWSUrl } from '@jejunetwork/config'
import { privateKeyToAccount, signMessage } from 'viem/accounts'
import { z } from 'zod'

// Response schemas
const ProvisionResponseSchema = z.object({
  success: z.boolean(),
  instance: z.object({
    instanceId: z.string(),
    name: z.string(),
    host: z.string(),
    port: z.number(),
    database: z.string(),
    username: z.string(),
    status: z.string(),
  }),
  credentials: z.object({
    host: z.string(),
    port: z.number(),
    database: z.string(),
    user: z.string(),
    password: z.string(),
    connectionString: z.string(),
    pooledConnectionString: z.string().optional(),
  }),
})

const InstanceResponseSchema = z.object({
  instance: z
    .object({
      instanceId: z.string(),
      name: z.string(),
      host: z.string(),
      port: z.number(),
      database: z.string(),
      username: z.string(),
      connectionString: z.string(),
      status: z.string(),
    })
    .nullable(),
  error: z.string().optional(),
})

export interface DatabaseCredentials {
  host: string
  port: number
  database: string
  user: string
  password: string
  connectionString: string
}

let cachedCredentials: DatabaseCredentials | null = null

/**
 * Get or provision database credentials via DWS
 */
export async function getDatabaseCredentials(): Promise<DatabaseCredentials> {
  if (cachedCredentials) {
    return cachedCredentials
  }

  const dwsUrl = getDWSUrl()

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error(
      'DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required for DWS database provisioning',
    )
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const network = getCurrentNetwork()
  const instanceName = `indexer-${network}`

  console.log(`[DWSDatabase] Checking for existing instance: ${instanceName}`)

  // Check if we already have a provisioned database
  const existingResponse = await fetch(
    `${dwsUrl}/database/postgres/${instanceName}`,
    {
      headers: {
        'x-wallet-address': account.address,
      },
    },
  )

  if (existingResponse.ok) {
    const existingData = await existingResponse.json()
    const parsed = InstanceResponseSchema.safeParse(existingData)

    if (
      parsed.success &&
      parsed.data.instance &&
      parsed.data.instance.status === 'running'
    ) {
      console.log(
        `[DWSDatabase] Found existing instance: ${parsed.data.instance.instanceId}`,
      )

      // We need to get credentials for existing instance
      // For now, return the connection string parsed
      const connStr = parsed.data.instance.connectionString
      const url = new URL(connStr.replace('postgresql://', 'http://'))
      const [user, pass] = `${url.username}:${url.password}`.split(':')

      cachedCredentials = {
        host: parsed.data.instance.host,
        port: parsed.data.instance.port,
        database: parsed.data.instance.database,
        user,
        password: pass,
        connectionString: connStr,
      }
      return cachedCredentials
    }
  }

  // Need to provision a new database
  console.log(`[DWSDatabase] Provisioning new database: ${instanceName}`)

  const timestamp = Date.now()
  const message = JSON.stringify({
    name: instanceName,
    owner: account.address,
    timestamp,
  })
  const signature = await signMessage({
    message,
    privateKey: privateKey as `0x${string}`,
  })

  const provisionResponse = await fetch(
    `${dwsUrl}/database/postgres/provision`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: instanceName,
        owner: account.address,
        signature,
        timestamp,
        resources: {
          cpuCores: 2,
          memoryMb: 2048,
          storageMb: 10240,
          maxConnections: 100,
          poolSize: 20,
        },
      }),
    },
  )

  if (!provisionResponse.ok) {
    const error = await provisionResponse.text()
    throw new Error(`Failed to provision database: ${error}`)
  }

  const provisionData = ProvisionResponseSchema.parse(
    await provisionResponse.json(),
  )

  console.log(
    `[DWSDatabase] Database provisioned: ${provisionData.instance.instanceId}`,
  )
  console.log(
    `[DWSDatabase] Host: ${provisionData.credentials.host}:${provisionData.credentials.port}`,
  )

  cachedCredentials = {
    host: provisionData.credentials.host,
    port: provisionData.credentials.port,
    database: provisionData.credentials.database,
    user: provisionData.credentials.user,
    password: provisionData.credentials.password,
    connectionString: provisionData.credentials.connectionString,
  }

  return cachedCredentials
}

/**
 * Update config with DWS-provisioned database credentials
 */
export async function configureDWSDatabase(): Promise<void> {
  const creds = await getDatabaseCredentials()

  // Import and update config
  const { configureIndexer } = await import('./config')
  configureIndexer({
    dbHost: creds.host,
    dbPort: creds.port,
    dbName: creds.database,
    dbUser: creds.user,
    dbPass: creds.password,
  })

  console.log(
    `[DWSDatabase] Config updated with DWS database: ${creds.host}:${creds.port}/${creds.database}`,
  )
}

/**
 * Check database health via DWS
 */
export async function checkDatabaseHealth(
  instanceId: string,
): Promise<boolean> {
  const dwsUrl = getDWSUrl()
  const response = await fetch(
    `${dwsUrl}/database/postgres/${instanceId}/health`,
  )

  if (!response.ok) {
    return false
  }

  const data = z.object({ status: z.string() }).parse(await response.json())
  return data.status === 'healthy'
}
