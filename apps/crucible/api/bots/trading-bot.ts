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
