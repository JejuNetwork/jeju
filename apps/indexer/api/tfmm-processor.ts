/**
 * TFMM (Temporal Function Market Maker) event processor
 *
 * Processes events from TFMMPool contracts:
 * - WeightsUpdated: Weight rebalancing events
 * - Swap: Token swap events
 * - LiquidityAdded: LP deposit events
 * - LiquidityRemoved: LP withdrawal events
 */

import type { Store } from '@subsquid/typeorm-store'
import type { Hex } from 'viem'
import { config } from './config'
import {
  TFMMLiquidityEvent,
  TFMMLiquidityEventType,
  TFMMPool,
  TFMMStats,
  TFMMSwap,
  TFMMWeightUpdate,
} from './model'
import type { ProcessorContext } from './processor'
import {
  type BlockHeader,
  createAccountFactory,
  type LogData,
} from './utils/entities'
import { decodeLogData, isEventInSet } from './utils/hex'

// TFMM Event topic signatures (keccak256 of event signatures)
// cast keccak "Swap(address,address,address,uint256,uint256,uint256)"
const SWAP_TOPIC: Hex =
  '0xd6d34547c69c5ee3d2667625c188acf1006abb93dc082a0d7e7ba9e9f4b28c5a'
// cast keccak "LiquidityAdded(address,uint256[],uint256)"
const LIQUIDITY_ADDED_TOPIC: Hex =
  '0x26f55a85081d24974e85c6c02c8d1e8a7c0b82f7a9d5e4c8e0c3f3c8e8c0c300'
// cast keccak "LiquidityRemoved(address,uint256[],uint256)"
const LIQUIDITY_REMOVED_TOPIC: Hex =
  '0x7084f5476618d8e60b11ef0d7d3f06914655adb8793e28ff7f018d4c76d505d5'
// cast keccak "WeightsUpdated(uint256[],uint256[],uint256,uint256)"
const WEIGHTS_UPDATED_TOPIC: Hex =
  '0x8d03c6c7fdd8b462fcc3a8c59dc2c0c2a6fe9dcf9e3f48c8e8c0c3f3c8e8c0c3'

const TFMM_TOPICS = new Set([
  SWAP_TOPIC,
  LIQUIDITY_ADDED_TOPIC,
  LIQUIDITY_REMOVED_TOPIC,
  WEIGHTS_UPDATED_TOPIC,
])

// Track known TFMM pool addresses (loaded from config or discovered)
const knownTFMMPools: Set<string> = new Set()

/**
 * Register a TFMM pool address for event processing
 */
export function registerTFMMPool(address: string): void {
  knownTFMMPools.add(address.toLowerCase())
}

/**
 * Check if an address is a known TFMM pool
 */
export function isTFMMPool(address: string): boolean {
  return knownTFMMPools.has(address.toLowerCase())
}

/**
 * Check if an event is a TFMM event
 */
export function isTFMMEvent(topic0: string): boolean {
  return isEventInSet(topic0, TFMM_TOPICS)
}

/**
 * Process TFMM events from blocks
 */
export async function processTFMMEvents(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const pools = new Map<string, TFMMPool>()
  const swaps = new Map<string, TFMMSwap>()
  const liquidityEvents = new Map<string, TFMMLiquidityEvent>()
  const weightUpdates = new Map<string, TFMMWeightUpdate>()

  const accountFactory = createAccountFactory()
  const chainId = config.chainId

  for (const block of ctx.blocks) {
    const header = block.header
    const timestamp = new Date(header.timestamp)

    for (const log of block.logs) {
      const topic0 = log.topics[0]
      if (!topic0) continue

      // Skip if not from a known TFMM pool
      const poolAddress = log.address.toLowerCase()
      if (!isTFMMPool(poolAddress)) continue

      // Skip if not a TFMM event
      if (!isTFMMEvent(topic0)) continue

      // Get or create pool
      const poolId = `${chainId}-${poolAddress}`
      const pool = pools.get(poolId) ?? (await ctx.store.get(TFMMPool, poolId))
      if (!pool) {
        // Pool not indexed yet - skip (will be indexed by discovery processor)
        continue
      }

      // Process based on event type
      if (topic0 === SWAP_TOPIC) {
        processSwap(log, header, timestamp, pool, swaps, accountFactory)
      } else if (topic0 === LIQUIDITY_ADDED_TOPIC) {
        processLiquidityAdded(
          log,
          header,
          timestamp,
          pool,
          liquidityEvents,
          accountFactory,
        )
      } else if (topic0 === LIQUIDITY_REMOVED_TOPIC) {
        processLiquidityRemoved(
          log,
          header,
          timestamp,
          pool,
          liquidityEvents,
          accountFactory,
        )
      } else if (topic0 === WEIGHTS_UPDATED_TOPIC) {
        processWeightsUpdated(log, header, timestamp, pool, weightUpdates)
      }

      // Update pool's lastUpdated
      pool.lastUpdated = timestamp
      pools.set(poolId, pool)
    }
  }

  // Batch save all entities
  if (pools.size > 0) {
    await ctx.store.upsert(Array.from(pools.values()))
  }
  if (swaps.size > 0) {
    await ctx.store.upsert(Array.from(swaps.values()))
    ctx.log.info(`Processed ${swaps.size} TFMM swaps`)
  }
  if (liquidityEvents.size > 0) {
    await ctx.store.upsert(Array.from(liquidityEvents.values()))
    ctx.log.info(`Processed ${liquidityEvents.size} TFMM liquidity events`)
  }
  if (weightUpdates.size > 0) {
    await ctx.store.upsert(Array.from(weightUpdates.values()))
    ctx.log.info(`Processed ${weightUpdates.size} TFMM weight updates`)
  }

  // Save accounts
  if (accountFactory.hasAccounts()) {
    await ctx.store.upsert(accountFactory.getAll())
  }
}

