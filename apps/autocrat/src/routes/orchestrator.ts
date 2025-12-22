/**
 * Orchestrator Routes - DAO orchestration
 */

import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { createOrchestrator } from '../orchestrator'
import { blockchain, config, getOrchestrator, setOrchestrator } from '../server'

export const orchestratorRoutes = new Elysia({ prefix: '/api/v1/orchestrator' })
  .post(
    '/start',
    async () => {
      const current = getOrchestrator()
      if (current?.getStatus().running) {
        throw new Error('Orchestrator already running')
      }

      const orchestratorConfig = {
        rpcUrl: config.rpcUrl,
        daoRegistry: config.contracts.daoRegistry as Address,
        daoFunding: config.contracts.daoFunding as Address,
        contracts: {
          daoRegistry: config.contracts.daoRegistry as Address,
          daoFunding: config.contracts.daoFunding as Address,
        },
      }
      const newOrchestrator = createOrchestrator(orchestratorConfig, blockchain)
      await newOrchestrator.start()
      setOrchestrator(newOrchestrator)

      return { status: 'started', ...newOrchestrator.getStatus() }
    },
    {
      detail: { tags: ['orchestrator'], summary: 'Start orchestrator' },
    },
  )
  .post(
    '/stop',
    async () => {
      const orchestrator = getOrchestrator()
      if (!orchestrator?.getStatus().running) {
        throw new Error('Orchestrator not running')
      }
      await orchestrator.stop()
      return { status: 'stopped' }
    },
    {
      detail: { tags: ['orchestrator'], summary: 'Stop orchestrator' },
    },
  )
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
  .post(
    '/dao/:daoId/refresh',
    async ({ params }) => {
      const orchestrator = getOrchestrator()
      if (!orchestrator) return { error: 'Orchestrator not running' }
      await orchestrator.refreshDAO(params.daoId)
      return { success: true }
    },
    {
      params: t.Object({ daoId: t.String() }),
      detail: {
        tags: ['orchestrator'],
        summary: 'Refresh DAO in orchestrator',
      },
    },
  )
  .post(
    '/dao/:daoId/active',
    async ({ params, body }) => {
      const orchestrator = getOrchestrator()
      if (!orchestrator) throw new Error('Orchestrator not running')
      orchestrator.setDAOActive(params.daoId, body.active)
      return { success: true }
    },
    {
      params: t.Object({ daoId: t.String() }),
      body: t.Object({ active: t.Boolean() }),
      detail: { tags: ['orchestrator'], summary: 'Set DAO active status' },
    },
  )
