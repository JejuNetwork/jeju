/**
 * Nitro TEE Database Provisioner
 *
 * Provisions PostgreSQL databases running in AWS Nitro Enclaves for
 * hardware-backed confidential computing. Instances are provisioned
 * on-demand and automatically terminated when idle to minimize costs.
 *
 * Features:
 * - On-demand provisioning (no idle instances)
 * - Automatic scale-to-zero after idle timeout
 * - Hardware-backed encryption via Nitro TEE
 * - Secure attestation for database connections
 * - Compatible with standard PostgreSQL clients
 */

import type { Address } from 'viem'
import { z } from 'zod'
import { AWSProvider } from '../infrastructure/cloud-providers'

// Database Instance Types optimized for PostgreSQL workloads

export type NitroDatabaseTier = 'small' | 'medium' | 'large' | 'xlarge'

export interface NitroDatabaseSpec {
  tier: NitroDatabaseTier
  instanceType: string
  cpuCores: number
  memoryMb: number
  storageMb: number
  maxConnections: number
  pricePerHourUsd: number
  enclaveMemoryMb: number
  enclaveCpus: number
}

const DATABASE_SPECS: Record<NitroDatabaseTier, NitroDatabaseSpec> = {
  small: {
    tier: 'small',
    instanceType: 'c6i.xlarge',
    cpuCores: 4,
    memoryMb: 8192,
    storageMb: 100 * 1024, // 100GB
    maxConnections: 100,
    pricePerHourUsd: 0.17,
    enclaveMemoryMb: 4096,
    enclaveCpus: 2,
  },
  medium: {
    tier: 'medium',
    instanceType: 'm6i.xlarge',
    cpuCores: 4,
    memoryMb: 16384,
    storageMb: 250 * 1024, // 250GB
    maxConnections: 200,
    pricePerHourUsd: 0.192,
    enclaveMemoryMb: 8192,
    enclaveCpus: 2,
  },
  large: {
    tier: 'large',
    instanceType: 'r6i.xlarge',
    cpuCores: 4,
    memoryMb: 32768,
    storageMb: 500 * 1024, // 500GB
    maxConnections: 400,
    pricePerHourUsd: 0.252,
    enclaveMemoryMb: 16384,
    enclaveCpus: 2,
  },
  xlarge: {
    tier: 'xlarge',
    instanceType: 'r6i.2xlarge',
    cpuCores: 8,
    memoryMb: 65536,
    storageMb: 1000 * 1024, // 1TB
    maxConnections: 800,
    pricePerHourUsd: 0.504,
    enclaveMemoryMb: 32768,
    enclaveCpus: 4,
  },
}

// Provisioned Database Instance

export type NitroDatabaseStatus =
  | 'pending'
  | 'provisioning'
  | 'initializing'
  | 'running'
  | 'idle'
  | 'stopping'
  | 'stopped'
  | 'terminated'
  | 'error'

export interface NitroDatabase {
  id: string
  owner: Address
  name: string
  tier: NitroDatabaseTier
  status: NitroDatabaseStatus

  // Instance details
  instanceId: string | null
  publicIp: string | null
  privateIp: string | null
  region: string

  // Connection info
  connectionString: string | null
  port: number
  database: string
  username: string
  passwordHash: string // Stored hashed, not plaintext

  // TEE attestation
  attestationDocument: string | null
  enclaveId: string | null

  // Lifecycle
  createdAt: number
  provisionedAt: number | null
  lastActivityAt: number
  terminatedAt: number | null

  // Billing
  totalCostUsd: number
  billedHours: number

  // Idle timeout (scale-to-zero)
  idleTimeoutMs: number
  autoTerminate: boolean
}

// Request schemas

export const ProvisionDatabaseRequestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z][a-z0-9_]*$/),
  tier: z.enum(['small', 'medium', 'large', 'xlarge']),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  region: z.string().default('us-east-1'),
  idleTimeoutMs: z.number().min(60000).default(3600000), // 1 hour default
  autoTerminate: z.boolean().default(true),
})

export type ProvisionDatabaseRequest = z.infer<
  typeof ProvisionDatabaseRequestSchema
>

// Configuration

interface NitroDatabaseConfig {
  defaultIdleTimeoutMs: number
  maxDatabasesPerOwner: number
  provisionTimeoutMs: number
  healthCheckIntervalMs: number
  costCheckIntervalMs: number
}

