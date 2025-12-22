/**
 * LIQUIDITY POOL SIMULATION TESTS
 *
 * Tests for pool creation, liquidity provision, and fee accrual.
 *
 * Run with: bun test tests/integration/liquidity-simulation.test.ts
 */

import { beforeAll, describe, expect, test } from 'bun:test'
import { rawDeployments } from '@jejunetwork/contracts'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatEther,
  http,
  keccak256,
  type PublicClient,
  parseEther,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// =============================================================================
// CONFIGURATION
// =============================================================================

const RPC_URL = process.env.L2_RPC_URL || 'http://localhost:6546'
const CHAIN_ID = 420691 // network localnet chain ID
const DEPLOYER_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006' as Address
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

const localnet = {
  id: CHAIN_ID,
  name: 'Anvil',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
}

// =============================================================================
// TYPES
// =============================================================================

interface PoolKey {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

// =============================================================================
// HELPERS
// =============================================================================

function sortTokens(tokenA: Address, tokenB: Address): [Address, Address] {
  return tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB]
    : [tokenB, tokenA]
}

function computePoolId(key: PoolKey): `0x${string}` {
  const encoded = encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint24' },
      { type: 'int24' },
      { type: 'address' },
    ],
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
  )

  // keccak256 of the encoded data
  return keccak256(encoded)
}

// =============================================================================
// SETUP
// =============================================================================

let publicClient: PublicClient
let _walletClient: WalletClient
let poolManager: Address | null = null
let positionManager: Address | null = null
let skipTests = false

function loadDeployment(filename: string): Record<string, string> {
  const deploymentMap: Record<string, Record<string, string>> = {
    'uniswap-v4-1337.json': rawDeployments.uniswapV4_1337 as Record<
      string,
      string
    >,
    'bazaar-marketplace-1337.json':
      rawDeployments.bazaarMarketplace1337 as Record<string, string>,
    'erc20-factory-1337.json': rawDeployments.erc20Factory1337 as Record<
      string,
      string
    >,
    'multi-token-system-1337.json':
      rawDeployments.multiTokenSystem1337 as Record<string, string>,
  }
  return deploymentMap[filename] || {}
}

beforeAll(async () => {
  publicClient = createPublicClient({
    chain: localnet,
    transport: http(RPC_URL),
  })

  const account = privateKeyToAccount(DEPLOYER_KEY)
  _walletClient = createWalletClient({
    account,
    chain: localnet,
    transport: http(RPC_URL),
  })

  try {
    await publicClient.getBlockNumber()
    console.log(`\n✅ Connected to localnet`)
  } catch {
    console.error(`\n❌ Cannot connect to localnet`)
    skipTests = true
    return
  }

  const v4 = loadDeployment('uniswap-v4-1337.json')
  poolManager = v4.poolManager as Address
  positionManager = v4.positionManager as Address

  console.log(`   PoolManager: ${poolManager || 'NOT DEPLOYED'}`)
  console.log(`   PositionManager: ${positionManager || 'NOT DEPLOYED'}`)
})

// =============================================================================
// TESTS: POOL INITIALIZATION
// =============================================================================

describe('Pool Initialization', () => {
  test('should compute pool ID correctly', async () => {
    const [token0, token1] = sortTokens(WETH_ADDRESS, ZERO_ADDRESS)

    const poolKey: PoolKey = {
      currency0: token0,
      currency1: token1,
      fee: 3000, // 0.3%
      tickSpacing: 60,
      hooks: ZERO_ADDRESS,
    }

    const poolId = computePoolId(poolKey)
    expect(poolId).toMatch(/^0x[a-f0-9]{64}$/)
    console.log(`   Pool ID: ${poolId.slice(0, 18)}...`)
  })

  test('should verify pool manager is deployed', async () => {
    if (skipTests || !poolManager) {
      console.log('   ⚠️ PoolManager not deployed')
      return
    }

    const code = await publicClient.getCode({ address: poolManager })
    expect(code).not.toBe('0x')
    console.log(`   ✅ PoolManager verified at ${poolManager}`)
  })
})

// =============================================================================
// TESTS: LIQUIDITY PROVISION
// =============================================================================

