/**
 * Bot Configuration
 *
 * Default configurations for all strategies, loaded from environment
 * and/or config files.
 */

import type { EVMChainId, FeeConfig, TFMMRiskParameters } from '../types'

// Re-export validated types from schemas
export type {
  CompositeStrategyConfig,
  CrossChainArbConfigValidated,
  MeanReversionStrategyConfig,
  MomentumStrategyConfig,
  VolatilityStrategyConfig,
} from '../schemas'

import { expectEVMChainId } from '../schemas'

// ============ Environment Loading ============

function getEnvWithDefault(key: string, defaultValue: string): string {
  const value = process.env[key]
  return value !== undefined ? value : defaultValue
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key]
  return value ? Number(value) : defaultValue
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]
  if (value === undefined) return defaultValue
  return value.toLowerCase() === 'true' || value === '1'
}

// ============ Chain Configuration ============

export interface ChainRpcConfig {
  chainId: EVMChainId
  rpcUrl: string
  wsUrl?: string
  blockTimeMs: number
}

export const CHAIN_CONFIGS: Partial<
  Record<EVMChainId, Omit<ChainRpcConfig, 'rpcUrl' | 'wsUrl'>>
> = {
  1: { chainId: 1, blockTimeMs: 12000 },
  8453: { chainId: 8453, blockTimeMs: 2000 },
  42161: { chainId: 42161, blockTimeMs: 250 },
  10: { chainId: 10, blockTimeMs: 2000 },
  56: { chainId: 56, blockTimeMs: 3000 },
  84532: { chainId: 84532, blockTimeMs: 2000 },
  11155111: { chainId: 11155111, blockTimeMs: 12000 },
  420690: { chainId: 420690, blockTimeMs: 1000 },
  420691: { chainId: 420691, blockTimeMs: 1000 },
  1337: { chainId: 1337, blockTimeMs: 1000 },
}

export function getChainConfig(chainId: EVMChainId): ChainRpcConfig {
  const base = CHAIN_CONFIGS[chainId]
  if (!base) {
    throw new Error(`No configuration for chain ${chainId}`)
  }
  const rpcEnvKey = `${chainId === 1 ? 'ETH' : chainId === 8453 ? 'BASE' : chainId === 42161 ? 'ARB' : chainId === 10 ? 'OP' : chainId === 56 ? 'BSC' : 'RPC'}_RPC_URL`
  const wsEnvKey = rpcEnvKey.replace('_RPC_', '_WS_')

  const rpcUrl = process.env[rpcEnvKey]
  if (!rpcUrl) {
    throw new Error(
      `Missing RPC URL: Set ${rpcEnvKey} environment variable for chain ${chainId}`,
    )
  }

  return {
    ...base,
    rpcUrl,
    wsUrl: process.env[wsEnvKey], // Optional WebSocket URL
  }
}

// ============ TFMM Configuration ============

export interface TFMMConfig {
  updateIntervalMs: number
  minConfidenceThreshold: number
  maxGasPriceGwei: number
  gasBuffer: number
  blocksToTarget: number
  riskParams: TFMMRiskParameters
}

export function getTFMMConfig(): TFMMConfig {
  return {
    updateIntervalMs: getEnvNumber('TFMM_UPDATE_INTERVAL_MS', 300000), // 5 minutes
    minConfidenceThreshold: getEnvNumber('TFMM_MIN_CONFIDENCE', 0.3),
    maxGasPriceGwei: getEnvNumber('TFMM_MAX_GAS_GWEI', 100),
    gasBuffer: getEnvNumber('TFMM_GAS_BUFFER', 1.2),
    blocksToTarget: getEnvNumber('TFMM_BLOCKS_TO_TARGET', 300),
    riskParams: {
      minWeight:
        BigInt(getEnvNumber('TFMM_MIN_WEIGHT_BPS', 500)) * BigInt(1e14), // 5% = 5e16
      maxWeight:
        BigInt(getEnvNumber('TFMM_MAX_WEIGHT_BPS', 9500)) * BigInt(1e14), // 95%
      maxWeightChangeBps: getEnvNumber('TFMM_MAX_WEIGHT_CHANGE_BPS', 500), // 5%
      minUpdateIntervalBlocks: getEnvNumber('TFMM_MIN_UPDATE_BLOCKS', 10),
      oracleStalenessSeconds: getEnvNumber('TFMM_ORACLE_STALENESS_SEC', 60),
      maxPriceDeviationBps: getEnvNumber('TFMM_MAX_PRICE_DEVIATION_BPS', 500),
    },
  }
}

