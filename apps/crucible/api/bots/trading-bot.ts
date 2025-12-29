import type { Address } from 'viem'
import type { AgentCharacter } from '../../lib/types'

export type BotStrategy =
  | 'momentum'
  | 'mean-reversion'
  | 'arbitrage'
  | 'market-making'
  | 'custom'

export interface TradingBotConfig {
  id: bigint
  name: string
  strategy: BotStrategy
  character?: AgentCharacter
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
