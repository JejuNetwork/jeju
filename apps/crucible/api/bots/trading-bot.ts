import type { Address } from 'viem'
import type { TradingBotChain, TradingBotStrategy } from '../../lib/types'

/**
 * Options for creating a trading bot instance.
 */
export interface TradingBotOptions {
  agentId: bigint
  name: string
  strategies: TradingBotStrategy[]
  chains: TradingBotChain[]
  maxConcurrentExecutions: number
  useFlashbots: boolean
  treasuryAddress?: Address
  privateKey?: `0x${string}`
}

export interface TradingBotConfig {
  id: bigint
  name: string
  strategy:
    | 'momentum'
    | 'mean-reversion'
    | 'arbitrage'
    | 'market-making'
    | 'custom'
  enabled: boolean
  maxPositionSize: bigint
  minTradeSize: bigint
  maxSlippageBps: number
  cooldownMs: number
  targetTokens: Address[]
  excludedTokens: Address[]
}

export interface TradingBotState {
  lastTradeTimestamp: number
  totalTrades: number
  successfulTrades: number
  totalVolume: bigint
  pnl: bigint
  currentPositions: Map<Address, bigint>
}

export interface TradingBotMetrics {
  uptime: number
  totalTrades: number
  successRate: number
  totalVolume: string
  pnl: string
  lastTradeTimestamp: number
}

export interface TradingBot {
  id: bigint
  config: TradingBotConfig
  state: TradingBotState
  start(): Promise<void>
  stop(): Promise<void>
  isRunning(): boolean
  isHealthy(): boolean
  getMetrics(): TradingBotMetrics
  evaluateOpportunity(token: Address, price: bigint): Promise<boolean>
  executeTrade(token: Address, amount: bigint, isBuy: boolean): Promise<string>
  updateState(): Promise<void>
}
