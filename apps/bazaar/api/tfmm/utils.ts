/**
 * TFMM utility functions for business logic
 * Shared between API routes and hooks
 *
 * Fetches pool data from:
 * 1. Indexer GraphQL API (primary source)
 * 2. contracts.json config (fallback for freshly deployed pools)
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getL2RpcUrl, getIndexerGraphqlUrl } from '@jejunetwork/config'
import { getDeployerKey } from '../../lib/secrets'
import { AddressSchema, expect } from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  http,
} from 'viem'
import { jeju, jejuLocalnet } from '../../config/chains'
import type {
  TFMMCreatePoolParams,
  TFMMTriggerRebalanceParams,
  TFMMUpdateStrategyParams,
} from '../../schemas/api'

export interface TFMMPool {
  address: string
  name: string
  symbol: string
  strategy: string
  tokens: string[]
  weights: number[]
  targetWeights: number[]
  tvl: string
  tvlUSD: string
  apy: string
  volume24h: string
  totalSupply: string
  swapFeeBps: number
}

export interface TFMMStrategy {
  type: string
  name: string
  description: string
  params: Record<string, number>
  performance: {
    return30d: number
    sharpe: number
    maxDrawdown: number
    winRate: number
  }
}

export interface OracleStatus {
  pythAvailable: boolean
  chainlinkAvailable: boolean
  twapAvailable: boolean
  currentSource: string
  lastUpdate: number
  price: string
}

// Available strategy types with default parameters
const AVAILABLE_STRATEGIES: TFMMStrategy[] = [
  {
    type: 'momentum',
    name: 'Momentum',
    description: 'Allocates more to assets with positive price momentum',
    params: { lookbackPeriod: 7, updateFrequency: 24, maxWeightChange: 5 },
    performance: { return30d: 0, sharpe: 0, maxDrawdown: 0, winRate: 0 },
  },
  {
    type: 'mean_reversion',
    name: 'Mean Reversion',
    description: 'Rebalances when assets deviate from historical averages',
    params: { deviationThreshold: 10, lookbackPeriod: 30, updateFrequency: 12 },
    performance: { return30d: 0, sharpe: 0, maxDrawdown: 0, winRate: 0 },
  },
  {
    type: 'trend_following',
    name: 'Trend Following',
    description: 'Follows medium-term price trends using moving averages',
    params: { shortMA: 7, longMA: 21, updateFrequency: 6, maxWeightChange: 10 },
    performance: { return30d: 0, sharpe: 0, maxDrawdown: 0, winRate: 0 },
  },
  {
    type: 'volatility_targeting',
    name: 'Volatility Targeting',
    description: 'Adjusts allocations to maintain target portfolio volatility',
    params: { targetVolatility: 15, lookbackPeriod: 30, updateFrequency: 24 },
    performance: { return30d: 0, sharpe: 0, maxDrawdown: 0, winRate: 0 },
  },
]

// Contract ABIs
const TFMM_POOL_ABI = [
  {
    name: 'getPoolState',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: 'state',
        type: 'tuple',
        components: [
          { name: 'tokens', type: 'address[]' },
          { name: 'balances', type: 'uint256[]' },
          { name: 'currentWeights', type: 'uint256[]' },
          { name: 'targetWeights', type: 'uint256[]' },
          { name: 'weightDeltas', type: 'int256[]' },
          { name: 'lastUpdateBlock', type: 'uint256' },
          { name: 'swapFeeBps', type: 'uint256' },
          { name: 'totalSupply', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'strategyRule',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'setStrategyRule',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newRule', type: 'address' }],
    outputs: [],
  },
  {
    name: 'updateWeights',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'newWeights', type: 'uint256[]' },
      { name: 'blocksToTarget', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

const ORACLE_REGISTRY_ABI = [
  {
    name: 'getPrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: 'price', type: 'uint256' }],
  },
  {
    name: 'getOracleConfig',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'feed', type: 'address' },
          { name: 'heartbeat', type: 'uint256' },
          { name: 'decimals', type: 'uint8' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
  {
    name: 'getOracleType',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'pyth',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'twapOracle',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

const WEIGHT_UPDATE_RUNNER_ABI = [
  {
    name: 'performUpdate',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [],
  },
  {
    name: 'canUpdate',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'pools',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'pool', type: 'address' }],
    outputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'strategyRule', type: 'address' },
          { name: 'oracles', type: 'address[]' },
          { name: 'updateIntervalSec', type: 'uint256' },
          { name: 'lastUpdate', type: 'uint256' },
          { name: 'blocksToTarget', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
  },
] as const

interface IndexerTFMMPoolRaw {
  id: string
  address: string
  name: string
  symbol: string
  tokens: string[]
  currentWeights: string[]
  targetWeights: string[]
  tvl: string
  tvlUSD: string
  volume24h: string
  volumeUSD24h: string
  totalSupply: string
  swapFeeBps: number
  apy: string | null
  strategyRule: string | null
}

// Formatting utilities
function formatNumber(num: number): string {
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`
  return `$${num.toFixed(2)}`
}

function parseFormattedValue(formatted: string): number {
  const clean = formatted.replace(/[$,]/g, '')
  if (clean.endsWith('M')) return parseFloat(clean) * 1e6
  if (clean.endsWith('K')) return parseFloat(clean) * 1e3
  return parseFloat(clean) || 0
}

function getNetworkConfig(): {
  rpcUrl: string
  isLocalnet: boolean
  oracleRegistry: string | null
  weightUpdateRunner: string | null
} {
  const rpcUrl = getL2RpcUrl()
  const isLocalnet = rpcUrl.includes('localhost') || rpcUrl.includes('127.0.0.1')

  // Load contracts.json
  const configPath = join(
    import.meta.dirname,
    '../../../../packages/config/contracts.json',
  )

  if (!existsSync(configPath)) {
    return { rpcUrl, isLocalnet, oracleRegistry: null, weightUpdateRunner: null }
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  const network = isLocalnet ? config.localnet : config.testnet

  return {
    rpcUrl,
    isLocalnet,
    oracleRegistry: network?.oracle?.oracleRegistry || null,
    weightUpdateRunner: network?.amm?.weightUpdateRunner || null,
  }
}

/**
 * Get all TFMM pools
 */
