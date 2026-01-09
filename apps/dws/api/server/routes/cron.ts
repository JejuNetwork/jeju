/**
 * Cron Management API Routes
 */

import { Elysia, t } from 'elysia'
import {
  dwsWorkerCronState,
  dwsWorkerState,
  type WorkerCronSchedule,
} from '../../state'
import { getCronExecutor } from '../../workers/cron-executor'

/** Serialize a cron schedule for API response */
function serializeCron(s: WorkerCronSchedule) {
  return {
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
  }
}

const cronToggleSchema = {
  params: t.Object({ workerId: t.String(), cronName: t.String() }),
  headers: t.Object({ 'x-jeju-address': t.Optional(t.String()) }),
}

/** Shared handler for enable/disable */
async function setCronEnabled(
  params: { workerId: string; cronName: string },
  headers: { 'x-jeju-address'?: string },
  set: { status?: number | string },
  enabled: boolean,
) {
  const owner = headers['x-jeju-address']
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
    enabled,
  )
  if (!success) {
    set.status = 404
    return { error: 'Cron schedule not found' }
  }
  return { enabled }
}

export function createCronRouter() {
  return (
    new Elysia({ prefix: '/cron' })
      .get('/stats', async () => getCronExecutor().getStats())

      .get('/schedules', async () => {
        const schedules = await dwsWorkerCronState.listEnabled()
        return {
          schedules: schedules.map(serializeCron),
          total: schedules.length,
        }
      })

      .get(
        '/workers/:workerId',
        async ({ params }) => {
          const schedules = await dwsWorkerCronState.listByWorker(
            params.workerId,
          )
          return {
            workerId: params.workerId,
            schedules: schedules.map(serializeCron),
            total: schedules.length,
          }
        },
        { params: t.Object({ workerId: t.String() }) },
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

      .post(
        '/workers/:workerId/:cronName/enable',
        async ({ params, headers, set }) =>
          setCronEnabled(params, headers, set, true),
        cronToggleSchema,
      )

      .post(
        '/workers/:workerId/:cronName/disable',
        async ({ params, headers, set }) =>
          setCronEnabled(params, headers, set, false),
        cronToggleSchema,
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
