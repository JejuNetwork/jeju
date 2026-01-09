/**
 * Nitro TEE Database Routes
 *
 * API endpoints for provisioning and managing PostgreSQL databases
 * running in AWS Nitro Enclaves for confidential computing.
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import {
  getNitroTEEDatabaseProvisioner,
  initializeNitroTEEDatabaseProvisioner,
  type NitroDatabaseTier,
} from '../../compute/nitro-tee-database'

// Lazy initialization state
let initialized = false
let initError: string | null = null

async function ensureInitialized(): Promise<void> {
  if (initialized) return
  if (initError) {
    throw new Error(initError)
  }

  // Check for required AWS credentials
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    initError =
      'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.'
    throw new Error(initError)
  }

  // Initialize with credentials from environment
  await initializeNitroTEEDatabaseProvisioner({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION ?? 'us-east-1',
  })

  initialized = true
}

export function createNitroDatabaseRouter() {
  return (
    new Elysia({ prefix: '/nitro-database' })
      .get('/health', async ({ set }) => {
        const awsConfigured = !!(
          process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        )

        if (!awsConfigured) {
          set.status = 503
          return {
            service: 'nitro-tee-database',
            status: 'unavailable' as const,
            initialized: false,
            error:
              'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.',
            region: process.env.AWS_REGION ?? 'us-east-1',
          }
        }

        await ensureInitialized()
        const provisioner = getNitroTEEDatabaseProvisioner()
        const stats = provisioner.getStats()

        return {
          service: 'nitro-tee-database',
          status: 'healthy' as const,
          initialized: true,
          region: process.env.AWS_REGION ?? 'us-east-1',
          ...stats,
        }
      })

      // List available tiers
      .get('/tiers', async () => {
        await ensureInitialized()
        const provisioner = getNitroTEEDatabaseProvisioner()

        return {
          tiers: provisioner.getTiers(),
          features: [
            'Hardware-backed encryption via AWS Nitro Enclaves',
            'On-demand provisioning (scale-to-zero)',
            'Automatic idle termination',
            'Standard PostgreSQL compatibility',
            'SSL/TLS encrypted connections',
            'Per-database isolation',
          ],
        }
      })

      // Get specific tier details
      .get(
        '/tiers/:tier',
        async ({ params, set }) => {
          await ensureInitialized()
          const provisioner = getNitroTEEDatabaseProvisioner()

          const validTiers = ['small', 'medium', 'large', 'xlarge']
          if (!validTiers.includes(params.tier)) {
            set.status = 404
            return { error: `Invalid tier: ${params.tier}` }
          }

          const spec = provisioner.getTier(params.tier as NitroDatabaseTier)

          return {
            tier: spec,
            estimatedMonthlyCost: spec.pricePerHourUsd * 720,
            features: {
              cpuCores: spec.cpuCores,
              memoryGb: spec.memoryMb / 1024,
              storageGb: spec.storageMb / 1024,
              maxConnections: spec.maxConnections,
              enclaveMemoryGb: spec.enclaveMemoryMb / 1024,
              enclaveCpus: spec.enclaveCpus,
            },
          }
        },
        {
          params: t.Object({
            tier: t.String(),
          }),
        },
      )

      // Provision a new database
      .post(
        '/provision',
        async ({ body, request, set }) => {
          await ensureInitialized()

          const ownerHeader = request.headers.get('x-jeju-address')
          if (!ownerHeader) {
            set.status = 401
            return { error: 'x-jeju-address header required' }
          }

          const provisioner = getNitroTEEDatabaseProvisioner()

          const db = await provisioner.provision({
            name: body.name,
            tier: body.tier as NitroDatabaseTier,
            owner: ownerHeader as Address,
            region: body.region ?? 'us-east-1',
            idleTimeoutMs: body.idleTimeoutMs ?? 3600000,
            autoTerminate: body.autoTerminate ?? true,
          })

          set.status = 201

          return {
            database: {
              id: db.id,
              name: db.name,
              tier: db.tier,
              status: db.status,
              region: db.region,
              port: db.port,
              // Include connection string with password (only time it's exposed)
              connectionString: db.connectionString,
              username: db.username,
              database: db.database,
            },
            pricing: {
              pricePerHourUsd: provisioner.getTier(db.tier as NitroDatabaseTier)
                .pricePerHourUsd,
              estimatedMonthlyCostUsd:
                provisioner.getTier(db.tier as NitroDatabaseTier)
                  .pricePerHourUsd * 720,
            },
            message:
              'Database provisioning started. Save the connection string - the password will not be shown again.',
          }
        },
        {
          body: t.Object({
            name: t.String({ minLength: 1, maxLength: 63 }),
            tier: t.Union([
              t.Literal('small'),
              t.Literal('medium'),
              t.Literal('large'),
              t.Literal('xlarge'),
            ]),
            region: t.Optional(t.String()),
            idleTimeoutMs: t.Optional(t.Number({ minimum: 60000 })),
            autoTerminate: t.Optional(t.Boolean()),
          }),
        },
      )

      // Get database by ID
      .get(
        '/:id',
        async ({ params, request, set }) => {
          await ensureInitialized()

          const ownerHeader = request.headers.get('x-jeju-address')
          const provisioner = getNitroTEEDatabaseProvisioner()

          const db = provisioner.getDatabase(params.id)
          if (!db) {
            set.status = 404
            return { error: 'Database not found' }
          }

          // Verify ownership
          if (
            ownerHeader &&
            db.owner.toLowerCase() !== ownerHeader.toLowerCase()
          ) {
            set.status = 403
            return { error: 'Not authorized' }
          }

          const spec = provisioner.getTier(db.tier as NitroDatabaseTier)

          return {
            id: db.id,
            name: db.name,
            tier: db.tier,
            status: db.status,
            region: db.region,
            // Connection info (password not included after initial creation)
            host: db.publicIp,
            port: db.port,
            database: db.database,
            username: db.username,
            sslMode: 'require',
            // Lifecycle
            createdAt: db.createdAt,
            provisionedAt: db.provisionedAt,
            lastActivityAt: db.lastActivityAt,
            // Billing
            totalCostUsd: db.totalCostUsd,
            billedHours: db.billedHours,
            pricePerHourUsd: spec.pricePerHourUsd,
            // Settings
            idleTimeoutMs: db.idleTimeoutMs,
            autoTerminate: db.autoTerminate,
            // TEE
            enclaveId: db.enclaveId,
            hasAttestation: !!db.attestationDocument,
          }
        },
        {
          params: t.Object({
            id: t.String(),
          }),
        },
      )

      // List databases for owner
      .get('/list', async ({ request }) => {
        await ensureInitialized()

        const ownerHeader = request.headers.get('x-jeju-address')
        if (!ownerHeader) {
          return { databases: [] }
        }

        const provisioner = getNitroTEEDatabaseProvisioner()
        const databases = provisioner.listDatabases(ownerHeader as Address)

        return {
          databases: databases.map((db) => ({
            id: db.id,
            name: db.name,
            tier: db.tier,
            status: db.status,
            region: db.region,
            host: db.publicIp,
            port: db.port,
            database: db.database,
            createdAt: db.createdAt,
            lastActivityAt: db.lastActivityAt,
            totalCostUsd: db.totalCostUsd,
          })),
          total: databases.length,
        }
      })

      // Record activity (prevents idle termination)
      .post(
        '/:id/activity',
        async ({ params, request, set }) => {
          await ensureInitialized()

          const ownerHeader = request.headers.get('x-jeju-address')
          if (!ownerHeader) {
            set.status = 401
            return { error: 'x-jeju-address header required' }
          }

          const provisioner = getNitroTEEDatabaseProvisioner()
          const db = provisioner.getDatabase(params.id)

          if (!db) {
            set.status = 404
            return { error: 'Database not found' }
          }

          if (db.owner.toLowerCase() !== ownerHeader.toLowerCase()) {
            set.status = 403
            return { error: 'Not authorized' }
          }

          const success = provisioner.recordActivity(params.id)
          return { success, lastActivityAt: Date.now() }
        },
        {
          params: t.Object({
            id: t.String(),
          }),
        },
      )

      // Start a stopped database
      .post(
        '/:id/start',
        async ({ params, request, set }) => {
          await ensureInitialized()

          const ownerHeader = request.headers.get('x-jeju-address')
          if (!ownerHeader) {
            set.status = 401
            return { error: 'x-jeju-address header required' }
          }

          const provisioner = getNitroTEEDatabaseProvisioner()

          const db = await provisioner.start(params.id, ownerHeader as Address)

          return {
            id: db.id,
            status: db.status,
            message: 'Database starting. A new password will be generated.',
            // New connection string with new password
            connectionString: db.connectionString,
          }
        },
        {
          params: t.Object({
            id: t.String(),
          }),
        },
      )

      // Stop a database (releases instance)
      .post(
        '/:id/stop',
        async ({ params, request, set }) => {
          await ensureInitialized()

          const ownerHeader = request.headers.get('x-jeju-address')
          if (!ownerHeader) {
            set.status = 401
            return { error: 'x-jeju-address header required' }
          }

          const provisioner = getNitroTEEDatabaseProvisioner()
          const success = await provisioner.stop(
            params.id,
            ownerHeader as Address,
          )

          if (!success) {
            set.status = 400
            return { error: 'Cannot stop database in current state' }
          }

          return {
            success: true,
            message:
              'Database stopped. Instance terminated to save costs. Data is preserved.',
          }
        },
        {
          params: t.Object({
            id: t.String(),
          }),
        },
      )

      // Terminate a database
      .delete(
        '/:id',
        async ({ params, request, set }) => {
          await ensureInitialized()

          const ownerHeader = request.headers.get('x-jeju-address')
          if (!ownerHeader) {
            set.status = 401
            return { error: 'x-jeju-address header required' }
          }

          const provisioner = getNitroTEEDatabaseProvisioner()
          const db = provisioner.getDatabase(params.id)

          if (!db) {
            set.status = 404
            return { error: 'Database not found' }
          }

          const success = await provisioner.terminate(
            params.id,
            ownerHeader as Address,
          )

          return {
            success,
            finalCostUsd: db.totalCostUsd,
            message: 'Database terminated. All data has been deleted.',
          }
        },
        {
          params: t.Object({
            id: t.String(),
          }),
        },
      )

      // Get statistics
      .get('/stats', async () => {
        await ensureInitialized()
        const provisioner = getNitroTEEDatabaseProvisioner()
        return provisioner.getStats()
      })

      // Pricing estimator
      .post(
        '/estimate',
        async ({ body }) => {
          await ensureInitialized()
          const provisioner = getNitroTEEDatabaseProvisioner()

          const spec = provisioner.getTier(body.tier as NitroDatabaseTier)
          const hours = body.hoursPerMonth ?? 720 // Full month by default

          return {
            tier: body.tier,
            hoursPerMonth: hours,
            pricePerHourUsd: spec.pricePerHourUsd,
            estimatedMonthlyCostUsd: spec.pricePerHourUsd * hours,
            specs: {
              cpuCores: spec.cpuCores,
              memoryGb: spec.memoryMb / 1024,
              storageGb: spec.storageMb / 1024,
              maxConnections: spec.maxConnections,
            },
            savings: {
              // If using on-demand for 8 hours/day vs 24/7
              onDemandHours8h: spec.pricePerHourUsd * 8 * 30,
              alwaysOn: spec.pricePerHourUsd * 720,
              savings8hPerMonth:
                spec.pricePerHourUsd * 720 - spec.pricePerHourUsd * 8 * 30,
            },
          }
        },
        {
          body: t.Object({
            tier: t.Union([
              t.Literal('small'),
              t.Literal('medium'),
              t.Literal('large'),
              t.Literal('xlarge'),
            ]),
            hoursPerMonth: t.Optional(t.Number({ minimum: 1, maximum: 744 })),
          }),
        },
      )
  )
}