function processSwap(
  log: LogData,
  header: BlockHeader,
  timestamp: Date,
  pool: TFMMPool,
  swaps: Map<string, TFMMSwap>,
  accountFactory: ReturnType<typeof createAccountFactory>,
): void {
  // Decode: Swap(address indexed sender, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 feeAmount)
  // Indexed parameters are in topics, non-indexed in data
  const senderAddr = `0x${log.topics[1]?.slice(26) ?? ''}`
  const tokenIn = `0x${log.topics[2]?.slice(26) ?? ''}`
  const tokenOut = `0x${log.topics[3]?.slice(26) ?? ''}`

  const decoded = decodeLogData(
    [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'feeAmount', type: 'uint256' },
    ] as const,
    log.data,
  )

  const [amountIn, amountOut, feeAmount] = decoded

  const txHash = log.transactionHash
  const swapId = `${txHash}-${log.logIndex}`

  const sender = accountFactory.getOrCreate(
    senderAddr,
    header.height,
    timestamp,
  )

  const swap = new TFMMSwap({
    id: swapId,
    pool,
    sender,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut,
    feeAmount,
    timestamp,
    blockNumber: header.height,
    txHash,
    logIndex: log.logIndex,
  })

  swaps.set(swapId, swap)

  // Update pool stats
  pool.volume24h = (pool.volume24h ?? 0n) + amountIn
  pool.totalVolume = (pool.totalVolume ?? 0n) + amountIn
  pool.txCount = (pool.txCount ?? 0) + 1
}

function processLiquidityAdded(
  log: LogData,
  header: BlockHeader,
  timestamp: Date,
  pool: TFMMPool,
  liquidityEvents: Map<string, TFMMLiquidityEvent>,
  accountFactory: ReturnType<typeof createAccountFactory>,
): void {
  // Decode: LiquidityAdded(address indexed provider, uint256[] amounts, uint256 lpTokensMinted)
  const providerAddr = `0x${log.topics[1]?.slice(26) ?? ''}`

  const decoded = decodeLogData(
    [
      { name: 'amounts', type: 'uint256[]' },
      { name: 'lpTokensMinted', type: 'uint256' },
    ] as const,
    log.data,
  )

  const [amounts, lpTokensMinted] = decoded

  const txHash = log.transactionHash
  const eventId = `${txHash}-${log.logIndex}`

  const provider = accountFactory.getOrCreate(
    providerAddr,
    header.height,
    timestamp,
  )

  const event = new TFMMLiquidityEvent({
    id: eventId,
    pool,
    provider,
    eventType: TFMMLiquidityEventType.ADD,
    amounts: amounts as bigint[],
    lpTokens: lpTokensMinted,
    timestamp,
    blockNumber: header.height,
    txHash,
    logIndex: log.logIndex,
  })

  liquidityEvents.set(eventId, event)

  // Update pool total supply
  pool.totalSupply = (pool.totalSupply ?? 0n) + lpTokensMinted
  pool.lpProviderCount = (pool.lpProviderCount ?? 0) + 1
}

function processLiquidityRemoved(
  log: LogData,
  header: BlockHeader,
  timestamp: Date,
  pool: TFMMPool,
  liquidityEvents: Map<string, TFMMLiquidityEvent>,
  accountFactory: ReturnType<typeof createAccountFactory>,
): void {
  // Decode: LiquidityRemoved(address indexed provider, uint256[] amounts, uint256 lpTokensBurned)
  const providerAddr = `0x${log.topics[1]?.slice(26) ?? ''}`

  const decoded = decodeLogData(
    [
      { name: 'amounts', type: 'uint256[]' },
      { name: 'lpTokensBurned', type: 'uint256' },
    ] as const,
    log.data,
  )

  const [amounts, lpTokensBurned] = decoded

  const txHash = log.transactionHash
  const eventId = `${txHash}-${log.logIndex}`

  const provider = accountFactory.getOrCreate(
    providerAddr,
    header.height,
    timestamp,
  )

  const event = new TFMMLiquidityEvent({
    id: eventId,
    pool,
    provider,
    eventType: TFMMLiquidityEventType.REMOVE,
    amounts: amounts as bigint[],
    lpTokens: lpTokensBurned,
    timestamp,
    blockNumber: header.height,
    txHash,
    logIndex: log.logIndex,
  })

  liquidityEvents.set(eventId, event)

  // Update pool total supply
  pool.totalSupply = (pool.totalSupply ?? 0n) - lpTokensBurned
}

