/**
 * Permissionless PostgreSQL Provisioner
 *
 * Provides decentralized Postgres provisioning:
 * - Local: Provisions containers from local OCI (Docker)
 * - Testnet: Provisions via AWS RDS (abstracted through DWS)
 * - Mainnet: Provisions via decentralized node operators
 *
 * All provisioning is permissionless - anyone can request a database.
 * Billing is handled via x402 micropayments or staking.
 */

import {
  getCurrentNetwork,
  getLocalhostHost,
  type NetworkType,
} from '@jejunetwork/config'
import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import type { Address, Hex } from 'viem'
import { verifyMessage } from 'viem'
import { z } from 'zod'

// Types

export interface PostgresInstance {
  instanceId: string
  owner: Address
  name: string
  host: string
  port: number
  database: string
  username: string
  connectionString: string
  status: PostgresStatus
  network: NetworkType
  createdAt: number
  lastHealthCheck: number
  healthStatus: 'healthy' | 'unhealthy' | 'unknown'
  provisionerType: 'docker' | 'aws' | 'operator'
  resources: PostgresResources
}

export interface PostgresResources {
  cpuCores: number
  memoryMb: number
  storageMb: number
  maxConnections: number
  poolSize: number
}

export type PostgresStatus =
  | 'provisioning'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'terminating'
  | 'terminated'

export interface ProvisionRequest {
  name: string
  owner: Address
  signature: Hex
  timestamp: number
  resources?: Partial<PostgresResources>
}

export interface ProvisionResponse {
  instance: PostgresInstance
  credentials: {
    host: string
    port: number
    database: string
    user: string
    password: string
    connectionString: string
    pooledConnectionString?: string
  }
}

// Constants

const META_DATABASE_ID = 'dws-postgres-registry'
const DEFAULT_RESOURCES: PostgresResources = {
  cpuCores: 1,
  memoryMb: 512,
  storageMb: 5120,
  maxConnections: 100,
  poolSize: 20,
}

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000 // 5 minutes

// Registry storage

let sqlitClient: SQLitClient | null = null
const instances = new Map<string, PostgresInstance>()
const credentials = new Map<string, { password: string }>()

async function getSQLitClientCached(): Promise<SQLitClient> {
  if (!sqlitClient) {
    sqlitClient = getSQLit()
    await ensureRegistryTables()
  }
  return sqlitClient
}

async function ensureRegistryTables(): Promise<void> {
  if (!sqlitClient) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS postgres_instances (
      instance_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      database_name TEXT NOT NULL,
      username TEXT NOT NULL,
      connection_string TEXT NOT NULL,
      status TEXT NOT NULL,
      network TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_health_check INTEGER NOT NULL,
      health_status TEXT NOT NULL,
      provisioner_type TEXT NOT NULL,
      resources TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pg_owner ON postgres_instances(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_pg_name ON postgres_instances(name)`,
    `CREATE INDEX IF NOT EXISTS idx_pg_status ON postgres_instances(status)`,
  ]

  for (const sql of tables) {
    await sqlitClient.exec(sql, [], META_DATABASE_ID)
  }
}

async function persistInstance(instance: PostgresInstance): Promise<void> {
  const client = await getSQLitClientCached()
  await client.exec(
    `INSERT OR REPLACE INTO postgres_instances 
     (instance_id, owner, name, host, port, database_name, username, connection_string, 
      status, network, created_at, last_health_check, health_status, provisioner_type, resources)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      instance.instanceId,
      instance.owner.toLowerCase(),
      instance.name,
      instance.host,
      instance.port,
      instance.database,
      instance.username,
      instance.connectionString,
      instance.status,
      instance.network,
      instance.createdAt,
      instance.lastHealthCheck,
      instance.healthStatus,
      instance.provisionerType,
      JSON.stringify(instance.resources),
    ],
    META_DATABASE_ID,
  )
}

// Docker/OCI Provisioner (Local)

