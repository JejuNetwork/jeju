import { Elysia, t } from 'elysia'
import { getComputeTriggerClient } from '../compute-trigger'
import { validateApiKey, auditLog } from '../security'
import { runOrchestratorCycle } from '../shared-state'

// Helper to extract API key from headers
function getApiKey(request: Request): string {
  return (
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace('Bearer ', '') ??
    ''
  )
}

export const triggersRoutes = new Elysia({ prefix: '/api/v1/triggers' })
  // Read-only endpoints are safe without auth (just status info)
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
  // SECURITY: Orchestrator execution requires API key authentication
  // These endpoints can manipulate governance state and must be protected
  .post(
    '/execute',
    async ({ request }) => {
      // Validate API key before allowing execution
      const apiKey = getApiKey(request)
      if (!validateApiKey(apiKey)) {
        auditLog('orchestrator_execute_unauthorized', 'anonymous', request, false, {
          reason: 'invalid_api_key',
        })
        throw new Error('Unauthorized: Valid API key required to execute orchestrator')
      }

      auditLog('orchestrator_execute', 'operator', request, true, {
        trigger: 'manual',
      })

      const result = await runOrchestratorCycle()
      return result
    },
    {
      detail: {
        tags: ['triggers'],
        summary: 'Execute orchestrator cycle manually (requires API key)',
      },
    },
  )
  // Webhook endpoint for DWS compute - REQUIRES API KEY
  // This is called by the compute scheduler, which must include the API key
  .post(
    '/orchestrator',
    async ({ request }) => {
      // Validate API key - DWS compute must include this in webhook calls
      const apiKey = getApiKey(request)
      if (!validateApiKey(apiKey)) {
        auditLog('orchestrator_webhook_unauthorized', 'anonymous', request, false, {
          reason: 'invalid_api_key',
        })
        throw new Error('Unauthorized: Valid API key required for orchestrator webhook')
      }

      auditLog('orchestrator_webhook', 'compute', request, true, {
        trigger: 'scheduled',
      })

      const result = await runOrchestratorCycle()
      return { success: true, executionId: `exec-${Date.now()}`, ...result }
    },
    {
      detail: { tags: ['triggers'], summary: 'Orchestrator trigger webhook (requires API key)' },
    },
  )
