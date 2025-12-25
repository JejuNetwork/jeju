/**
 * Core types for the Jeju Bots package
 */

import type {
  BaseChainConfig,
  ChainType,
  EVMChainId,
  Token as SharedToken,
  SolanaNetwork,
} from '@jejunetwork/types'
import type { Address } from 'viem'
/** Bot-specific chain configuration */
export interface ChainConfig extends BaseChainConfig {
  blockTimeMs: number
  nativeCurrency: { symbol: string; decimals: number }
}
/** Token type for bots package, compatible with SharedToken */
export interface Token {
  address: string
  symbol: string
  decimals: number
  chainId: EVMChainId | SolanaNetwork | number
  name?: string
  logoUri?: string
}

/** Convert bots Token to shared Token type */
export function toSharedToken(token: Token): SharedToken {
  return {
    address: token.address as Address,
    name: token.name ?? token.symbol,
    symbol: token.symbol,
    decimals: token.decimals,
    chainId: typeof token.chainId === 'number' ? token.chainId : 1,
  }
}

export interface TokenPair {
  tokenA: Token
  tokenB: Token
  poolAddress?: string
}
export interface Pool {
  address: string
  chainId: EVMChainId
  dex: DexProtocol
  token0: Token
  token1: Token
  reserve0?: string
  reserve1?: string
  fee: number
  lastUpdate?: number
}

import type { DexProtocol } from '@jejunetwork/types'
export interface TFMMPool extends Pool {
  dex: 'tfmm'
  tokens: Token[]
  weights: bigint[]
  targetWeights: bigint[]
  weightDeltas: bigint[]
  lastUpdateBlock: bigint
  strategyRule: Address
  oracles: Address[]
  guardRails: TFMMGuardRails
}

export interface TFMMGuardRails {
  minWeight: bigint
  maxWeight: bigint
  maxWeightChangeBps: number
  minUpdateIntervalSeconds: number
}

export interface TFMMWeightUpdate {
  pool: Address
  oldWeights: bigint[]
  newWeights: bigint[]
  blocksToTarget: bigint
  timestamp: number
  blockNumber: bigint
  txHash: string
}
export type StrategyType =
  | 'dex-arbitrage'
  | 'cross-chain-arbitrage'
  | 'tfmm-rebalancer'
  | 'yield-farming'
  | 'liquidity-manager'
  | 'solver'
  | 'oracle-keeper'

export interface StrategyConfig {
  type: StrategyType
  enabled: boolean
  minProfitBps: number
  maxSlippageBps: number
  maxGasGwei: number
  maxPositionSizeUsd?: number
}

export interface TFMMStrategyConfig extends StrategyConfig {
  type: 'tfmm-rebalancer'
  updateIntervalSeconds: number
  lookbackPeriodSeconds: number
  sensitivity: number
  ruleType: 'momentum' | 'mean-reversion' | 'volatility' | 'composite'
}
export type OpportunityStatus =
  | 'DETECTED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'

export interface ArbitrageOpportunity {
  id: string
  type: 'DEX_ARBITRAGE' | 'CROSS_CHAIN' | 'TRIANGULAR'
  chainId: EVMChainId
  inputToken: Token
  outputToken: Token
  path: Pool[]
  inputAmount: string
  expectedOutput: string
  expectedProfit: string
  expectedProfitBps: number
  gasEstimate: string
  netProfitWei: string
  netProfitUsd: string
  detectedAt: number
  expiresAt: number
  status: OpportunityStatus
}

export interface CrossChainArbOpportunity extends ArbitrageOpportunity {
  type: 'CROSS_CHAIN'
  sourceChainId: EVMChainId | SolanaNetwork
  destChainId: EVMChainId | SolanaNetwork
  bridgeProtocol: string
  bridgeFee: string
  bridgeTime: number
}
export interface OraclePrice {
  token: string
  price: bigint
  decimals: number
  timestamp: number
  source: OracleSource
  confidence?: number
}

export type OracleSource =
  | 'chainlink'
  | 'pyth'
  | 'redstone'
  | 'uniswap-twap'
  | 'custom'
  | 'simulation'
  | 'historical'

export interface OracleConfig {
  token: string
  source: OracleSource
  feedAddress: string
  heartbeatSeconds: number
  deviationThresholdBps: number
}
export interface FeeConfig {
  swapFeeBps: number
  protocolFeeBps: number
  xlpFulfillmentFeeBps: number
  oifSolverFeeBps: number
  treasuryAddress: Address
  governanceAddress: Address
}
export interface RiskParameters {
  maxPositionSizeWei: bigint
  maxDailyLossWei: bigint
  maxSlippageBps: number
  maxGasPriceGwei: number
  minLiquidityUsd: number
  maxExposurePerProtocol: number
  maxExposurePerChain: number
  stopLossThresholdBps: number
}

export interface TFMMRiskParameters {
  minWeight: bigint
  maxWeight: bigint
  maxWeightChangeBps: number
  minUpdateIntervalBlocks: number
  oracleStalenessSeconds: number
  maxPriceDeviationBps: number
}
export interface BacktestResult {
  totalReturn: number
  annualizedReturn: number
  sharpeRatio: number
  maxDrawdown: number
  volatility: number
  winRate: number
  totalTrades: number
  totalFees: number
  impermanentLoss: number
  netProfit: number
  snapshots: PortfolioSnapshot[]
}

export interface PortfolioSnapshot {
  date: Date
  timestamp: number
  weights: number[]
  balances: bigint[]
  valueUsd: number
  cumulativeFeesUsd: number
  impermanentLossPercent: number
  rebalanceCount: number
}

export interface RiskMetrics {
  meanReturn: number
  stdDev: number
  var95: number
  var99: number
  cvar95: number
  maxDrawdown: number
  sharpeRatio: number
  sortinoRatio: number
  calmarRatio: number
  annualizedReturn?: number
  volatility?: number
  skewness?: number
  kurtosis?: number
}
export interface BotStats {
  uptime: number
  totalProfitUsd: number
  totalTrades: number
  successRate: number
  activeStrategies: StrategyType[]
  pendingOpportunities: number
  liquidityPositions: number
  tfmmPoolsManaged: number
  lastTradeAt: number
  lastWeightUpdate: number
}

export interface TradeResult {
  id: string
  strategy: StrategyType
  chainType: ChainType
  chainId: EVMChainId | SolanaNetwork
  txHash: string
  profitUsd: number
  gasUsed: bigint
  timestamp: number
  success: boolean
  error?: string
}