async function provisionViaDocker(
  instanceId: string,
  name: string,
  owner: Address,
  resources: PostgresResources,
): Promise<ProvisionResponse> {
  const containerName = `dws-postgres-${name}`
  const password = generatePassword()
  const port = await findAvailablePort(25432, 26000)
  const database = name.replace(/-/g, '_')
  const username = `u_${instanceId.slice(0, 8)}`

  console.log(`[PostgresProvisioner] Provisioning via Docker: ${containerName}`)

  // Check if container already exists
  const checkResult = await Bun.spawn(
    ['docker', 'ps', '-aq', '-f', `name=^${containerName}$`],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const existingId = (await new Response(checkResult.stdout).text()).trim()

  if (existingId) {
    // Start existing container
    console.log(
      `[PostgresProvisioner] Starting existing container: ${containerName}`,
    )
    await Bun.spawn(['docker', 'start', containerName], {
      stdout: 'inherit',
      stderr: 'inherit',
    }).exited
  } else {
    // Create new container from local OCI registry
    const args = [
      'docker',
      'run',
      '-d',
      '--name',
      containerName,
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      `POSTGRES_USER=${username}`,
      '-e',
      `POSTGRES_DB=${database}`,
      '-p',
      `${port}:5432`,
      `--shm-size=${Math.max(256, Math.floor(resources.memoryMb / 4))}m`,
      '--restart',
      'unless-stopped',
      // Use local OCI registry if available, fallback to docker hub
      process.env.LOCAL_OCI_REGISTRY
        ? `${process.env.LOCAL_OCI_REGISTRY}/postgres:16`
        : 'postgres:16',
    ]

    const createResult = await Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe',
    })

    if ((await createResult.exited) !== 0) {
      const stderr = await new Response(createResult.stderr).text()
      throw new Error(`Failed to create container: ${stderr}`)
    }
  }

  // Wait for postgres to be ready
  await waitForPostgres(port, username, password, database)

  const host = getLocalhostHost()
  const connectionString = `postgresql://${username}:${password}@${host}:${port}/${database}`

  const instance: PostgresInstance = {
    instanceId,
    owner,
    name,
    host,
    port,
    database,
    username,
    connectionString,
    status: 'running',
    network: getCurrentNetwork(),
    createdAt: Date.now(),
    lastHealthCheck: Date.now(),
    healthStatus: 'healthy',
    provisionerType: 'docker',
    resources,
  }

  instances.set(instanceId, instance)
  credentials.set(instanceId, { password })
  await persistInstance(instance)

  return {
    instance,
    credentials: {
      host,
      port,
      database,
      user: username,
      password,
      connectionString,
    },
  }
}

// AWS Provisioner (Testnet)

async function provisionViaAWS(
  instanceId: string,
  name: string,
  owner: Address,
  resources: PostgresResources,
): Promise<ProvisionResponse> {
  console.log(`[PostgresProvisioner] Provisioning via AWS: ${name}`)

  const password = generatePassword()
  const database = name.replace(/-/g, '_')
  const username = `u_${instanceId.slice(0, 8)}`

  // For testnet, we use AWS RDS through our provisioner node
  // This is abstracted - the operator running the provisioner handles AWS credentials
  const awsEndpoint =
    process.env.AWS_PROVISIONER_ENDPOINT ??
    'https://provisioner.testnet.jejunetwork.org'

  const response = await fetch(`${awsEndpoint}/rds/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instanceId,
      name,
      owner,
      resources: {
        instanceClass:
          resources.memoryMb >= 2048 ? 'db.t3.small' : 'db.t3.micro',
        allocatedStorage: Math.ceil(resources.storageMb / 1024),
        maxConnections: resources.maxConnections,
      },
      credentials: { username, password, database },
    }),
    signal: AbortSignal.timeout(120000), // RDS provisioning can take a while
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`AWS provisioning failed: ${error}`)
  }

  const awsResult = z
    .object({
      endpoint: z.string(),
      port: z.number(),
    })
    .parse(await response.json())

  const connectionString = `postgresql://${username}:${password}@${awsResult.endpoint}:${awsResult.port}/${database}?sslmode=require`

  const instance: PostgresInstance = {
    instanceId,
    owner,
    name,
    host: awsResult.endpoint,
    port: awsResult.port,
    database,
    username,
    connectionString,
    status: 'running',
    network: getCurrentNetwork(),
    createdAt: Date.now(),
    lastHealthCheck: Date.now(),
    healthStatus: 'healthy',
    provisionerType: 'aws',
    resources,
  }

  instances.set(instanceId, instance)
  credentials.set(instanceId, { password })
  await persistInstance(instance)

  return {
    instance,
    credentials: {
      host: awsResult.endpoint,
      port: awsResult.port,
      database,
      user: username,
      password,
      connectionString,
    },
  }
}

// Operator Provisioner (Mainnet - Decentralized)

async function provisionViaOperator(
  instanceId: string,
  name: string,
  owner: Address,
  resources: PostgresResources,
): Promise<ProvisionResponse> {
  console.log(
    `[PostgresProvisioner] Provisioning via operator network: ${name}`,
  )

  // On mainnet, find an operator that has capacity
  // Operators stake tokens and compete to provide database services
  const operatorEndpoint = await findAvailableOperator(resources)

  if (!operatorEndpoint) {
    throw new Error('No operators available with required capacity')
  }

  const password = generatePassword()
  const database = name.replace(/-/g, '_')
  const username = `u_${instanceId.slice(0, 8)}`

  const response = await fetch(`${operatorEndpoint}/postgres/provision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instanceId,
      name,
      owner,
      resources,
      credentials: { username, password, database },
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Operator provisioning failed: ${error}`)
  }

  const operatorResult = z
    .object({
      host: z.string(),
      port: z.number(),
    })
    .parse(await response.json())

  const connectionString = `postgresql://${username}:${password}@${operatorResult.host}:${operatorResult.port}/${database}?sslmode=require`

  const instance: PostgresInstance = {
    instanceId,
    owner,
    name,
    host: operatorResult.host,
    port: operatorResult.port,
    database,
    username,
    connectionString,
    status: 'running',
    network: getCurrentNetwork(),
    createdAt: Date.now(),
    lastHealthCheck: Date.now(),
    healthStatus: 'healthy',
    provisionerType: 'operator',
    resources,
  }

  instances.set(instanceId, instance)
  credentials.set(instanceId, { password })
  await persistInstance(instance)

  return {
    instance,
    credentials: {
      host: operatorResult.host,
      port: operatorResult.port,
      database,
      user: username,
      password,
      connectionString,
    },
  }
}

