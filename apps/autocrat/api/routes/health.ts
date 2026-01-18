import { getContract } from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { toAddress } from '../../lib'
import { type ERC8004Config, getERC8004Client } from '../erc8004'
import { type FutarchyConfig, getFutarchyClient } from '../futarchy'
import { getModerationSystem } from '../moderation'
import {
  autocratConfig,
  config,
  getOrchestrator,
  metricsData,
} from '../shared-state'
import { getTEEMode } from '../tee'

const ZERO_ADDR = ZERO_ADDRESS

// Helper to safely get contract addresses
const getContractAddr = (category: string, name: string) => {
  try {
    return getContract(category as 'governance' | 'registry', name)
  } catch {
    return '0x0000000000000000000000000000000000000000'
  }
}

const erc8004Config: ERC8004Config = {
  rpcUrl: config.rpcUrl,
  identityRegistry: config.contracts.identityRegistry,
  reputationRegistry: config.contracts.reputationRegistry,
  validationRegistry: getContractAddr('registry', 'validation'),
  operatorKey: autocratConfig.operatorKey ?? autocratConfig.privateKey,
}
const erc8004 = getERC8004Client(erc8004Config)

const futarchyConfig: FutarchyConfig = {
  rpcUrl: config.rpcUrl,
  boardAddress: config.contracts.board
    ? toAddress(config.contracts.board)
    : ZERO_ADDR,
  predictionMarketAddress: ZERO_ADDR,
  operatorKey: autocratConfig.operatorKey ?? autocratConfig.privateKey,
}
const futarchy = getFutarchyClient(futarchyConfig)

export const healthRoutes = new Elysia()
  .get('/health', () => {
    const orchestrator = getOrchestrator()
    return {
      status: 'ok',
      service: 'jeju-board',
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
        board: futarchy.boardDeployed,
        predictionMarket: futarchy.predictionMarketDeployed,
      },
      registry: {
        integration:
          getContractAddr('governance', 'registryIntegration') !== ZERO_ADDR,
        delegation:
          getContractAddr('governance', 'delegationRegistry') !== ZERO_ADDR,
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
  .get('/metrics', async () => {
    const mem = process.memoryUsage()
    const uptime = (Date.now() - metricsData.startTime) / 1000
    const orchestrator = getOrchestrator()
    const orch = orchestrator?.getStatus()
    const activeFlags = (await getModerationSystem().getActiveFlags()).length
    const lines = [
      '# HELP board_requests_total Total HTTP requests',
      '# TYPE board_requests_total counter',
      `board_requests_total ${metricsData.requests}`,
      '# HELP board_errors_total Total errors',
      '# TYPE board_errors_total counter',
      `board_errors_total ${metricsData.errors}`,
      '# HELP board_uptime_seconds Service uptime',
      '# TYPE board_uptime_seconds gauge',
      `board_uptime_seconds ${uptime.toFixed(0)}`,
      '# HELP board_memory_bytes Memory usage',
      '# TYPE board_memory_bytes gauge',
      `board_memory_bytes{type="heap"} ${mem.heapUsed}`,
      `board_memory_bytes{type="rss"} ${mem.rss}`,
      '# HELP board_orchestrator_cycles Total orchestrator cycles',
      '# TYPE board_orchestrator_cycles counter',
      `board_orchestrator_cycles ${orch?.cycleCount ?? 0}`,
      '# HELP board_proposals_processed Total proposals processed',
      '# TYPE board_proposals_processed counter',
      `board_proposals_processed ${orch?.totalProcessed ?? 0}`,
      '# HELP board_moderation_flags_active Active moderation flags',
      '# TYPE board_moderation_flags_active gauge',
      `board_moderation_flags_active ${activeFlags}`,
    ]
    return new Response(lines.join('\n'), {
      headers: { 'Content-Type': 'text/plain' },
    })
  })