export async function getAllTFMMPools(): Promise<TFMMPool[]> {
  const indexerPools = await fetchPoolsFromIndexer()
  if (indexerPools.length > 0) {
    return indexerPools
  }
  return await fetchPoolsFromConfig()
}

async function fetchPoolsFromIndexer(): Promise<TFMMPool[]> {
  const indexerUrl = getIndexerGraphqlUrl()

  const response = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query GetTFMMPools {
          tfmMPools(orderBy: tvlUSD_DESC, limit: 100) {
            id
            address
            name
            symbol
            tokens
            currentWeights
            targetWeights
            tvl
            tvlUSD
            volume24h
            volumeUSD24h
            totalSupply
            swapFeeBps
            apy
            strategyRule
          }
        }
      `,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)

  if (!response?.ok) {
    return []
  }

  const json = (await response.json()) as {
    data?: { tfmMPools: IndexerTFMMPoolRaw[] }
    errors?: { message: string }[]
  }

  if (json.errors?.length) {
    console.warn('[TFMM] Indexer error:', json.errors[0].message)
    return []
  }

  return (json.data?.tfmMPools ?? []).map((pool) => ({
    address: pool.address,
    name: pool.name,
    symbol: pool.symbol,
    strategy: pool.strategyRule ?? 'none',
    tokens: pool.tokens,
    weights: pool.currentWeights.map((w) => Number(BigInt(w)) / 1e16),
    targetWeights: pool.targetWeights.map((w) => Number(BigInt(w)) / 1e16),
    tvl: pool.tvl,
    tvlUSD: pool.tvlUSD,
    apy: pool.apy ?? '0%',
    volume24h: pool.volumeUSD24h,
    totalSupply: pool.totalSupply,
    swapFeeBps: pool.swapFeeBps,
  }))
}

async function fetchPoolsFromConfig(): Promise<TFMMPool[]> {
  const contractsDir = join(import.meta.dirname, '../../../../packages/contracts')
  const { rpcUrl, isLocalnet } = getNetworkConfig()
  const networkName = isLocalnet ? 'localnet' : 'testnet'
  const tfmmDeployPath = join(contractsDir, `deployments/tfmm-${networkName}.json`)

  if (!existsSync(tfmmDeployPath)) {
    return []
  }

  const deployData = JSON.parse(readFileSync(tfmmDeployPath, 'utf-8')) as {
    pools: Array<{
      address: string
      name: string
      symbol: string
      tokens: string[]
      weights?: string[]
      liquidity?: string[]
    }>
  }

  if (!deployData.pools?.length) {
    return []
  }

  const chain = isLocalnet ? jejuLocalnet : jeju
  const client = createPublicClient({ chain, transport: http(rpcUrl) })

  const pools: TFMMPool[] = []

  for (const deployedPool of deployData.pools) {
    const poolState = await client
      .readContract({
        address: deployedPool.address as Address,
        abi: TFMM_POOL_ABI,
        functionName: 'getPoolState',
      })
      .catch(() => null)

    if (!poolState) continue

    const state = poolState as {
      tokens: readonly Address[]
      balances: readonly bigint[]
      currentWeights: readonly bigint[]
      targetWeights: readonly bigint[]
      weightDeltas: readonly bigint[]
      lastUpdateBlock: bigint
      swapFeeBps: bigint
      totalSupply: bigint
    }

    const totalBalance = state.balances.reduce((sum, b) => sum + b, 0n)
    const tvlFormatted = formatNumber(Number(totalBalance) / 1e18)

    // Try to get strategy rule
    const strategyRule = await client
      .readContract({
        address: deployedPool.address as Address,
        abi: TFMM_POOL_ABI,
        functionName: 'strategyRule',
      })
      .catch(() => null)

    pools.push({
      address: deployedPool.address,
      name: deployedPool.name,
      symbol: deployedPool.symbol,
      strategy:
        strategyRule && strategyRule !== '0x0000000000000000000000000000000000000000'
          ? (strategyRule as string)
          : 'none',
      tokens: [...state.tokens],
      weights: state.currentWeights.map((w) => Number(w) / 1e16),
      targetWeights: state.targetWeights.map((w) => Number(w) / 1e16),
      tvl: tvlFormatted,
      tvlUSD: tvlFormatted,
      apy: '0%',
      volume24h: '$0',
      totalSupply: state.totalSupply.toString(),
      swapFeeBps: Number(state.swapFeeBps),
    })
  }

  return pools
}

/**
 * Get a specific pool by address
 */
export async function getTFMMPool(poolAddress: string): Promise<TFMMPool | null> {
  AddressSchema.parse(poolAddress)
  const allPools = await getAllTFMMPools()
  return (
    allPools.find((p) => p.address.toLowerCase() === poolAddress.toLowerCase()) ??
    null
  )
}

/**
 * Get all available strategies
 */
export function getTFMMStrategies(): TFMMStrategy[] {
  return AVAILABLE_STRATEGIES
}

/**
 * Get oracle status for tokens - queries OracleRegistry contract
 */
export async function getOracleStatus(
  tokenAddresses: string[],
): Promise<Record<string, OracleStatus>> {
  const { rpcUrl, isLocalnet, oracleRegistry } = getNetworkConfig()

  if (!oracleRegistry) {
    // OracleRegistry not deployed - return placeholder
    const result: Record<string, OracleStatus> = {}
    for (const token of tokenAddresses) {
      result[token] = {
        pythAvailable: false,
        chainlinkAvailable: false,
        twapAvailable: false,
        currentSource: 'none',
        lastUpdate: 0,
        price: '0',
      }
    }
    return result
  }

  const chain = isLocalnet ? jejuLocalnet : jeju
  const client = createPublicClient({ chain, transport: http(rpcUrl) })

  // Check oracle sources
  const pythAddress = await client
    .readContract({
      address: oracleRegistry as Address,
      abi: ORACLE_REGISTRY_ABI,
      functionName: 'pyth',
    })
    .catch(() => null)

  const twapAddress = await client
    .readContract({
      address: oracleRegistry as Address,
      abi: ORACLE_REGISTRY_ABI,
      functionName: 'twapOracle',
    })
    .catch(() => null)

  const pythAvailable =
    pythAddress !== null &&
    pythAddress !== '0x0000000000000000000000000000000000000000'
  const twapAvailable =
    twapAddress !== null &&
    twapAddress !== '0x0000000000000000000000000000000000000000'

  const result: Record<string, OracleStatus> = {}

  for (const token of tokenAddresses) {
    const oracleConfig = await client
      .readContract({
        address: oracleRegistry as Address,
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'getOracleConfig',
        args: [token as Address],
      })
      .catch(() => null)

    const oracleType = await client
      .readContract({
        address: oracleRegistry as Address,
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'getOracleType',
        args: [token as Address],
      })
      .catch(() => null)

    const price = await client
      .readContract({
        address: oracleRegistry as Address,
        abi: ORACLE_REGISTRY_ABI,
        functionName: 'getPrice',
        args: [token as Address],
      })
      .catch(() => 0n)

    // OracleType enum: 0=CHAINLINK, 1=PYTH, 2=TWAP, 3=CUSTOM
    const typeNum = oracleType !== null ? Number(oracleType) : -1
    const sources = ['chainlink', 'pyth', 'twap', 'custom']
    const currentSource = typeNum >= 0 && typeNum < 4 ? sources[typeNum] : 'none'

    result[token] = {
      pythAvailable,
      chainlinkAvailable:
        (oracleConfig as { active: boolean } | null)?.active === true &&
        typeNum === 0,
      twapAvailable,
      currentSource,
      lastUpdate: Date.now(),
      price: (price as bigint).toString(),
    }
  }

  return result
}

/**
 * Create a new TFMM pool
 * Returns transaction data for wallet to sign
 */
export async function createTFMMPool(params: TFMMCreatePoolParams): Promise<{
  poolAddress?: string
  txData?: string
  message: string
}> {
  for (const token of params.tokens) {
    AddressSchema.parse(token)
  }
  expect(params.tokens.length >= 2, 'At least 2 tokens required')
  expect(params.tokens.length <= 8, 'Maximum 8 tokens allowed')

  // Use weights if provided, otherwise use initialWeights
  const weights = params.weights ?? params.initialWeights
  expect(weights.length === params.tokens.length, 'Weights must match tokens')

  // Validate weights sum to 100
  const weightSum = weights.reduce((a: number, b: number) => a + b, 0)
  expect(Math.abs(weightSum - 100) < 0.01, 'Weights must sum to 100')

  // Convert weights to 1e18 precision
  const weightsWei = weights.map((w: number) => BigInt(Math.floor(w * 1e16)))

  const { rpcUrl, isLocalnet } = getNetworkConfig()

  // For server-side deployment, use deployer key
  const deployerKey = getDeployerKey(rpcUrl)
  if (!deployerKey) {
    return {
      message:
        'Server-side deployment not available. Use CLI: jeju tfmm create-pool',
    }
  }

  const contractsDir = join(import.meta.dirname, '../../../../packages/contracts')

  // Build forge create command
  const tokensArg = `[${params.tokens.join(',')}]`
  const weightsArg = `[${weightsWei.join(',')}]`
  const swapFeeBps = params.swapFeeBps ?? 30
  const poolSymbol = params.symbol ?? 'TFMM-POOL'
  const poolName = params.name ?? poolSymbol

  // Get deployer address
  const deployer = execSync(`cast wallet address ${deployerKey}`, {
    encoding: 'utf-8',
  }).trim()

  const cmd = `cd ${contractsDir} && forge create src/amm/tfmm/TFMMPool.sol:TFMMPool \
    --rpc-url ${rpcUrl} \
    --private-key ${deployerKey} \
    --broadcast \
    --constructor-args "${poolName}" "${poolSymbol}" ${tokensArg} ${weightsArg} ${swapFeeBps} ${deployer} ${deployer}`

  const output = execSync(cmd, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  })

  const match = output.match(/Deployed to: (0x[a-fA-F0-9]{40})/)
  if (!match) {
    throw new Error('Failed to deploy pool')
  }

  const poolAddress = match[1]

  // Save to deployment file
  const networkName = isLocalnet ? 'localnet' : 'testnet'
  const deployPath = join(contractsDir, `deployments/tfmm-${networkName}.json`)

  let deployData = { pools: [] as Array<object> }
  if (existsSync(deployPath)) {
    deployData = JSON.parse(readFileSync(deployPath, 'utf-8'))
  }

  deployData.pools.push({
    address: poolAddress,
    name: poolName,
    symbol: poolSymbol,
    tokens: params.tokens,
    weights: weightsWei.map(String),
  })

  writeFileSync(deployPath, JSON.stringify(deployData, null, 2))

  // Update contracts.json
  const configPath = join(contractsDir, '../config/contracts.json')
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const network = isLocalnet ? 'localnet' : 'testnet'
    if (!config[network]) config[network] = {}
    if (!config[network].amm) config[network].amm = {}
    const key = `TFMMPool_${poolSymbol.replace('TFMM-', '').replace(/-/g, '_')}`
    config[network].amm[key] = poolAddress
    writeFileSync(configPath, JSON.stringify(config, null, 2))
  }

  return {
    poolAddress,
    message: `Pool ${poolName} deployed at ${poolAddress}`,
  }
}

/**
 * Update pool strategy
 * Returns transaction data for wallet to sign
 */
export async function updatePoolStrategy(params: TFMMUpdateStrategyParams): Promise<{
  txData: string
  to: Address
  message: string
}> {
  AddressSchema.parse(params.poolAddress)
  AddressSchema.parse(params.strategyRule)

  const txData = encodeFunctionData({
    abi: TFMM_POOL_ABI,
    functionName: 'setStrategyRule',
    args: [params.strategyRule as Address],
  })

  return {
    txData,
    to: params.poolAddress as Address,
    message: `Call setStrategyRule on pool ${params.poolAddress}`,
  }
}

/**
 * Trigger pool rebalance via WeightUpdateRunner
 */
export async function triggerPoolRebalance(
  params: TFMMTriggerRebalanceParams,
): Promise<{
  txData?: string
  txHash?: string
  to?: Address
  message: string
}> {
  AddressSchema.parse(params.poolAddress)

  const { rpcUrl, isLocalnet, weightUpdateRunner } = getNetworkConfig()

  if (!weightUpdateRunner) {
    // No WeightUpdateRunner deployed - return manual update tx
    const pool = await getTFMMPool(params.poolAddress)
    if (!pool) {
      throw new Error('Pool not found')
    }

    // Return updateWeights tx data for manual call
    const currentWeights = pool.weights.map((w) => BigInt(Math.floor(w * 1e16)))
    const txData = encodeFunctionData({
      abi: TFMM_POOL_ABI,
      functionName: 'updateWeights',
      args: [currentWeights, 10n],
    })

    return {
      txData,
      to: params.poolAddress as Address,
      message: 'WeightUpdateRunner not deployed. Use manual updateWeights call.',
    }
  }

  // Check if pool can be updated
  const chain = isLocalnet ? jejuLocalnet : jeju
  const client = createPublicClient({ chain, transport: http(rpcUrl) })

  const canUpdate = await client
    .readContract({
      address: weightUpdateRunner as Address,
      abi: WEIGHT_UPDATE_RUNNER_ABI,
      functionName: 'canUpdate',
      args: [params.poolAddress as Address],
    })
    .catch(() => false)

  if (!canUpdate) {
    return {
      message: 'Pool update not available yet (within update interval)',
    }
  }

  // Return performUpdate tx data
  const txData = encodeFunctionData({
    abi: WEIGHT_UPDATE_RUNNER_ABI,
    functionName: 'performUpdate',
    args: [params.poolAddress as Address],
  })

  return {
    txData,
    to: weightUpdateRunner as Address,
    message: 'Call performUpdate on WeightUpdateRunner',
  }
}

/**
 * Calculate aggregate stats for all pools
 */
export async function getTFMMStats(): Promise<{
  totalTvl: string
  totalVolume24h: string
  poolCount: number
  averageApy: string
}> {
  const pools = await getAllTFMMPools()

  let totalTvlNum = 0
  let totalVolumeNum = 0
  let totalApyNum = 0
  let apyCount = 0

  for (const pool of pools) {
    totalTvlNum += parseFormattedValue(pool.tvlUSD)
    totalVolumeNum += parseFormattedValue(pool.volume24h)

    const apyValue = parseFloat(pool.apy.replace('%', ''))
    if (!Number.isNaN(apyValue)) {
      totalApyNum += apyValue
      apyCount++
    }
  }

  const averageApy = apyCount > 0 ? (totalApyNum / apyCount).toFixed(2) : '0'

  return {
    totalTvl: formatNumber(totalTvlNum),
    totalVolume24h: formatNumber(totalVolumeNum),
    poolCount: pools.length,
    averageApy: `${averageApy}%`,
  }
}

/**
 * Calculate APY from swap fee revenue
 * Formula: APY = (feeRevenue24h * 365 / tvl) * 100
 */
export async function calculatePoolAPY(poolAddress: string): Promise<string> {
  const indexerUrl = getIndexerGraphqlUrl()

  // Query 24h swap volume from indexer
  const response = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `
        query GetPoolSwaps($poolId: String!) {
          tfmMSwaps(
            where: { pool: { id_eq: $poolId } }
            orderBy: timestamp_DESC
            limit: 1000
          ) {
            feeAmount
            timestamp
          }
        }
      `,
      variables: {
        poolId: poolAddress.toLowerCase(),
      },
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)

  if (!response?.ok) {
    return '0%'
  }

  const json = (await response.json()) as {
    data?: { tfmMSwaps: Array<{ feeAmount: string; timestamp: string }> }
  }

  if (!json.data?.tfmMSwaps?.length) {
    return '0%'
  }

  // Sum fees from last 24h
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
  let totalFees = 0n
  for (const swap of json.data.tfmMSwaps) {
    const swapTime = new Date(swap.timestamp).getTime()
    if (swapTime >= oneDayAgo) {
      totalFees += BigInt(swap.feeAmount)
    }
  }

  // Get TVL
  const pool = await getTFMMPool(poolAddress)
  if (!pool) {
    return '0%'
  }

  const tvl = parseFormattedValue(pool.tvlUSD)
  if (tvl === 0) {
    return '0%'
  }

  // Calculate APY: (feeRevenue24h * 365 / tvl) * 100
  const feeRevenue24h = Number(totalFees) / 1e18
  const apy = (feeRevenue24h * 365 / tvl) * 100

  return `${apy.toFixed(2)}%`
}
