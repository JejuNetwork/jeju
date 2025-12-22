/**
 * Core types for the Jeju Bots package
 * 
 * Supports EVM chains (Ethereum, Base, BSC, Arbitrum, Optimism) and Solana
 */

import type { Address } from 'viem';
import type { ChainType, EVMChainId, SolanaNetwork, BaseChainConfig, Token as SharedToken } from '@jejunetwork/types';

// ============ Chain Types ============
// Re-export consolidated chain types from @jejunetwork/types
export type { ChainType, EVMChainId, SolanaNetwork };

/**
 * Bot-specific chain configuration
 * Extends BaseChainConfig with bot-specific fields
 */
export interface ChainConfig extends BaseChainConfig {
  blockTimeMs: number;
  nativeCurrency: { symbol: string; decimals: number };
}

// ============ Token Types ============

/**
 * Token type for bots package
 * Compatible with SharedToken but allows SolanaNetwork chainId
 */
export interface Token {
  address: string;
  symbol: string;
  decimals: number;
  chainId: EVMChainId | SolanaNetwork | number;
  name?: string;
  logoUri?: string;
}

/**
 * Convert bots Token to shared Token type
 */
export function toSharedToken(token: Token): SharedToken {
  return {
    address: token.address as Address,
    name: token.name ?? token.symbol,
    symbol: token.symbol,
    decimals: token.decimals,
    chainId: typeof token.chainId === 'number' ? token.chainId : 1,
  };
}

export interface TokenPair {
  tokenA: Token;
  tokenB: Token;
  poolAddress?: string;
}

// ============ Pool Types ============

export interface Pool {
  address: string;
  chainId: EVMChainId;
  dex: DexProtocol;
  token0: Token;
  token1: Token;
  reserve0?: string;
  reserve1?: string;
  fee: number; // In basis points (e.g., 30 = 0.3%)
  lastUpdate?: number;
}

// Re-export consolidated DexProtocol
import type { DexProtocol } from '@jejunetwork/types';
export type { DexProtocol };

// ============ TFMM Types ============

export interface TFMMPool extends Pool {
  dex: 'tfmm';
  tokens: Token[];
  weights: bigint[];
  targetWeights: bigint[];
  weightDeltas: bigint[];
  lastUpdateBlock: bigint;
  strategyRule: Address;
  oracles: Address[];
  guardRails: TFMMGuardRails;
}

export interface TFMMGuardRails {
  minWeight: bigint;           // Minimum weight per token (e.g., 5% = 5e16)
  maxWeight: bigint;           // Maximum weight per token (e.g., 95% = 95e16)
  maxWeightChangeBps: number;  // Max change per update in bps
  minUpdateIntervalSeconds: number;
}

export interface TFMMWeightUpdate {
  pool: Address;
  oldWeights: bigint[];
  newWeights: bigint[];
  blocksToTarget: bigint;
  timestamp: number;
  blockNumber: bigint;
  txHash: string;
}

// ============ Strategy Types ============

export type StrategyType = 
  | 'dex-arbitrage'
  | 'cross-chain-arbitrage'
  | 'tfmm-rebalancer'
  | 'yield-farming'
  | 'liquidity-manager'
  | 'solver'
  | 'oracle-keeper';

export interface StrategyConfig {
  type: StrategyType;
  enabled: boolean;
  minProfitBps: number;
  maxSlippageBps: number;
  maxGasGwei: number;
  maxPositionSizeUsd?: number;
}

export interface TFMMStrategyConfig extends StrategyConfig {
  type: 'tfmm-rebalancer';
  updateIntervalSeconds: number;
  lookbackPeriodSeconds: number;
  sensitivity: number;        // 100 = 1x, 200 = 2x
  ruleType: 'momentum' | 'mean-reversion' | 'volatility' | 'composite';
}

// ============ Opportunity Types ============

export type OpportunityStatus = 'DETECTED' | 'EXECUTING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

