/**
 * @fileoverview Autocrat MEV Bot Type Definitions
 *
 * Core types for the MEV/arbitrage bot system including:
 * - Strategy configurations
 * - Opportunity detection
 * - Execution parameters
 * - Treasury management
 */

import { z } from 'zod';

// ============ Chain Configuration ============

export const ChainIdSchema = z.union([
  z.literal(1),        // Ethereum Mainnet
  z.literal(11155111), // Sepolia
  z.literal(42161),    // Arbitrum One
  z.literal(421614),   // Arbitrum Sepolia
  z.literal(10),       // Optimism
  z.literal(11155420), // OP Sepolia
  z.literal(8453),     // Base
  z.literal(84532),    // Base Sepolia
  z.literal(56),       // BSC
  z.literal(97),       // BSC Testnet
  z.literal(1337),     // Localnet
  z.literal(420691),   // Jeju Mainnet
  z.literal(420690),   // Jeju Testnet
]);
export type ChainId = z.infer<typeof ChainIdSchema>;

export const ChainConfigSchema = z.object({
  chainId: ChainIdSchema,
  name: z.string(),
  rpcUrl: z.string(),
  wsUrl: z.string().optional(),
  blockTime: z.number(), // Average block time in ms
  isL2: z.boolean(),
  nativeSymbol: z.string(),
  explorerUrl: z.string().optional(),
});
export type ChainConfig = z.infer<typeof ChainConfigSchema>;

// ============ Token & Pool Types ============

export const TokenSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  decimals: z.number(),
  chainId: ChainIdSchema,
});
export type Token = z.infer<typeof TokenSchema>;

export const PoolTypeSchema = z.enum(['XLP_V2', 'XLP_V3', 'UNISWAP_V2', 'UNISWAP_V3', 'CURVE']);
export type PoolType = z.infer<typeof PoolTypeSchema>;

export const PoolSchema = z.object({
  address: z.string(),
  type: PoolTypeSchema,
  token0: TokenSchema,
  token1: TokenSchema,
  chainId: ChainIdSchema,
  fee: z.number().optional(),        // Fee in basis points (V3)
  tickSpacing: z.number().optional(), // V3 tick spacing
  reserve0: z.string().optional(),
  reserve1: z.string().optional(),
  sqrtPriceX96: z.string().optional(), // V3 price
  liquidity: z.string().optional(),
  lastUpdate: z.number().optional(),
});
export type Pool = z.infer<typeof PoolSchema>;

// ============ Strategy Types ============

export const StrategyTypeSchema = z.enum([
  'DEX_ARBITRAGE',
  'CROSS_CHAIN_ARBITRAGE',
  'SANDWICH',
  'LIQUIDATION',
  'SOLVER',
  'ORACLE_KEEPER',
]);
export type StrategyType = z.infer<typeof StrategyTypeSchema>;

export const StrategyConfigSchema = z.object({
  type: StrategyTypeSchema,
  enabled: z.boolean(),
  minProfitBps: z.number(),        // Minimum profit in basis points
  maxGasGwei: z.number(),          // Max gas price
  maxSlippageBps: z.number(),      // Max slippage tolerance
  cooldownMs: z.number().optional(), // Cooldown between executions
});
export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;

// ============ Opportunity Types ============

export const OpportunityStatusSchema = z.enum([
  'DETECTED',
  'SIMULATING',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
]);
export type OpportunityStatus = z.infer<typeof OpportunityStatusSchema>;

export const ArbitrageOpportunitySchema = z.object({
  id: z.string(),
  type: z.literal('DEX_ARBITRAGE'),
  chainId: ChainIdSchema,
  inputToken: TokenSchema,
  outputToken: TokenSchema,
  path: z.array(PoolSchema),
  inputAmount: z.string(),
  expectedOutput: z.string(),
  expectedProfit: z.string(),
  expectedProfitBps: z.number(),
  gasEstimate: z.string(),
  netProfitWei: z.string(),
  netProfitUsd: z.string(),
  detectedAt: z.number(),
  expiresAt: z.number(),
  status: OpportunityStatusSchema,
});
export type ArbitrageOpportunity = z.infer<typeof ArbitrageOpportunitySchema>;

export const CrossChainArbOpportunitySchema = z.object({
  id: z.string(),
  type: z.literal('CROSS_CHAIN_ARBITRAGE'),
  sourceChainId: ChainIdSchema,
  destChainId: ChainIdSchema,
  token: TokenSchema,
  sourcePrice: z.string(),
  destPrice: z.string(),
  priceDiffBps: z.number(),
  inputAmount: z.string(),
  expectedProfit: z.string(),
  bridgeCost: z.string(),
  netProfitWei: z.string(),
  netProfitUsd: z.string(),
  detectedAt: z.number(),
  expiresAt: z.number(),
  status: OpportunityStatusSchema,
});
export type CrossChainArbOpportunity = z.infer<typeof CrossChainArbOpportunitySchema>;

export const SandwichOpportunitySchema = z.object({
  id: z.string(),
  type: z.literal('SANDWICH'),
  chainId: ChainIdSchema,
  victimTx: z.object({
    hash: z.string(),
    from: z.string(),
    to: z.string(),
    value: z.string(),
    gasPrice: z.string(),
    input: z.string(),
  }),
  pool: PoolSchema,
  frontrunTx: z.object({
    amountIn: z.string(),
    amountOutMin: z.string(),
    path: z.array(z.string()),
  }),
  backrunTx: z.object({
    amountIn: z.string(),
    amountOutMin: z.string(),
    path: z.array(z.string()),
  }),
  expectedProfit: z.string(),
  victimImpactBps: z.number(),
  detectedAt: z.number(),
  status: OpportunityStatusSchema,
});
export type SandwichOpportunity = z.infer<typeof SandwichOpportunitySchema>;