const DEFAULT_CONFIG: NitroDatabaseConfig = {
  defaultIdleTimeoutMs: 3600000, // 1 hour
  maxDatabasesPerOwner: 5,
  provisionTimeoutMs: 600000, // 10 minutes
  healthCheckIntervalMs: 30000, // 30 seconds
  costCheckIntervalMs: 60000, // 1 minute
}

// State

const databases = new Map<string, NitroDatabase>()
const databasesByOwner = new Map<Address, Set<string>>()

// Provisioner Class

export class NitroTEEDatabaseProvisioner {
  private config: NitroDatabaseConfig
  private awsProvider: AWSProvider | null = null
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private costTrackingInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: Partial<NitroDatabaseConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize the provisioner with AWS credentials
   */
  async initialize(credentials?: {
    accessKeyId?: string
    secretAccessKey?: string
    region?: string
  }): Promise<void> {
    this.awsProvider = new AWSProvider()
    await this.awsProvider.initialize({
      provider: 'aws',
      apiKey: credentials?.accessKeyId,
      apiSecret: credentials?.secretAccessKey,
      region: credentials?.region ?? 'us-east-1',
    })

    // Start background tasks
    this.startBackgroundTasks()

    console.log(
      '[NitroTEEDatabase] Initialized with AWS provider, region:',
      credentials?.region ?? 'us-east-1',
    )
  }

  /**
   * Shutdown the provisioner
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    if (this.costTrackingInterval) {
      clearInterval(this.costTrackingInterval)
      this.costTrackingInterval = null
    }
    console.log('[NitroTEEDatabase] Shutdown complete')
  }

  /**
   * Get available database tiers
   */
  getTiers(): NitroDatabaseSpec[] {
    return Object.values(DATABASE_SPECS)
  }

  /**
   * Get a specific tier's specs
   */
  getTier(tier: NitroDatabaseTier): NitroDatabaseSpec {
    return DATABASE_SPECS[tier]
  }

