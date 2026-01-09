import { Elysia } from 'elysia'
import { config } from '../config'

interface BotMetrics {
  opportunitiesDetected: number
  opportunitiesExecuted: number
  opportunitiesFailed: number
  totalProfitWei: string
  totalProfitUsd: string
  totalGasSpent: string
  avgExecutionTimeMs: number
  uptime: number
  lastUpdate: number
  byStrategy: Record<
    string,
    {
      detected: number
      executed: number
      failed: number
      profitWei: string
    }
  >
}

interface Bot {
  agentId: string
  metrics: BotMetrics
  healthy: boolean
}

interface BotsResponse {
  bots: Bot[]
}

// Simple in-memory store for bots
// In production, this should be persisted to a database or fetched from on-chain
const bots = new Map<string, Bot>()

// Initialize with empty bots list
// In production, this would load from database or on-chain registry
function initializeBots(): void {
  // For now, return empty list
  // This can be populated from on-chain registry or database
}

export function createBotsRouter() {
  const router = new Elysia({ prefix: '/bots' })

  // Get all bots
  router.get('/', () => {
    if (!config.botsEnabled) {
      return {
        bots: [],
        message: 'Bots are disabled. Set BOTS_ENABLED=true to enable.',
      }
    }

    const botsList: Bot[] = Array.from(bots.values())

    // If no bots in memory, return empty list
    // In production, this would fetch from database or on-chain registry
    const response: BotsResponse = {
      bots: botsList,
    }

    return response
  })

  // Start a bot
  router.post('/:agentId/start', ({ params }) => {
    if (!config.botsEnabled) {
      return {
        success: false,
        error: 'Bots are disabled. Set BOTS_ENABLED=true to enable.',
      }
    }

    const { agentId } = params

    // Check if bot exists
    const bot = bots.get(agentId)
    if (!bot) {
      // In production, this would check on-chain registry or database
      return {
        success: false,
        error: `Bot ${agentId} not found`,
      }
    }

    // In production, this would start the bot's execution loop
    return {
      success: true,
      message: `Bot ${agentId} started`,
      agentId,
    }
  })

  // Stop a bot
  router.post('/:agentId/stop', ({ params }) => {
    if (!config.botsEnabled) {
      return {
        success: false,
        error: 'Bots are disabled. Set BOTS_ENABLED=true to enable.',
      }
    }

    const { agentId } = params

    // Check if bot exists
    const bot = bots.get(agentId)
    if (!bot) {
      return {
        success: false,
        error: `Bot ${agentId} not found`,
      }
    }

    // In production, this would stop the bot's execution loop
    return {
      success: true,
      message: `Bot ${agentId} stopped`,
      agentId,
    }
  })

  // Initialize bots on first load
  initializeBots()

  return router
}
