/**
 * Cron Management API Routes
 *
 * Provides endpoints to:
 * - List cron schedules for workers
 * - Get cron execution statistics
 * - Manually trigger cron jobs
 * - Enable/disable cron schedules
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { dwsWorkerCronState, dwsWorkerState } from '../../state'
import { getCronExecutor } from '../../workers/cron-executor'

export function createCronRouter() {
  return (
    new Elysia({ prefix: '/cron' })
      // Get cron executor stats
      .get('/stats', async () => {
        const executor = getCronExecutor()
        return executor.getStats()
      })

      // List all cron schedules
      .get('/schedules', async () => {
        const schedules = await dwsWorkerCronState.listEnabled()
        return {
          schedules: schedules.map((s) => ({
            id: s.id,
            workerId: s.workerId,
            name: s.name,
            schedule: s.schedule,
            endpoint: s.endpoint,
            enabled: s.enabled,
            nextRunAt: s.nextRunAt,
            lastRunAt: s.lastRunAt,
            totalRuns: s.totalRuns,
            successfulRuns: s.successfulRuns,
            failedRuns: s.failedRuns,
            lastError: s.lastError,
          })),
          total: schedules.length,
        }
      })

      // List cron schedules for a specific worker
      .get(
        '/workers/:workerId',
        async ({ params }) => {
          const schedules = await dwsWorkerCronState.listByWorker(
            params.workerId,
          )
          return {
            workerId: params.workerId,
            schedules: schedules.map((s) => ({
              id: s.id,
              name: s.name,
              schedule: s.schedule,
              endpoint: s.endpoint,
              enabled: s.enabled,
              nextRunAt: s.nextRunAt,
              lastRunAt: s.lastRunAt,
              totalRuns: s.totalRuns,
              successfulRuns: s.successfulRuns,
              failedRuns: s.failedRuns,
              lastError: s.lastError,
            })),
            total: schedules.length,
          }
        },
        {
          params: t.Object({
            workerId: t.String(),
          }),
        },
      )

      // Get a specific cron schedule
      .get(
        '/workers/:workerId/:cronName',
        async ({ params, set }) => {
          const schedule = await dwsWorkerCronState.get(
            params.workerId,
            params.cronName,
          )
          if (!schedule) {
            set.status = 404
            return { error: 'Cron schedule not found' }
          }
          return schedule
        },
        {
          params: t.Object({
            workerId: t.String(),
            cronName: t.String(),
          }),
        },
      )

      // Manually trigger a cron job
      .post(
        '/workers/:workerId/:cronName/trigger',
        async ({ params, headers, set }) => {
          const owner = headers['x-jeju-address']

          // Verify worker exists and owner matches (if provided)
          const worker = await dwsWorkerState.get(params.workerId)
          if (!worker) {
            set.status = 404
            return { error: 'Worker not found' }
          }

          if (owner && worker.owner.toLowerCase() !== owner.toLowerCase()) {
            set.status = 403
            return { error: 'Not authorized to trigger this cron' }
          }

          const schedule = await dwsWorkerCronState.get(
            params.workerId,
            params.cronName,
          )
          if (!schedule) {
            set.status = 404
            return { error: 'Cron schedule not found' }
          }

          const executor = getCronExecutor()
          const result = await executor.triggerManually(
            params.workerId,
            params.cronName,
          )

          return {
            triggered: true,
            result: {
              success: result.success,
              statusCode: result.statusCode,
              durationMs: result.durationMs,
              error: result.error,
            },
          }
        },
        {
          params: t.Object({
            workerId: t.String(),
            cronName: t.String(),
          }),
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Enable a cron schedule
      .post(
        '/workers/:workerId/:cronName/enable',
        async ({ params, headers, set }) => {
          const owner = headers['x-jeju-address'] as Address | undefined

          // Verify worker exists and owner matches (if provided)
          const worker = await dwsWorkerState.get(params.workerId)
          if (!worker) {
            set.status = 404
            return { error: 'Worker not found' }
          }

          if (owner && worker.owner.toLowerCase() !== owner.toLowerCase()) {
            set.status = 403
            return { error: 'Not authorized' }
          }

          const success = await dwsWorkerCronState.setEnabled(
            params.workerId,
            params.cronName,
            true,
          )

          if (!success) {
            set.status = 404
            return { error: 'Cron schedule not found' }
          }

          return { enabled: true }
        },
        {
          params: t.Object({
            workerId: t.String(),
            cronName: t.String(),
          }),
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Disable a cron schedule
      .post(
        '/workers/:workerId/:cronName/disable',
        async ({ params, headers, set }) => {
          const owner = headers['x-jeju-address'] as Address | undefined

          // Verify worker exists and owner matches (if provided)
          const worker = await dwsWorkerState.get(params.workerId)
          if (!worker) {
            set.status = 404
            return { error: 'Worker not found' }
          }

          if (owner && worker.owner.toLowerCase() !== owner.toLowerCase()) {
            set.status = 403
            return { error: 'Not authorized' }
          }

          const success = await dwsWorkerCronState.setEnabled(
            params.workerId,
            params.cronName,
            false,
          )

          if (!success) {
            set.status = 404
            return { error: 'Cron schedule not found' }
          }

          return { enabled: false }
        },
        {
          params: t.Object({
            workerId: t.String(),
            cronName: t.String(),
          }),
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Get recent execution history
      .get('/history', async () => {
        const executor = getCronExecutor()
        return {
          history: executor.getHistory(),
        }
      })
  )
}
