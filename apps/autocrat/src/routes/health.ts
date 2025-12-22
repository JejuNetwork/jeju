/**
 * Health and Metrics Routes
 */

import { Elysia } from 'elysia'
import { type ERC8004Config, getERC8004Client } from '../erc8004'
import { type FutarchyConfig, getFutarchyClient } from '../futarchy'
import { getModerationSystem } from '../moderation'
import { config, getOrchestrator, metricsData } from '../shared-state'
import { getTEEMode } from '../tee'

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`

const erc8004Config: ERC8004Config = {
  rpcUrl: config.rpcUrl,
  identityRegistry: config.contracts.identityRegistry as string,
  reputationRegistry: config.contracts.reputationRegistry as string,
  validationRegistry:
    process.env.VALIDATION_REGISTRY_ADDRESS ??
    '0x0000000000000000000000000000000000000000',
  operatorKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
}
const erc8004 = getERC8004Client(erc8004Config)

const futarchyConfig: FutarchyConfig = {
  rpcUrl: config.rpcUrl,
  councilAddress: config.contracts.council as `0x${string}`,
  predimarketAddress: ZERO_ADDR,
  operatorKey: process.env.OPERATOR_KEY ?? process.env.PRIVATE_KEY,
}
const futarchy = getFutarchyClient(futarchyConfig)

export const healthRoutes = new Elysia()
  .get('/health', () => {
    const orchestrator = getOrchestrator()
    return {
      status: 'ok',
      service: 'jeju-council',
      version: '3.0.0',
      mode: 'multi-tenant',
      tee: getTEEMode(),
      orchestrator: orchestrator?.getStatus().running ?? false,
      daoCount: orchestrator?.getStatus().daoCount ?? 0,
      daoRegistry: config.contracts.daoRegistry !== ZERO_ADDR,
      daoFunding: config.contracts.daoFunding !== ZERO_ADDR,
      erc8004: {
        identity: erc8004.identityDeployed,
        reputation: erc8004.reputationDeployed,
        validation: erc8004.validationDeployed,
      },
      futarchy: {
        council: futarchy.councilDeployed,
        predimarket: futarchy.predimarketDeployed,
      },
      registry: {
        integration: !!process.env.REGISTRY_INTEGRATION_ADDRESS,
        delegation: !!process.env.DELEGATION_REGISTRY_ADDRESS,
      },
      endpoints: {
        a2a: '/a2a',
        mcp: '/mcp',
        rest: '/api/v1',
        dao: '/api/v1/dao',
        agents: '/api/v1/agents',
        futarchy: '/api/v1/futarchy',
        moderation: '/api/v1/moderation',
        registry: '/api/v1/registry',
      },
    }
  })
  .get('/metrics', () => {
    const mem = process.memoryUsage()
    const uptime = (Date.now() - metricsData.startTime) / 1000
    const orchestrator = getOrchestrator()
    const orch = orchestrator?.getStatus()
    const activeFlags = getModerationSystem().getActiveFlags().length
    const lines = [
      '# HELP council_requests_total Total HTTP requests',
      '# TYPE council_requests_total counter',
      `council_requests_total ${metricsData.requests}`,
      '# HELP council_errors_total Total errors',
      '# TYPE council_errors_total counter',
      `council_errors_total ${metricsData.errors}`,
      '# HELP council_uptime_seconds Service uptime',
      '# TYPE council_uptime_seconds gauge',
      `council_uptime_seconds ${uptime.toFixed(0)}`,
      '# HELP council_memory_bytes Memory usage',
      '# TYPE council_memory_bytes gauge',
      `council_memory_bytes{type="heap"} ${mem.heapUsed}`,
      `council_memory_bytes{type="rss"} ${mem.rss}`,
      '# HELP council_orchestrator_cycles Total orchestrator cycles',
      '# TYPE council_orchestrator_cycles counter',
      `council_orchestrator_cycles ${orch?.cycleCount ?? 0}`,
      '# HELP council_proposals_processed Total proposals processed',
      '# TYPE council_proposals_processed counter',
      `council_proposals_processed ${orch?.totalProcessed ?? 0}`,
      '# HELP council_moderation_flags_active Active moderation flags',
      '# TYPE council_moderation_flags_active gauge',
      `council_moderation_flags_active ${activeFlags}`,
    ]
    return new Response(lines.join('\n'), {
      headers: { 'Content-Type': 'text/plain' },
    })
  })