// ============ Strategy Configuration ============
// Types imported from schemas.ts via Zod inference

import type {
  CompositeStrategyConfig,
  MeanReversionStrategyConfig,
  MomentumStrategyConfig,
  VolatilityStrategyConfig,
} from '../schemas'

export function getMomentumConfig(): MomentumStrategyConfig {
  return {
    lookbackPeriodMs: getEnvNumber(
      'MOMENTUM_LOOKBACK_MS',
      7 * 24 * 60 * 60 * 1000,
    ),
    shortTermPeriodMs: getEnvNumber(
      'MOMENTUM_SHORT_TERM_MS',
      24 * 60 * 60 * 1000,
    ),
    sensitivity: getEnvNumber('MOMENTUM_SENSITIVITY', 1.0),
    momentumThresholdBps: getEnvNumber('MOMENTUM_THRESHOLD_BPS', 50),
    useEMA: getEnvBoolean('MOMENTUM_USE_EMA', true),
  }
}

export function getMeanReversionConfig(): MeanReversionStrategyConfig {
  return {
    lookbackPeriodMs: getEnvNumber(
      'MEAN_REV_LOOKBACK_MS',
      14 * 24 * 60 * 60 * 1000,
    ),
    deviationThreshold: getEnvNumber('MEAN_REV_DEVIATION_THRESHOLD', 1.5),
    sensitivity: getEnvNumber('MEAN_REV_SENSITIVITY', 1.0),
    useBollinger: getEnvBoolean('MEAN_REV_USE_BOLLINGER', true),
    bollingerMultiplier: getEnvNumber('MEAN_REV_BOLLINGER_MULT', 2.0),
  }
}

export function getVolatilityConfig(): VolatilityStrategyConfig {
  return {
    lookbackPeriodMs: getEnvNumber('VOL_LOOKBACK_MS', 30 * 24 * 60 * 60 * 1000),
    targetVolatilityPct: getEnvNumber('VOL_TARGET_PCT', 15),
    maxVolatilityPct: getEnvNumber('VOL_MAX_PCT', 100),
    useInverseVolWeighting: getEnvBoolean('VOL_INVERSE_WEIGHTING', true),
  }
}

export function getCompositeConfig(): CompositeStrategyConfig {
  return {
    momentumWeight: getEnvNumber('COMPOSITE_MOMENTUM_WEIGHT', 0.4),
    meanReversionWeight: getEnvNumber('COMPOSITE_MEAN_REV_WEIGHT', 0.3),
    volatilityWeight: getEnvNumber('COMPOSITE_VOL_WEIGHT', 0.3),
    enableRegimeDetection: getEnvBoolean('COMPOSITE_REGIME_DETECTION', true),
    minConfidenceThreshold: getEnvNumber('COMPOSITE_MIN_CONFIDENCE', 0.3),
  }
}

// ============ Cross-Chain Arbitrage Configuration ============
// Note: CrossChainArbConfig includes enabledChains as EVMChainId[] (local type)
// The validated schema type is CrossChainArbConfigValidated from schemas.ts

export interface CrossChainArbConfig {
  minProfitBps: number
  minProfitUsd: number
  maxSlippageBps: number
  maxPositionUsd: number
  bridgeTimeoutSeconds: number
  enabledChains: EVMChainId[]
  enableExecution: boolean
}

export function getCrossChainArbConfig(): CrossChainArbConfig {
  const enabledChainsStr = getEnvWithDefault(
    'CROSS_CHAIN_ENABLED_CHAINS',
    '1,8453,42161,10,56',
  )
  const enabledChains = enabledChainsStr
    .split(',')
    .map((s) => Number(s.trim()) as EVMChainId)

  return {
    minProfitBps: getEnvNumber('CROSS_CHAIN_MIN_PROFIT_BPS', 50),
    minProfitUsd: getEnvNumber('CROSS_CHAIN_MIN_PROFIT_USD', 10),
    maxSlippageBps: getEnvNumber('CROSS_CHAIN_MAX_SLIPPAGE_BPS', 100),
    maxPositionUsd: getEnvNumber('CROSS_CHAIN_MAX_POSITION_USD', 50000),
    bridgeTimeoutSeconds: getEnvNumber('CROSS_CHAIN_BRIDGE_TIMEOUT_SEC', 300),
    enabledChains,
    enableExecution: getEnvBoolean('CROSS_CHAIN_ENABLE_EXECUTION', false),
  }
}