// Main provisioning function

export async function provisionPostgres(
  request: ProvisionRequest,
): Promise<ProvisionResponse> {
  // Verify signature
  const message = JSON.stringify({
    name: request.name,
    owner: request.owner,
    timestamp: request.timestamp,
  })

  const isValid = await verifyMessage({
    address: request.owner,
    message,
    signature: request.signature,
  })

  if (!isValid) {
    throw new Error('Invalid signature')
  }

  // Check timestamp
  if (Math.abs(Date.now() - request.timestamp) > SIGNATURE_MAX_AGE_MS) {
    throw new Error('Request expired')
  }

  const instanceId = `pg-${crypto.randomUUID().slice(0, 12)}`
  const resources = { ...DEFAULT_RESOURCES, ...request.resources }
  const network = getCurrentNetwork()

  console.log(
    `[PostgresProvisioner] Provisioning for ${request.name} on ${network}`,
  )

  // Route to appropriate provisioner based on network
  switch (network) {
    case 'localnet':
      return provisionViaDocker(
        instanceId,
        request.name,
        request.owner,
        resources,
      )
    case 'testnet':
      // Try AWS first, fallback to Docker
      try {
        return await provisionViaAWS(
          instanceId,
          request.name,
          request.owner,
          resources,
        )
      } catch (error) {
        console.warn(
          `[PostgresProvisioner] AWS failed, falling back to Docker: ${error}`,
        )
        return provisionViaDocker(
          instanceId,
          request.name,
          request.owner,
          resources,
        )
      }
    case 'mainnet':
      return provisionViaOperator(
        instanceId,
        request.name,
        request.owner,
        resources,
      )
    default:
      throw new Error(`Unknown network: ${network}`)
  }
}

// Get existing instance by name and owner

export async function getInstance(
  name: string,
  owner: Address,
): Promise<PostgresInstance | null> {
  // Check memory cache first
  for (const instance of instances.values()) {
    if (
      instance.name === name &&
      instance.owner.toLowerCase() === owner.toLowerCase()
    ) {
      return instance
    }
  }

  // Check persistent storage
  const client = await getSQLitClientCached()
  const result = await client.query<{
    instance_id: string
    owner: string
    name: string
    host: string
    port: number
    database_name: string
    username: string
    connection_string: string
    status: string
    network: string
    created_at: number
    last_health_check: number
    health_status: string
    provisioner_type: string
    resources: string
  }>(
    'SELECT * FROM postgres_instances WHERE name = ? AND owner = ? AND status != ?',
    [name, owner.toLowerCase(), 'terminated'],
    META_DATABASE_ID,
  )

  if (result.rows.length === 0) {
    return null
  }

  const row = result.rows[0]
  const instance: PostgresInstance = {
    instanceId: row.instance_id,
    owner: row.owner as Address,
    name: row.name,
    host: row.host,
    port: row.port,
    database: row.database_name,
    username: row.username,
    connectionString: row.connection_string,
    status: row.status as PostgresStatus,
    network: row.network as NetworkType,
    createdAt: row.created_at,
    lastHealthCheck: row.last_health_check,
    healthStatus: row.health_status as 'healthy' | 'unhealthy' | 'unknown',
    provisionerType: row.provisioner_type as 'docker' | 'aws' | 'operator',
    resources: JSON.parse(row.resources) as PostgresResources,
  }

  instances.set(instance.instanceId, instance)
  return instance
}