export const LiquidationOpportunitySchema = z.object({
  id: z.string(),
  type: z.literal('LIQUIDATION'),
  chainId: ChainIdSchema,
  protocol: z.enum(['PERPETUAL_MARKET', 'COMPOUND_V3', 'AAVE']),
  positionId: z.string(),
  borrower: z.string(),
  collateralToken: TokenSchema,
  debtToken: TokenSchema,
  collateralAmount: z.string(),
  debtAmount: z.string(),
  healthFactor: z.string(),
  liquidationBonus: z.string(),
  expectedProfit: z.string(),
  gasEstimate: z.string(),
  netProfitWei: z.string(),
  detectedAt: z.number(),
  status: OpportunityStatusSchema,
});
export type LiquidationOpportunity = z.infer<typeof LiquidationOpportunitySchema>;

export type Opportunity = 
  | ArbitrageOpportunity 
  | CrossChainArbOpportunity 
  | SandwichOpportunity 
  | LiquidationOpportunity;

// ============ Execution Types ============

export const ExecutionResultSchema = z.object({
  opportunityId: z.string(),
  success: z.boolean(),
  txHash: z.string().optional(),
  blockNumber: z.number().optional(),
  gasUsed: z.string().optional(),
  actualProfit: z.string().optional(),
  error: z.string().optional(),
  executedAt: z.number(),
  durationMs: z.number(),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

// ============ Treasury Types ============

// Note: Aligns with StrategyType for consistent metrics tracking
export const ProfitSourceSchema = z.enum([
  'DEX_ARBITRAGE',
  'CROSS_CHAIN_ARBITRAGE',
  'SANDWICH',
  'LIQUIDATION',
  'SOLVER',
  'ORACLE_KEEPER',
  'OTHER',
]);
export type ProfitSource = z.infer<typeof ProfitSourceSchema>;

export const ProfitDepositSchema = z.object({
  token: z.string(),
  amount: z.string(),
  source: ProfitSourceSchema,
  txHash: z.string(),
  timestamp: z.number(),
  operator: z.string(),
});
export type ProfitDeposit = z.infer<typeof ProfitDepositSchema>;

export const TreasuryStatsSchema = z.object({
  totalProfitsByToken: z.record(z.string(), z.string()),
  totalProfitsBySource: z.record(ProfitSourceSchema, z.string()),
  totalDeposits: z.number(),
  recentDeposits: z.array(ProfitDepositSchema),
  distributionConfig: z.object({
    protocolBps: z.number(),
    stakersBps: z.number(),
    insuranceBps: z.number(),
    operatorBps: z.number(),
  }),
});
export type TreasuryStats = z.infer<typeof TreasuryStatsSchema>;

// ============ Block Builder Types ============

export const AccessTierSchema = z.enum(['NONE', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM']);
export type AccessTier = z.infer<typeof AccessTierSchema>;

export const BundleStatusSchema = z.enum(['PENDING', 'INCLUDED', 'FAILED', 'EXPIRED', 'REFUNDED']);
export type BundleStatus = z.infer<typeof BundleStatusSchema>;

export const BundleSubmissionSchema = z.object({
  bundleId: z.string(),
  builderId: z.number(),
  targetBlock: z.number(),
  bidAmount: z.string(),
  bundleHash: z.string(),
  maxGasPrice: z.string(),
  transactions: z.array(z.object({
    to: z.string(),
    data: z.string(),
    value: z.string(),
    gasLimit: z.string(),
  })),
  status: BundleStatusSchema,
  submittedAt: z.number(),
});
export type BundleSubmission = z.infer<typeof BundleSubmissionSchema>;

// ============ Autocrat Configuration ============

export const AutocratConfigSchema = z.object({
  // Chain configuration
  chains: z.array(ChainConfigSchema),
  primaryChainId: ChainIdSchema,
  
  // Wallet
  privateKey: z.string().optional(),
  treasuryAddress: z.string(),
  
  // Strategy configs
  strategies: z.array(StrategyConfigSchema),
  
  // Global settings
  minProfitUsd: z.number(),
  maxConcurrentExecutions: z.number(),
  simulationTimeout: z.number(),
  
  // Gas settings
  maxGasGwei: z.number(),
  gasPriceMultiplier: z.number(),
  
  // Monitoring
  metricsPort: z.number(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
});
export type AutocratConfig = z.infer<typeof AutocratConfigSchema>;

// ============ Metrics Types ============

export const MetricsSchema = z.object({
  opportunitiesDetected: z.number(),
  opportunitiesExecuted: z.number(),
  opportunitiesFailed: z.number(),
  totalProfitWei: z.string(),
  totalProfitUsd: z.string(),
  totalGasSpent: z.string(),
  avgExecutionTimeMs: z.number(),
  uptime: z.number(),
  lastUpdate: z.number(),
  byStrategy: z.record(StrategyTypeSchema, z.object({
    detected: z.number(),
    executed: z.number(),
    failed: z.number(),
    profitWei: z.string(),
  })),
});
export type Metrics = z.infer<typeof MetricsSchema>;
