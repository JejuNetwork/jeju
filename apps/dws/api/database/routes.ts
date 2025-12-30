/**
 * Database API Routes
 *
 * REST API for managed database service (SQLit + PostgreSQL)
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import type { BackendManager } from '../storage/backends'
import {
  CreateDatabaseSchema,
  getManagedDatabaseService,
  UpdateDatabaseSchema,
} from './managed-service'

export function createDatabaseRoutes(backend: BackendManager) {
  const dbService = getManagedDatabaseService(backend)

  return (
    new Elysia({ prefix: '/database' })
      // List all databases for owner
      .get('/', async ({ headers }) => {
        const owner = headers['x-wallet-address'] as Address
        if (!owner) {
          return { error: 'Unauthorized' }
        }

        const instances = dbService.getInstancesByOwner(owner)
        return { instances }
      })

      // Create database
      .post(
        '/',
        async ({ body, headers }) => {
          const owner = headers['x-wallet-address'] as Address
          if (!owner) {
            return { error: 'Unauthorized' }
          }

          const params = CreateDatabaseSchema.parse(body)
          const instance = await dbService.createDatabase(owner, params)

          return { instance }
        },
        {
          body: t.Object({
            name: t.String(),
            engine: t.Union([t.Literal('sqlit'), t.Literal('postgresql')]),
            planId: t.String(),
            region: t.Optional(t.String()),
            config: t.Optional(
              t.Object({
                vcpus: t.Optional(t.Number()),
                memoryMb: t.Optional(t.Number()),
                storageMb: t.Optional(t.Number()),
                readReplicas: t.Optional(t.Number()),
                maxConnections: t.Optional(t.Number()),
                connectionPoolSize: t.Optional(t.Number()),
                backupRetentionDays: t.Optional(t.Number()),
                pointInTimeRecovery: t.Optional(t.Boolean()),
                publicAccess: t.Optional(t.Boolean()),
                replicationFactor: t.Optional(t.Number()),
                consistencyMode: t.Optional(
                  t.Union([t.Literal('strong'), t.Literal('eventual')]),
                ),
              }),
            ),
          }),
        },
      )

      // Get database by ID
      .get('/:instanceId', async ({ params, headers }) => {
        const owner = headers['x-wallet-address'] as Address
        const instance = dbService.getInstance(params.instanceId)

        if (!instance) {
          return { error: 'Database not found' }
        }

        if (instance.owner !== owner) {
          return { error: 'Unauthorized' }
        }

        return { instance }
      })

      // Update database
      .patch(
        '/:instanceId',
        async ({ params, body, headers }) => {
          const owner = headers['x-wallet-address'] as Address
          if (!owner) {
            return { error: 'Unauthorized' }
          }

          const updates = UpdateDatabaseSchema.parse(body)
          const instance = await dbService.updateDatabase(
            params.instanceId,
            owner,
            updates,
          )

          return { instance }
        },
        {
          body: t.Object({
            vcpus: t.Optional(t.Number()),
            memoryMb: t.Optional(t.Number()),
            storageMb: t.Optional(t.Number()),
            readReplicas: t.Optional(t.Number()),
            maxConnections: t.Optional(t.Number()),
            connectionPoolSize: t.Optional(t.Number()),
          }),
        },
      )

      // Stop database
      .post('/:instanceId/stop', async ({ params, headers }) => {
        const owner = headers['x-wallet-address'] as Address
        if (!owner) {
          return { error: 'Unauthorized' }
        }

        await dbService.stopDatabase(params.instanceId, owner)
        return { success: true }
      })

      // Start database
      .post('/:instanceId/start', async ({ params, headers }) => {
        const owner = headers['x-wallet-address'] as Address
        if (!owner) {
          return { error: 'Unauthorized' }
        }

        await dbService.startDatabase(params.instanceId, owner)
        return { success: true }
      })

      // Delete database
      .delete('/:instanceId', async ({ params, headers }) => {
        const owner = headers['x-wallet-address'] as Address
        if (!owner) {
          return { error: 'Unauthorized' }
        }

        await dbService.deleteDatabase(params.instanceId, owner)
        return { success: true }
      })

      // Get connection details
      .get('/:instanceId/connection', async ({ params, headers }) => {
        const owner = headers['x-wallet-address'] as Address
        if (!owner) {
          return { error: 'Unauthorized' }
        }

        const credentials = dbService.getCredentials(params.instanceId, owner)
        return { credentials }
      })

      // Get connection pool stats
      .get('/:instanceId/pool', async ({ params, headers }) => {
        const owner = headers['x-wallet-address'] as Address
        if (!owner) {
          return { error: 'Unauthorized' }
        }

        const stats = dbService.getPoolStats(params.instanceId)
        return { stats }
      })

      // Create backup
      .post('/:instanceId/backups', async ({ params, headers }) => {
        const owner = headers['x-wallet-address'] as Address
        if (!owner) {
          return { error: 'Unauthorized' }
        }

        const backup = await dbService.createBackup(params.instanceId, owner)
        return { backup }
      })

      // Restore from backup
      .post(
        '/:instanceId/restore',
        async ({ params, body, headers }) => {
          const owner = headers['x-wallet-address'] as Address
          if (!owner) {
            return { error: 'Unauthorized' }
          }

          await dbService.restoreBackup(params.instanceId, body.backupId, owner)
          return { success: true }
        },
        {
          body: t.Object({
            backupId: t.String(),
          }),
        },
      )

      // Create read replica (PostgreSQL only)
      .post(
        '/:instanceId/replicas',
        async ({ params, body, headers }) => {
          const owner = headers['x-wallet-address'] as Address
          if (!owner) {
            return { error: 'Unauthorized' }
          }

          const replica = await dbService.createReplica(
            params.instanceId,
            owner,
            body.region,
          )
          return { replica }
        },
        {
          body: t.Object({
            region: t.String(),
          }),
        },
      )

      // Promote replica to primary
      .post(
        '/:instanceId/replicas/:replicaId/promote',
        async ({ params, headers }) => {
          const owner = headers['x-wallet-address'] as Address
          if (!owner) {
            return { error: 'Unauthorized' }
          }

          await dbService.promoteReplica(params.replicaId, owner)
          return { success: true }
        },
      )
  )
}