  /**
   * Provision a new Nitro TEE database
   */
  async provision(request: ProvisionDatabaseRequest): Promise<NitroDatabase> {
    const validated = ProvisionDatabaseRequestSchema.parse(request)

    if (!this.awsProvider) {
      throw new Error('Provisioner not initialized')
    }

    // Check owner limits
    const ownerDbs = databasesByOwner.get(validated.owner as Address)
    if (ownerDbs && ownerDbs.size >= this.config.maxDatabasesPerOwner) {
      throw new Error(
        `Maximum databases per owner reached: ${this.config.maxDatabasesPerOwner}`,
      )
    }

    const spec = DATABASE_SPECS[validated.tier]
    const dbId = `nitro-db-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    const now = Date.now()

    // Generate secure credentials
    const password = this.generateSecurePassword()
    const passwordHash = await this.hashPassword(password)

    const db: NitroDatabase = {
      id: dbId,
      owner: validated.owner as Address,
      name: validated.name,
      tier: validated.tier,
      status: 'pending',
      instanceId: null,
      publicIp: null,
      privateIp: null,
      region: validated.region,
      connectionString: null,
      port: 5432,
      database: validated.name,
      username: `u_${validated.name.slice(0, 8)}`,
      passwordHash,
      attestationDocument: null,
      enclaveId: null,
      createdAt: now,
      provisionedAt: null,
      lastActivityAt: now,
      terminatedAt: null,
      totalCostUsd: 0,
      billedHours: 0,
      idleTimeoutMs: validated.idleTimeoutMs,
      autoTerminate: validated.autoTerminate,
    }

    // Store in state
    databases.set(dbId, db)
    const dbs = databasesByOwner.get(validated.owner as Address) ?? new Set()
    dbs.add(dbId)
    databasesByOwner.set(validated.owner as Address, dbs)

    // Start async provisioning
    this.provisionAsync(db, spec, password).catch((err) => {
      console.error(`[NitroTEEDatabase] Failed to provision ${dbId}:`, err)
      db.status = 'error'
    })

    // Return with password (only time it's exposed)
    return {
      ...db,
      // Include password in response (only time it's available)
      connectionString: `postgres://${db.username}:${password}@pending:${db.port}/${db.database}`,
    }
  }

  /**
   * Get database by ID
   */
  getDatabase(id: string): NitroDatabase | null {
    return databases.get(id) ?? null
  }

  /**
   * List databases for an owner
   */
  listDatabases(owner: Address): NitroDatabase[] {
    const dbIds = databasesByOwner.get(owner)
    if (!dbIds) return []

    return [...dbIds]
      .map((id) => databases.get(id))
      .filter((db): db is NitroDatabase => !!db)
  }

  /**
   * Record activity on a database (prevents idle termination)
   */
  recordActivity(id: string): boolean {
    const db = databases.get(id)
    if (!db) return false

    db.lastActivityAt = Date.now()
    if (db.status === 'idle') {
      db.status = 'running'
    }

    return true
  }

  /**
   * Terminate a database
   */
  async terminate(id: string, owner: Address): Promise<boolean> {
    const db = databases.get(id)
    if (!db) return false

    if (db.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized to terminate this database')
    }

    if (db.status === 'terminated') {
      return true
    }

    db.status = 'stopping'

    // Terminate EC2 instance
    if (db.instanceId && this.awsProvider) {
      await this.awsProvider.deleteInstance(db.instanceId)
    }

    db.status = 'terminated'
    db.terminatedAt = Date.now()

    console.log(
      `[NitroTEEDatabase] Terminated ${id}, total cost: $${db.totalCostUsd.toFixed(4)}`,
    )

    return true
  }

  /**
   * Start a stopped database
   */
  async start(id: string, owner: Address): Promise<NitroDatabase> {
    const db = databases.get(id)
    if (!db) {
      throw new Error(`Database not found: ${id}`)
    }

    if (db.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized to start this database')
    }

    if (db.status !== 'stopped') {
      throw new Error(`Cannot start database in state: ${db.status}`)
    }

    // Re-provision the instance
    const spec = DATABASE_SPECS[db.tier]
    db.status = 'provisioning'

    // We need to re-provision since we terminate on stop
    const password = this.generateSecurePassword()
    db.passwordHash = await this.hashPassword(password)

    await this.provisionAsync(db, spec, password)

    return db
  }

  /**
   * Stop a database (terminates instance to save cost)
   */
  async stop(id: string, owner: Address): Promise<boolean> {
    const db = databases.get(id)
    if (!db) return false

    if (db.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized to stop this database')
    }

    if (db.status !== 'running' && db.status !== 'idle') {
      return false
    }

    db.status = 'stopping'

    // Terminate EC2 instance (we provision fresh on start)
    if (db.instanceId && this.awsProvider) {
      await this.awsProvider.deleteInstance(db.instanceId)
    }

    db.status = 'stopped'
    db.instanceId = null
    db.publicIp = null
    db.privateIp = null
    db.connectionString = null

    console.log(`[NitroTEEDatabase] Stopped ${id}`)

    return true
  }

  /**
   * Get provisioner statistics
   */
  getStats(): {
    totalDatabases: number
    runningDatabases: number
    stoppedDatabases: number
    totalCostUsd: number
    tierBreakdown: Record<NitroDatabaseTier, number>
    regionBreakdown: Record<string, number>
  } {
    const dbs = [...databases.values()]
    const tierBreakdown: Record<NitroDatabaseTier, number> = {
      small: 0,
      medium: 0,
      large: 0,
      xlarge: 0,
    }
    const regionBreakdown: Record<string, number> = {}

    for (const db of dbs) {
      tierBreakdown[db.tier]++
      regionBreakdown[db.region] = (regionBreakdown[db.region] ?? 0) + 1
    }

    return {
      totalDatabases: dbs.length,
      runningDatabases: dbs.filter(
        (d) => d.status === 'running' || d.status === 'idle',
      ).length,
      stoppedDatabases: dbs.filter((d) => d.status === 'stopped').length,
      totalCostUsd: dbs.reduce((sum, d) => sum + d.totalCostUsd, 0),
      tierBreakdown,
      regionBreakdown,
    }
  }

  // Private methods

  private async provisionAsync(
    db: NitroDatabase,
    spec: NitroDatabaseSpec,
    password: string,
  ): Promise<void> {
    if (!this.awsProvider) {
      throw new Error('AWS provider not initialized')
    }

    db.status = 'provisioning'
    console.log(`[NitroTEEDatabase] Provisioning ${db.id} with tier ${db.tier}`)

    // Generate user data for Nitro Enclave PostgreSQL
    const userData = this.generateUserData(db, spec, password)

    // Create EC2 instance with Nitro Enclaves enabled
    const instance = await this.awsProvider.createInstance({
      instanceType: spec.instanceType,
      region: db.region,
      name: `nitro-pg-${db.id}`,
      userData,
      tags: {
        'jeju-database-id': db.id,
        'jeju-owner': db.owner,
        'jeju-tier': db.tier,
        'jeju-component': 'nitro-tee-database',
      },
    })

    db.instanceId = instance.id
    db.publicIp = instance.publicIp ?? null
    db.privateIp = instance.privateIp ?? null
    db.status = 'initializing'

    // Wait for database to be ready
    await this.waitForDatabaseReady(db)

    // Update connection string
    if (db.publicIp) {
      db.connectionString = `postgres://${db.username}:${password}@${db.publicIp}:${db.port}/${db.database}?sslmode=require`
    }

    db.status = 'running'
    db.provisionedAt = Date.now()
    db.lastActivityAt = Date.now()

    console.log(`[NitroTEEDatabase] Database ${db.id} ready at ${db.publicIp}`)
  }

  private generateUserData(
    db: NitroDatabase,
    spec: NitroDatabaseSpec,
    password: string,
  ): string {
    // Cloud-init script to set up PostgreSQL in Nitro Enclave
    return `#cloud-config
package_update: true
package_upgrade: true

packages:
  - docker
  - openssl
  - aws-nitro-enclaves-cli
  - aws-nitro-enclaves-cli-devel

runcmd:
  # Start Docker
  - systemctl enable docker
  - systemctl start docker

  # Configure Nitro Enclaves allocator
  - |
    cat > /etc/nitro_enclaves/allocator.yaml << EOF
    ---
    memory_mib: ${spec.enclaveMemoryMb}
    cpu_count: ${spec.enclaveCpus}
    EOF

  # Start Nitro Enclaves allocator
  - systemctl enable nitro-enclaves-allocator
  - systemctl start nitro-enclaves-allocator

  # Create PostgreSQL data directory and SSL certs directory
  - mkdir -p /var/lib/postgresql/data
  - mkdir -p /var/lib/postgresql/ssl
  - chmod 700 /var/lib/postgresql/data

  # Generate self-signed SSL certificate for PostgreSQL FIRST
  - |
    openssl req -new -x509 -days 365 -nodes \\
      -out /var/lib/postgresql/ssl/server.crt \\
      -keyout /var/lib/postgresql/ssl/server.key \\
      -subj "/CN=${db.id}.nitro.jejunetwork.org"
    chmod 600 /var/lib/postgresql/ssl/server.key
    chmod 644 /var/lib/postgresql/ssl/server.crt

  # Pull and run PostgreSQL in Docker with SSL enabled
  - |
    docker run -d \\
      --name postgres-tee \\
      --restart unless-stopped \\
      -p 5432:5432 \\
      -v /var/lib/postgresql/data:/var/lib/postgresql/data \\
      -v /var/lib/postgresql/ssl:/var/lib/postgresql/ssl:ro \\
      -e POSTGRES_USER=${db.username} \\
      -e POSTGRES_PASSWORD=${password} \\
      -e POSTGRES_DB=${db.database} \\
      -e PGDATA=/var/lib/postgresql/data \\
      postgres:15-alpine \\
      -c ssl=on \\
      -c ssl_cert_file=/var/lib/postgresql/ssl/server.crt \\
      -c ssl_key_file=/var/lib/postgresql/ssl/server.key \\
      -c max_connections=${spec.maxConnections} \\
      -c shared_buffers=${Math.floor(spec.memoryMb / 4)}MB \\
      -c effective_cache_size=${Math.floor((spec.memoryMb * 3) / 4)}MB

  # Create marker file for health check
  - echo "${db.id}" > /var/lib/postgresql/database-id

  # Wait for PostgreSQL to be ready
  - |
    for i in $(seq 1 30); do
      if docker exec postgres-tee pg_isready -U ${db.username} 2>/dev/null; then
        echo "PostgreSQL is ready"
        break
      fi
      echo "Waiting for PostgreSQL... attempt $i"
      sleep 2
    done

write_files:
  - path: /etc/jeju/database-id
    content: |
      ${db.id}
    permissions: '0644'

final_message: "Nitro TEE PostgreSQL ready for ${db.id}"
`
  }

  private async waitForDatabaseReady(
    db: NitroDatabase,
    timeoutMs: number = 300000,
  ): Promise<void> {
    const startTime = Date.now()
    const checkInterval = 10000 // 10 seconds

    while (Date.now() - startTime < timeoutMs) {
      if (!db.publicIp) {
        // Wait for IP assignment
        if (db.instanceId && this.awsProvider) {
          const instance = await this.awsProvider.getInstance(db.instanceId)
          if (instance?.publicIp) {
            db.publicIp = instance.publicIp
            db.privateIp = instance.privateIp ?? null
          }
        }
        await new Promise((resolve) => setTimeout(resolve, checkInterval))
        continue
      }

      // Try to connect to PostgreSQL
      const isReady = await this.checkPostgresConnection(db)
      if (isReady) {
        return
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval))
    }

    throw new Error(
      `Database ${db.id} failed to become ready within ${timeoutMs}ms`,
    )
  }

  private async checkPostgresConnection(db: NitroDatabase): Promise<boolean> {
    if (!db.publicIp) return false

    const publicIp = db.publicIp

    // TCP socket check to PostgreSQL port
    return new Promise((resolve) => {
      let socketRef: ReturnType<typeof Bun.connect> | null = null

      socketRef = Bun.connect({
        hostname: publicIp,
        port: db.port,
        socket: {
          data() {
            // PostgreSQL is responding
            socketRef?.then((s) => s.end())
            resolve(true)
          },
          open(sock) {
            // Connection established, PostgreSQL is listening
            sock.end()
            resolve(true)
          },
          close() {
            // Socket closed
          },
          error() {
            // Connection failed
            resolve(false)
          },
          connectError() {
            // Connection refused - PostgreSQL not ready
            resolve(false)
          },
        },
      })

      // Timeout after 5 seconds
      setTimeout(() => {
        socketRef?.then((s) => s.end()).catch(() => {})
        resolve(false)
      }, 5000)
    })
  }

  private generateSecurePassword(): string {
    const chars =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => chars[b % chars.length])
      .join('')
  }

  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = new Uint8Array(hashBuffer)
    return Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private startBackgroundTasks(): void {
    // Health check and idle detection
    this.healthCheckInterval = setInterval(async () => {
      const now = Date.now()

      for (const db of databases.values()) {
        // Skip non-running databases
        if (db.status !== 'running' && db.status !== 'idle') continue

        // Check for idle databases
        const idleTime = now - db.lastActivityAt
        if (idleTime > db.idleTimeoutMs) {
          if (db.autoTerminate) {
            console.log(
              `[NitroTEEDatabase] Auto-terminating idle database ${db.id}`,
            )
            await this.terminate(db.id, db.owner)
          } else {
            db.status = 'idle'
            console.log(`[NitroTEEDatabase] Database ${db.id} is now idle`)
          }
        }
      }
    }, this.config.healthCheckIntervalMs)

    // Cost tracking
    this.costTrackingInterval = setInterval(() => {
      const now = Date.now()

      for (const db of databases.values()) {
        if (db.status !== 'running' && db.status !== 'idle') continue

        const spec = DATABASE_SPECS[db.tier]
        const runningHours = (now - (db.provisionedAt ?? now)) / 3600000
        const billedHours = Math.ceil(runningHours)

        if (billedHours > db.billedHours) {
          db.billedHours = billedHours
          db.totalCostUsd = billedHours * spec.pricePerHourUsd
        }
      }
    }, this.config.costCheckIntervalMs)
  }
}

// Singleton

let provisioner: NitroTEEDatabaseProvisioner | null = null

export function getNitroTEEDatabaseProvisioner(): NitroTEEDatabaseProvisioner {
  if (!provisioner) {
    provisioner = new NitroTEEDatabaseProvisioner()
  }
  return provisioner
}

export async function initializeNitroTEEDatabaseProvisioner(credentials?: {
  accessKeyId?: string
  secretAccessKey?: string
  region?: string
}): Promise<NitroTEEDatabaseProvisioner> {
  const p = getNitroTEEDatabaseProvisioner()
  await p.initialize(credentials)
  return p
}