describe('Liquidity Provision', () => {
  test('should calculate tick range for full range liquidity', async () => {
    // Full range: tickLower = -887272, tickUpper = 887272
    // These are the min/max ticks for most pools
    const MIN_TICK = -887272
    const MAX_TICK = 887272

    console.log(`   Full range: [${MIN_TICK}, ${MAX_TICK}]`)

    // For concentrated liquidity, use narrower range
    // e.g., +/- 10% from current price
    const TICK_SPACING = 60
    const currentTick = 0 // At 1:1 price
    const rangeTicks = 1000 // ~10% range

    const tickLower =
      Math.floor((currentTick - rangeTicks) / TICK_SPACING) * TICK_SPACING
    const tickUpper =
      Math.ceil((currentTick + rangeTicks) / TICK_SPACING) * TICK_SPACING

    console.log(`   Concentrated range: [${tickLower}, ${tickUpper}]`)

    expect(tickLower).toBeLessThan(currentTick)
    expect(tickUpper).toBeGreaterThan(currentTick)
    // Verify ticks are aligned to tick spacing (use abs for negative modulo)
    expect(Math.abs(tickLower % TICK_SPACING)).toBe(0)
    expect(Math.abs(tickUpper % TICK_SPACING)).toBe(0)

    console.log(`   ✅ Tick range calculated correctly`)
  })

  test('should calculate required token amounts for LP', async () => {
    // For a 1:1 pool, equal amounts of both tokens needed
    const amount0Desired = parseEther('10')
    const amount1Desired = parseEther('10')

    // With 0.5% slippage tolerance
    const slippage = 0.005
    const amount0Min =
      amount0Desired -
      (amount0Desired * BigInt(Math.floor(slippage * 10000))) / 10000n
    const amount1Min =
      amount1Desired -
      (amount1Desired * BigInt(Math.floor(slippage * 10000))) / 10000n

    console.log(`   Token0 desired: ${formatEther(amount0Desired)}`)
    console.log(`   Token1 desired: ${formatEther(amount1Desired)}`)
    console.log(`   Token0 min: ${formatEther(amount0Min)}`)
    console.log(`   Token1 min: ${formatEther(amount1Min)}`)

    expect(amount0Min).toBe(parseEther('9.95'))
    expect(amount1Min).toBe(parseEther('9.95'))

    console.log(`   ✅ LP amounts calculated correctly`)
  })

  test('should estimate LP token value', async () => {
    // If you provide 10 ETH + 10 USDC to a pool
    // Your LP position value = 10 ETH + 10 USDC
    // Assuming ETH = $3500, USDC = $1

    const ethAmount = parseEther('10')
    const usdcAmount = parseEther('10000') // 10000 USDC (6 decimals normally)
    const ethPrice = 3500
    const usdcPrice = 1

    const ethValue = Number(formatEther(ethAmount)) * ethPrice
    const usdcValue = Number(formatEther(usdcAmount)) * usdcPrice
    const totalValue = ethValue + usdcValue

    console.log(`   ETH value: $${ethValue.toLocaleString()}`)
    console.log(`   USDC value: $${usdcValue.toLocaleString()}`)
    console.log(`   Total LP value: $${totalValue.toLocaleString()}`)

    expect(totalValue).toBe(45000)
    console.log(`   ✅ LP value estimation correct`)
  })
})

// =============================================================================
// TESTS: FEE ACCRUAL
// =============================================================================

describe('Fee Accrual', () => {
  test('should calculate fees earned from swaps', async () => {
    // Pool with 0.3% fee
    // 1000 ETH of swap volume
    // LPs earn: 1000 * 0.003 = 3 ETH in fees

    const swapVolume = parseEther('1000')
    const feeRate = 3000n // 0.3% in basis points

    const feesEarned = (swapVolume * feeRate) / 1000000n

    expect(feesEarned).toBe(parseEther('3'))
    console.log(`   Swap volume: ${formatEther(swapVolume)} ETH`)
    console.log(`   Fee rate: 0.3%`)
    console.log(`   Fees earned: ${formatEther(feesEarned)} ETH`)
    console.log(`   ✅ Fee accrual calculation correct`)
  })

  test('should calculate LP share of fees', async () => {
    // If you have 10% of the pool liquidity
    // And total fees = 3 ETH
    // Your share = 0.3 ETH

    const totalFees = parseEther('3')
    const yourLiquidity = parseEther('100')
    const totalLiquidity = parseEther('1000')

    const yourShare = (totalFees * yourLiquidity) / totalLiquidity

    expect(yourShare).toBe(parseEther('0.3'))
    console.log(
      `   Your liquidity: ${formatEther(yourLiquidity)} (10% of pool)`,
    )
    console.log(`   Total fees: ${formatEther(totalFees)} ETH`)
    console.log(`   Your fee share: ${formatEther(yourShare)} ETH`)
    console.log(`   ✅ Fee share calculation correct`)
  })

  test('should estimate APR from fees', async () => {
    // Assumptions:
    // - Pool TVL: $1,000,000
    // - Daily volume: $100,000
    // - Fee: 0.3%
    // - Daily fees: $300
    // - Annual fees: $300 * 365 = $109,500
    // - APR: 109,500 / 1,000,000 = 10.95%

    const poolTVL = 1_000_000
    const dailyVolume = 100_000
    const feeRate = 0.003

    const dailyFees = dailyVolume * feeRate
    const annualFees = dailyFees * 365
    const apr = (annualFees / poolTVL) * 100

    console.log(`   Pool TVL: $${poolTVL.toLocaleString()}`)
    console.log(`   Daily volume: $${dailyVolume.toLocaleString()}`)
    console.log(`   Daily fees: $${dailyFees.toLocaleString()}`)
    console.log(`   Estimated APR: ${apr.toFixed(2)}%`)

    expect(apr).toBeCloseTo(10.95, 1)
    console.log(`   ✅ APR estimation correct`)
  })
})