function processWeightsUpdated(
  log: LogData,
  header: BlockHeader,
  timestamp: Date,
  pool: TFMMPool,
  weightUpdates: Map<string, TFMMWeightUpdate>,
): void {
  // Decode: WeightsUpdated(uint256[] oldWeights, uint256[] newWeights, uint256 blocksToTarget, uint256 indexed blockNumber)
  const decoded = decodeLogData(
    [
      { name: 'oldWeights', type: 'uint256[]' },
      { name: 'newWeights', type: 'uint256[]' },
      { name: 'blocksToTarget', type: 'uint256' },
    ] as const,
    log.data,
  )

  const [oldWeights, newWeights, blocksToTarget] = decoded

  const txHash = log.transactionHash
  const updateId = `${txHash}-${log.logIndex}`

  const update = new TFMMWeightUpdate({
    id: updateId,
    pool,
    oldWeights: oldWeights as bigint[],
    newWeights: newWeights as bigint[],
    blocksToTarget: Number(blocksToTarget),
    blockNumber: header.height,
    timestamp,
    txHash,
  })

  weightUpdates.set(updateId, update)

  // Update pool weights
  pool.currentWeights = oldWeights as bigint[]
  pool.targetWeights = newWeights as bigint[]
  pool.blocksRemaining = Number(blocksToTarget)
  pool.lastUpdateBlock = header.height
}

/**
 * Create or update TFMMPool entity from on-chain data
 */
export async function indexTFMMPool(
  ctx: ProcessorContext<Store>,
  poolAddress: string,
  name: string,
  symbol: string,
  tokens: string[],
  weights: bigint[],
  swapFeeBps: number,
  owner: string,
  governance: string,
  txHash: string,
  blockNumber: number,
  timestamp: Date,
): Promise<TFMMPool> {
  const chainId = config.chainId
  const poolId = `${chainId}-${poolAddress.toLowerCase()}`

  const pool = new TFMMPool({
    id: poolId,
    address: poolAddress.toLowerCase(),
    chainId,
    name,
    symbol,
    tokens,
    tokenSymbols: [],
    balances: tokens.map(() => 0n),
    currentWeights: weights,
    targetWeights: weights,
    weightDeltas: tokens.map(() => 0n),
    lastUpdateBlock: blockNumber,
    blocksRemaining: 0,
    swapFeeBps,
    protocolFeeBps: 0,
    totalSupply: 0n,
    owner,
    governance,
    minWeight: BigInt(1e18) / 20n, // 5%
    maxWeight: (BigInt(1e18) * 95n) / 100n, // 95%
    maxWeightChangeBps: 500,
    minUpdateInterval: 10,
    tvl: '0',
    tvlUSD: '0',
    volume24h: 0n,
    volumeUSD24h: '0',
    totalVolume: 0n,
    totalVolumeUSD: '0',
    txCount: 0,
    lpProviderCount: 0,
    isActive: true,
    createdAt: timestamp,
    lastUpdated: timestamp,
    createdTxHash: txHash,
  })

  await ctx.store.upsert(pool)

  // Register for event processing
  registerTFMMPool(poolAddress)

  ctx.log.info(`Indexed TFMM pool: ${name} at ${poolAddress}`)

  return pool
}

/**
 * Update global TFMM stats
 */
export async function updateTFMMStats(
  ctx: ProcessorContext<Store>,
): Promise<void> {
  const chainId = config.chainId
  const statsId = 'global'

  let stats = await ctx.store.get(TFMMStats, statsId)
  if (!stats) {
    stats = new TFMMStats({
      id: statsId,
      chainId,
      totalPools: 0,
      activePools: 0,
      totalTvl: 0n,
      totalTvlUSD: '0',
      totalVolume24h: 0n,
      totalVolumeUSD24h: '0',
      totalSwaps24h: 0,
      topPoolsByTvl: [],
      lastUpdated: new Date(),
    })
  }

  // Count pools
  const allPools = await ctx.store.find(TFMMPool, {
    where: { chainId },
  })

  stats.totalPools = allPools.length
  stats.activePools = allPools.filter((p) => p.isActive).length

  // Calculate total TVL and volume
  let totalTvl = 0n
  let totalVolume24h = 0n
  for (const pool of allPools) {
    totalTvl += BigInt(pool.tvl ?? 0)
    totalVolume24h += pool.volume24h ?? 0n
  }

  stats.totalTvl = totalTvl
  stats.totalVolume24h = totalVolume24h
  stats.lastUpdated = new Date()

  // Top pools by TVL
  const sortedPools = allPools
    .sort((a, b) => {
      const tvlA = BigInt(a.tvl ?? 0)
      const tvlB = BigInt(b.tvl ?? 0)
      return tvlB > tvlA ? 1 : tvlB < tvlA ? -1 : 0
    })
    .slice(0, 10)
  stats.topPoolsByTvl = sortedPools.map((p) => p.id)

  await ctx.store.upsert(stats)
}