export interface ArbitrageOpportunity {
  id: string;
  type: 'DEX_ARBITRAGE' | 'CROSS_CHAIN' | 'TRIANGULAR';
  chainId: EVMChainId;
  inputToken: Token;
  outputToken: Token;
  path: Pool[];
  inputAmount: string;
  expectedOutput: string;
  expectedProfit: string;
  expectedProfitBps: number;
  gasEstimate: string;
  netProfitWei: string;
  netProfitUsd: string;
  detectedAt: number;
  expiresAt: number;
  status: OpportunityStatus;
}

export interface CrossChainArbOpportunity extends ArbitrageOpportunity {
  type: 'CROSS_CHAIN';
  sourceChainId: EVMChainId | SolanaNetwork;
  destChainId: EVMChainId | SolanaNetwork;
  bridgeProtocol: string;
  bridgeFee: string;
  bridgeTime: number;
}

// ============ Oracle Types ============

export interface OraclePrice {
  token: string;
  price: bigint;          // Price in USD with 8 decimals
  decimals: number;
  timestamp: number;
  source: OracleSource;
  confidence?: number;    // For Pyth: 0-1 confidence interval
}

export type OracleSource = 'chainlink' | 'pyth' | 'redstone' | 'uniswap-twap' | 'custom' | 'simulation' | 'historical';

export interface OracleConfig {
  token: string;
  source: OracleSource;
  feedAddress: string;
  heartbeatSeconds: number;
  deviationThresholdBps: number;
}

// ============ Fee Configuration ============

export interface FeeConfig {
  swapFeeBps: number;           // Default swap fee (e.g., 30 = 0.3%)
  protocolFeeBps: number;       // Protocol share of fees (e.g., 1000 = 10%)
  xlpFulfillmentFeeBps: number; // Cross-chain fulfillment fee
  oifSolverFeeBps: number;      // OIF solver margin
  treasuryAddress: Address;
  governanceAddress: Address;   // Can modify fees
}

// ============ Risk Parameters ============

export interface RiskParameters {
  maxPositionSizeWei: bigint;
  maxDailyLossWei: bigint;
  maxSlippageBps: number;
  maxGasPriceGwei: number;
  minLiquidityUsd: number;
  maxExposurePerProtocol: number;  // Percentage 0-100
  maxExposurePerChain: number;     // Percentage 0-100
  stopLossThresholdBps: number;
}

export interface TFMMRiskParameters {
  minWeight: bigint;
  maxWeight: bigint;
  maxWeightChangeBps: number;
  minUpdateIntervalBlocks: number;
  oracleStalenessSeconds: number;
  maxPriceDeviationBps: number;
}

// ============ Simulation Types ============

export interface BacktestResult {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  volatility: number;
  winRate: number;
  totalTrades: number;
  totalFees: number;
  impermanentLoss: number;
  netProfit: number;
  snapshots: PortfolioSnapshot[];
}

export interface PortfolioSnapshot {
  date: Date;
  timestamp: number;
  weights: number[];
  balances: bigint[];
  valueUsd: number;
  cumulativeFeesUsd: number;
  impermanentLossPercent: number;
  rebalanceCount: number;
}

export interface RiskMetrics {
  meanReturn: number;
  stdDev: number;
  var95: number;       // 95% Value at Risk
  var99: number;       // 99% Value at Risk
  cvar95: number;      // Conditional VaR (Expected Shortfall)
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  annualizedReturn?: number;
  volatility?: number;
  skewness?: number;
  kurtosis?: number;
}

// ============ Bot Stats ============

export interface BotStats {
  uptime: number;
  totalProfitUsd: number;
  totalTrades: number;
  successRate: number;
  activeStrategies: StrategyType[];
  pendingOpportunities: number;
  liquidityPositions: number;
  tfmmPoolsManaged: number;
  lastTradeAt: number;
  lastWeightUpdate: number;
}

export interface TradeResult {
  id: string;
  strategy: StrategyType;
  chainType: ChainType;
  chainId: EVMChainId | SolanaNetwork;
  txHash: string;
  profitUsd: number;
  gasUsed: bigint;
  timestamp: number;
  success: boolean;
  error?: string;
}