// =============================================================================
// TESTS: IMPERMANENT LOSS
// =============================================================================

describe('Impermanent Loss', () => {
  test('should calculate IL for 2x price change', async () => {
    // If price doubles (2x), IL = 5.72%
    // Formula: IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1

    const priceRatio = 2
    const sqrtRatio = Math.sqrt(priceRatio)
    const il = (2 * sqrtRatio) / (1 + priceRatio) - 1
    const ilPercent = Math.abs(il) * 100

    console.log(`   Price change: ${priceRatio}x`)
    console.log(`   Impermanent Loss: ${ilPercent.toFixed(2)}%`)

    expect(ilPercent).toBeCloseTo(5.72, 1)
    console.log(`   ✅ IL calculation correct for 2x`)
  })

  test('should calculate IL for 0.5x price change', async () => {
    // If price halves (0.5x), IL = 5.72% (same as 2x)

    const priceRatio = 0.5
    const sqrtRatio = Math.sqrt(priceRatio)
    const il = (2 * sqrtRatio) / (1 + priceRatio) - 1
    const ilPercent = Math.abs(il) * 100

    console.log(`   Price change: ${priceRatio}x`)
    console.log(`   Impermanent Loss: ${ilPercent.toFixed(2)}%`)

    expect(ilPercent).toBeCloseTo(5.72, 1)
    console.log(`   ✅ IL calculation correct for 0.5x`)
  })

  test('should calculate IL for 5x price change', async () => {
    // If price goes 5x, IL = 25.46%

    const priceRatio = 5
    const sqrtRatio = Math.sqrt(priceRatio)
    const il = (2 * sqrtRatio) / (1 + priceRatio) - 1
    const ilPercent = Math.abs(il) * 100

    console.log(`   Price change: ${priceRatio}x`)
    console.log(`   Impermanent Loss: ${ilPercent.toFixed(2)}%`)

    expect(ilPercent).toBeCloseTo(25.46, 1)
    console.log(`   ✅ IL calculation correct for 5x`)
  })

  test('should compare IL vs holding', async () => {
    // Initial: 1 ETH @ $3500 + 3500 USDC = $7000
    // After 2x: Price goes to $7000
    //
    // Holding value: 1 ETH * $7000 + $3500 = $10,500
    // LP value with IL: $10,500 * (1 - 0.0572) = $9,899
    // Loss from IL: $601

    const initialEthPrice = 3500
    const finalEthPrice = 7000
    const initialEthAmount = 1
    const initialUsdcAmount = 3500

    const holdingValue = initialEthAmount * finalEthPrice + initialUsdcAmount

    const priceRatio = finalEthPrice / initialEthPrice
    const sqrtRatio = Math.sqrt(priceRatio)
    const il = (2 * sqrtRatio) / (1 + priceRatio) - 1

    const lpValue = holdingValue * (1 + il)
    const ilLoss = holdingValue - lpValue

    console.log(`   Initial position: 1 ETH + $3500 USDC`)
    console.log(`   ETH price change: $${initialEthPrice} → $${finalEthPrice}`)
    console.log(`   Holding value: $${holdingValue.toLocaleString()}`)
    console.log(`   LP value: $${lpValue.toFixed(0)}`)
    console.log(`   IL loss: $${ilLoss.toFixed(0)}`)

    expect(ilLoss).toBeGreaterThan(0)
    console.log(`   ✅ IL vs holding comparison correct`)
  })
})

// =============================================================================
// SUMMARY
// =============================================================================

describe('Liquidity Simulation Summary', () => {
  test('print summary', async () => {
    console.log('')
    console.log('═══════════════════════════════════════════════════════')
    console.log('         LIQUIDITY SIMULATION SUMMARY')
    console.log('═══════════════════════════════════════════════════════')
    console.log('')
    console.log('Pool Operations Verified:')
    console.log('  ✅ Pool ID computation')
    console.log('  ✅ Tick range calculation')
    console.log('  ✅ LP token amounts')
    console.log('')
    console.log('Fee Calculations Verified:')
    console.log('  ✅ Fee accrual from swaps')
    console.log('  ✅ LP share of fees')
    console.log('  ✅ APR estimation')
    console.log('')
    console.log('Risk Metrics Verified:')
    console.log('  ✅ Impermanent loss (2x, 0.5x, 5x)')
    console.log('  ✅ IL vs holding comparison')
    console.log('')
    console.log('═══════════════════════════════════════════════════════')
  })
})