// ============ Fee Configuration ============

export interface DefaultFeeConfig {
  standard: FeeConfig
  stable: FeeConfig
  premium: FeeConfig
  experimental: FeeConfig
}

export function getDefaultFees(): DefaultFeeConfig {
  return {
    standard: {
      swapFeeBps: getEnvNumber('FEE_STANDARD_SWAP_BPS', 30),
      protocolFeeBps: getEnvNumber('FEE_STANDARD_PROTOCOL_BPS', 1000),
      xlpFulfillmentFeeBps: getEnvNumber('FEE_XLP_FULFILLMENT_BPS', 10),
      oifSolverFeeBps: getEnvNumber('FEE_OIF_SOLVER_BPS', 5),
      treasuryAddress: getEnvWithDefault(
        'TREASURY_ADDRESS',
        '0x0000000000000000000000000000000000000000',
      ) as `0x${string}`,
      governanceAddress: getEnvWithDefault(
        'GOVERNANCE_ADDRESS',
        '0x0000000000000000000000000000000000000000',
      ) as `0x${string}`,
    },
    stable: {
      swapFeeBps: getEnvNumber('FEE_STABLE_SWAP_BPS', 5),
      protocolFeeBps: getEnvNumber('FEE_STABLE_PROTOCOL_BPS', 1000),
      xlpFulfillmentFeeBps: 5,
      oifSolverFeeBps: 3,
      treasuryAddress: getEnvWithDefault(
        'TREASURY_ADDRESS',
        '0x0000000000000000000000000000000000000000',
      ) as `0x${string}`,
      governanceAddress: getEnvWithDefault(
        'GOVERNANCE_ADDRESS',
        '0x0000000000000000000000000000000000000000',
      ) as `0x${string}`,
    },
    premium: {
      swapFeeBps: getEnvNumber('FEE_PREMIUM_SWAP_BPS', 50),
      protocolFeeBps: getEnvNumber('FEE_PREMIUM_PROTOCOL_BPS', 1500),
      xlpFulfillmentFeeBps: 15,
      oifSolverFeeBps: 8,
      treasuryAddress: getEnvWithDefault(
        'TREASURY_ADDRESS',
        '0x0000000000000000000000000000000000000000',
      ) as `0x${string}`,
      governanceAddress: getEnvWithDefault(
        'GOVERNANCE_ADDRESS',
        '0x0000000000000000000000000000000000000000',
      ) as `0x${string}`,
    },
    experimental: {
      swapFeeBps: getEnvNumber('FEE_EXPERIMENTAL_SWAP_BPS', 100),
      protocolFeeBps: getEnvNumber('FEE_EXPERIMENTAL_PROTOCOL_BPS', 2000),
      xlpFulfillmentFeeBps: 20,
      oifSolverFeeBps: 10,
      treasuryAddress: getEnvWithDefault(
        'TREASURY_ADDRESS',
        '0x0000000000000000000000000000000000000000',
      ) as `0x${string}`,
      governanceAddress: getEnvWithDefault(
        'GOVERNANCE_ADDRESS',
        '0x0000000000000000000000000000000000000000',
      ) as `0x${string}`,
    },
  }
}

// ============ Bot Engine Configuration ============

export interface FullBotConfig {
  chainId: EVMChainId
  rpcUrl: string
  privateKey: string
  tfmm: TFMMConfig
  momentum: MomentumStrategyConfig
  meanReversion: MeanReversionStrategyConfig
  volatility: VolatilityStrategyConfig
  composite: CompositeStrategyConfig
  crossChain: CrossChainArbConfig
  fees: DefaultFeeConfig
}

export function loadFullConfig(): FullBotConfig {
  const chainId = expectEVMChainId(getEnvNumber('CHAIN_ID', 8453), 'CHAIN_ID')
  const chainConfig = getChainConfig(chainId)
  const privateKey = process.env.PRIVATE_KEY

  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required')
  }

  return {
    chainId,
    rpcUrl: chainConfig.rpcUrl,
    privateKey,
    tfmm: getTFMMConfig(),
    momentum: getMomentumConfig(),
    meanReversion: getMeanReversionConfig(),
    volatility: getVolatilityConfig(),
    composite: getCompositeConfig(),
    crossChain: getCrossChainArbConfig(),
    fees: getDefaultFees(),
  }
}
