import { Elysia, t } from 'elysia'
import { createOrchestrator } from '../orchestrator'
import { auditLog, validateApiKey } from '../security'
import {
  blockchain,
  config,
  getOrchestrator,
  setOrchestrator,
} from '../shared-state'

// Helper to extract API key from headers
function getApiKey(request: Request): string {
  return (
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace('Bearer ', '') ??
    ''
  )
}

export const orchestratorRoutes = new Elysia({ prefix: '/api/v1/orchestrator' })
  // SECURITY: All mutating orchestrator operations require API key
  // These are critical system operations that should only be performed by operators
  .post(
    '/start',
    async ({ request }) => {
      // Validate API key
      const apiKey = getApiKey(request)
      if (!validateApiKey(apiKey)) {
        auditLog(
          'orchestrator_start_unauthorized',
          'anonymous',
          request,
          false,
          {
            reason: 'invalid_api_key',
          },
        )
        throw new Error(
          'Unauthorized: Valid API key required to start orchestrator',
        )
      }

      const current = getOrchestrator()
      if (current?.getStatus().running) {
        throw new Error('Orchestrator already running')
      }

      auditLog('orchestrator_start', 'operator', request, true, {})

      const orchestratorConfig = {
        rpcUrl: config.rpcUrl,
        daoRegistry: config.contracts.daoRegistry,
        daoFunding: config.contracts.daoFunding,
        contracts: {
          daoRegistry: config.contracts.daoRegistry,
          daoFunding: config.contracts.daoFunding,
        },
      }
      const newOrchestrator = createOrchestrator(orchestratorConfig, blockchain)
      await newOrchestrator.start()
      setOrchestrator(newOrchestrator)

      return { status: 'started', ...newOrchestrator.getStatus() }
    },
    {
      detail: {
        tags: ['orchestrator'],
        summary: 'Start orchestrator (requires API key)',
      },
    },
  )
  .post(
    '/stop',
    async ({ request }) => {
      // Validate API key
      const apiKey = getApiKey(request)
      if (!validateApiKey(apiKey)) {
        auditLog(
          'orchestrator_stop_unauthorized',
          'anonymous',
          request,
          false,
          {
            reason: 'invalid_api_key',
          },
        )
        throw new Error(
          'Unauthorized: Valid API key required to stop orchestrator',
        )
      }

      const orchestrator = getOrchestrator()
      if (!orchestrator?.getStatus().running) {
        throw new Error('Orchestrator not running')
      }

      auditLog('orchestrator_stop', 'operator', request, true, {})

      await orchestrator.stop()
      return { status: 'stopped' }
    },
    {
      detail: {
        tags: ['orchestrator'],
        summary: 'Stop orchestrator (requires API key)',
      },
    },
  )
  // Status is read-only and safe without auth
  .get(
    '/status',
    () => {
      const orchestrator = getOrchestrator()
      if (!orchestrator) {
        return {
          running: false,
          cycleCount: 0,
          message: 'Orchestrator not initialized',
        }
      }
      return orchestrator.getStatus()
    },
    {
      detail: { tags: ['orchestrator'], summary: 'Get orchestrator status' },
    },
  )
  // Read-only DAO status
  .get(
    '/dao/:daoId',
    ({ params }) => {
      const orchestrator = getOrchestrator()
      if (!orchestrator) throw new Error('Orchestrator not running')
      const status = orchestrator.getDAOStatus(params.daoId)
      if (!status) return { error: 'DAO not tracked' }
      return status
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: {
        tags: ['orchestrator'],
        summary: 'Get DAO status in orchestrator',
      },
    },
  )
  // SECURITY: DAO refresh requires API key
  .post(
    '/dao/:daoId/refresh',
    async ({ params, request }) => {
      // Validate API key
      const apiKey = getApiKey(request)
      if (!validateApiKey(apiKey)) {
        auditLog(
          'orchestrator_refresh_unauthorized',
          'anonymous',
          request,
          false,
          {
            daoId: params.daoId,
            reason: 'invalid_api_key',
          },
        )
        throw new Error('Unauthorized: Valid API key required to refresh DAO')
      }

      const orchestrator = getOrchestrator()
      if (!orchestrator) return { error: 'Orchestrator not running' }

      auditLog('orchestrator_dao_refresh', 'operator', request, true, {
        daoId: params.daoId,
      })

      await orchestrator.refreshDAO(params.daoId)
      return { success: true }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: {
        tags: ['orchestrator'],
        summary: 'Refresh DAO in orchestrator (requires API key)',
      },
    },
  )
  // SECURITY: Setting DAO active status requires API key
  .post(
    '/dao/:daoId/active',
    async ({ params, body, request }) => {
      // Validate API key
      const apiKey = getApiKey(request)
      if (!validateApiKey(apiKey)) {
        auditLog(
          'orchestrator_active_unauthorized',
          'anonymous',
          request,
          false,
          {
            daoId: params.daoId,
            reason: 'invalid_api_key',
          },
        )
        throw new Error(
          'Unauthorized: Valid API key required to set DAO active status',
        )
      }

      const orchestrator = getOrchestrator()
      if (!orchestrator) throw new Error('Orchestrator not running')

      auditLog('orchestrator_dao_active_change', 'operator', request, true, {
        daoId: params.daoId,
        active: body.active,
      })

      orchestrator.setDAOActive(params.daoId, body.active)
      return { success: true }
    },
    {
      params: t.Object({ daoId: t.String() }),
      body: t.Object({ active: t.Boolean() }),
      detail: {
        tags: ['orchestrator'],
        summary: 'Set DAO active status (requires API key)',
      },
    },
  )
