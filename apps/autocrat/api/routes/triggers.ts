import { Elysia, t } from 'elysia'
import { getComputeTriggerClient } from '../compute-trigger'
import { runOrchestratorCycle } from '../shared-state'

export const triggersRoutes = new Elysia({ prefix: '/api/v1/triggers' })
  .get(
    '/',
    async () => {
      const client = getComputeTriggerClient()
      if (!(await client.isAvailable())) {
        return { mode: 'local', message: 'Using local cron', triggers: [] }
      }
      return {
        mode: 'compute',
        triggers: await client.list({ active: true }),
      }
    },
    {
      detail: { tags: ['triggers'], summary: 'List active triggers' },
    },
  )
  .get(
    '/history',
    async ({ query }) => {
      const client = getComputeTriggerClient()
      if (!(await client.isAvailable())) {
        return { mode: 'local', executions: [] }
      }
      const limit = parseInt(query.limit ?? '50', 10)
      return {
        mode: 'compute',
        executions: await client.getHistory(undefined, limit),
      }
    },
    {
      query: t.Object({ limit: t.Optional(t.String()) }),
      detail: { tags: ['triggers'], summary: 'Get trigger execution history' },
    },
  )
  .post(
    '/execute',
    async () => {
      const result = await runOrchestratorCycle()
      return result
    },
    {
      detail: {
        tags: ['triggers'],
        summary: 'Execute orchestrator cycle manually',
      },
    },
  )
  // Webhook endpoint for DWS compute
  .post(
    '/orchestrator',
    async () => {
      const result = await runOrchestratorCycle()
      return { success: true, executionId: `exec-${Date.now()}`, ...result }
    },
    {
      detail: { tags: ['triggers'], summary: 'Orchestrator trigger webhook' },
    },
  )