// Terminate an instance

export async function terminatePostgres(
  instanceId: string,
  owner: Address,
  signature: Hex,
  timestamp: number,
): Promise<void> {
  const instance = instances.get(instanceId)
  if (!instance) {
    throw new Error('Instance not found')
  }

  if (instance.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Not authorized')
  }

  // Verify signature
  const message = JSON.stringify({ instanceId, owner, timestamp })
  const isValid = await verifyMessage({ address: owner, message, signature })
  if (!isValid) {
    throw new Error('Invalid signature')
  }

  console.log(`[PostgresProvisioner] Terminating ${instanceId}`)
  instance.status = 'terminating'
  await persistInstance(instance)

  // Handle termination based on provisioner type
  if (instance.provisionerType === 'docker') {
    const containerName = `dws-postgres-${instance.name}`
    await Bun.spawn(['docker', 'rm', '-f', containerName], {
      stdout: 'ignore',
      stderr: 'ignore',
    }).exited
  } else if (instance.provisionerType === 'aws') {
    const awsEndpoint =
      process.env.AWS_PROVISIONER_ENDPOINT ??
      'https://provisioner.testnet.jejunetwork.org'
    await fetch(`${awsEndpoint}/rds/terminate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId }),
    })
  }

  instance.status = 'terminated'
  await persistInstance(instance)
  instances.delete(instanceId)
}

// Health check

export async function checkHealth(
  instanceId: string,
): Promise<'healthy' | 'unhealthy'> {
  const instance = instances.get(instanceId)
  if (!instance) {
    return 'unhealthy'
  }

  const creds = credentials.get(instanceId)
  if (!creds) {
    return 'unhealthy'
  }

  const isHealthy = await checkPostgresConnection(
    instance.host,
    instance.port,
    instance.username,
    creds.password,
    instance.database,
  )

  instance.lastHealthCheck = Date.now()
  instance.healthStatus = isHealthy ? 'healthy' : 'unhealthy'
  await persistInstance(instance)

  return instance.healthStatus
}

// Helper functions

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let password = ''
  const randomBytes = crypto.getRandomValues(new Uint8Array(32))
  for (let i = 0; i < 32; i++) {
    password += chars[randomBytes[i] % chars.length]
  }
  return password
}

async function findAvailablePort(start: number, end: number): Promise<number> {
  for (let port = start; port <= end; port++) {
    try {
      const server = Bun.serve({
        port,
        fetch: () => new Response(''),
      })
      server.stop()
      return port
    } catch {}
  }
  throw new Error('No available ports')
}

async function waitForPostgres(
  port: number,
  username: string,
  password: string,
  database: string,
  timeoutMs = 30000,
): Promise<void> {
  const host = getLocalhostHost()
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    const isReady = await checkPostgresConnection(
      host,
      port,
      username,
      password,
      database,
    )
    if (isReady) {
      return
    }
    await new Promise((r) => setTimeout(r, 1000))
  }

  throw new Error('Postgres did not become ready in time')
}

async function checkPostgresConnection(
  host: string,
  port: number,
  username: string,
  _password: string,
  database: string,
): Promise<boolean> {
  try {
    // Use pg_isready via docker exec for docker containers, or TCP check for remote
    if (host === '127.0.0.1' || host === 'localhost') {
      const result = await Bun.spawn(
        [
          'docker',
          'run',
          '--rm',
          '--network=host',
          'postgres:16',
          'pg_isready',
          '-h',
          host,
          '-p',
          String(port),
          '-U',
          username,
          '-d',
          database,
        ],
        { stdout: 'ignore', stderr: 'ignore' },
      )
      return (await result.exited) === 0
    }

    // For remote hosts, try a TCP connection using net module
    return new Promise((resolve) => {
      const net = require('node:net')
      const socket = new net.Socket()
      socket.setTimeout(5000)
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })
      socket.on('error', () => {
        socket.destroy()
        resolve(false)
      })
      socket.connect(port, host)
    })
  } catch {
    return false
  }
}

async function findAvailableOperator(
  _resources: PostgresResources,
): Promise<string | null> {
  // Query on-chain operator registry for available database operators
  // This would use the SQLitRegistry contract to find staked operators
  // For now, return null to indicate no operators available
  // TODO: Implement operator discovery from on-chain registry
  return null
}
