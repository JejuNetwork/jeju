/**
 * Pool Validation (TVL, Age, Honeypot Detection)
 *
 * Validates pools before trading to avoid:
 * - Low liquidity pools
 * - Honeypot tokens
 * - Rug pulls
 * - Suspicious contracts
 */

import { type Address, type PublicClient, parseAbi } from 'viem'

interface PoolValidation {
  isValid: boolean
  tvlUsd: number
  ageBlocks: number
  ageDays: number
  risks: string[]
  score: number // 0-100
}

interface TokenValidation {
  isHoneypot: boolean
  canBuy: boolean
  canSell: boolean
  buyTax: number
  sellTax: number
  risks: string[]
}

const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
  'function transfer(address, uint256) returns (bool)',
  'function approve(address, uint256) returns (bool)',
])

const PAIR_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function factory() view returns (address)',
])

// Known safe tokens (stablecoins, major tokens)
const SAFE_TOKENS: Set<string> = new Set([
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
  '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
  '0x6B175474E89094C44Da98b954EescdeCB5f68AC5', // DAI
  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
])

// Min TVL thresholds by chain
const MIN_TVL: Record<number, number> = {
  1: 100000, // $100k for mainnet
  8453: 50000, // $50k for Base
  42161: 50000, // $50k for Arbitrum
  10: 50000, // $50k for Optimism
  56: 25000, // $25k for BSC
}

// Min age in blocks
const MIN_AGE_BLOCKS: Record<number, number> = {
  1: 50000, // ~7 days
  8453: 500000, // ~2 days
  42161: 2000000, // ~5 days
  10: 500000, // ~2 days
  56: 200000, // ~7 days
}

export class PoolValidator {
  constructor(
    private client: PublicClient,
    private chainId: number,
    private ethPriceUsd: number = 3500,
  ) {}

  /**
   * Validate a liquidity pool
   */
  async validatePool(poolAddress: Address): Promise<PoolValidation> {
    const risks: string[] = []
    let score = 100

    // Get pool data
    const [token0, token1, reserves, currentBlock] = await Promise.all([
      this.client.readContract({
        address: poolAddress,
        abi: PAIR_ABI,
        functionName: 'token0',
      }),
      this.client.readContract({
        address: poolAddress,
        abi: PAIR_ABI,
        functionName: 'token1',
      }),
      this.client.readContract({
        address: poolAddress,
        abi: PAIR_ABI,
        functionName: 'getReserves',
      }),
      this.client.getBlockNumber(),
    ])

    const [reserve0, reserve1, blockTimestampLast] = reserves

    // Estimate creation block from first trade timestamp
    const ageBlocks = Number(currentBlock) - Number(blockTimestampLast) / 12
    const ageDays = (ageBlocks * 12) / 86400

    // Check pool age
    const minAge = MIN_AGE_BLOCKS[this.chainId] ?? 50000
    if (ageBlocks < minAge) {
      risks.push(`Pool too new: ${Math.floor(ageDays)} days old`)
      score -= 30
    }

    // Estimate TVL (simplified - would need oracle for accuracy)
    const tvlUsd = await this.estimateTVL(token0, token1, reserve0, reserve1)

    const minTvl = MIN_TVL[this.chainId] ?? 50000
    if (tvlUsd < minTvl) {
      risks.push(`Low TVL: $${tvlUsd.toFixed(0)}`)
      score -= 40
    }

    // Check token safety
    const [token0Safe, token1Safe] = await Promise.all([
      this.isTokenSafe(token0),
      this.isTokenSafe(token1),
    ])

    if (!token0Safe) {
      risks.push(`Token0 (${token0}) failed safety checks`)
      score -= 25
    }
    if (!token1Safe) {
      risks.push(`Token1 (${token1}) failed safety checks`)
      score -= 25
    }

    // Check reserve ratio (extremely imbalanced = suspicious)
    const ratio = Number(reserve0) / Number(reserve1)
    if (ratio > 1000 || ratio < 0.001) {
      risks.push('Extremely imbalanced reserves')
      score -= 20
    }

    return {
      isValid: score >= 50,
      tvlUsd,
      ageBlocks: Math.floor(ageBlocks),
      ageDays: Math.floor(ageDays),
      risks,
      score: Math.max(0, score),
    }
  }

  /**
   * Check if token is a honeypot
   */
  async validateToken(tokenAddress: Address): Promise<TokenValidation> {
    const risks: string[] = []

    // Known safe token
    if (SAFE_TOKENS.has(tokenAddress)) {
      return {
        isHoneypot: false,
        canBuy: true,
        canSell: true,
        buyTax: 0,
        sellTax: 0,
        risks: [],
      }
    }

    // Get token info
    let name = ''
    let symbol = ''
    let totalSupply = 0n

    try {
      ;[name, symbol, totalSupply] = await Promise.all([
        this.client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'name',
        }),
        this.client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }),
        this.client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'totalSupply',
        }),
      ])
    } catch {
      risks.push('Failed to read token metadata')
    }

    // Check for suspicious patterns
    const lowerName = name.toLowerCase()
    const lowerSymbol = symbol.toLowerCase()

    if (lowerName.includes('test') || lowerSymbol.includes('test')) {
      risks.push('Test token')
    }

    if (totalSupply === 0n) {
      risks.push('Zero total supply')
    }

    // Check bytecode for known honeypot patterns
    const bytecode = await this.client.getCode({ address: tokenAddress })

    if (!bytecode || bytecode === '0x') {
      risks.push('No contract bytecode')
      return {
        isHoneypot: true,
        canBuy: false,
        canSell: false,
        buyTax: 100,
        sellTax: 100,
        risks,
      }
    }

    // Check for common honeypot signatures
    const bytecodeHex = bytecode.toLowerCase()

    // Transfer restriction patterns
    if (bytecodeHex.includes('3d3d3d3d')) {
      // Common in fee-on-transfer tokens
      risks.push('Possible fee-on-transfer')
    }

    // Blacklist function signature
    if (bytecodeHex.includes('f4a0a528') || bytecodeHex.includes('44337ea1')) {
      risks.push('Has blacklist function')
    }

    // Max transaction limit
    if (bytecodeHex.includes('5a69c25f') || bytecodeHex.includes('23b872dd')) {
      // Could be max tx limit - not necessarily bad but needs caution
    }

    // Estimate tax by simulating (simplified)
    const estimatedBuyTax = risks.includes('Possible fee-on-transfer') ? 5 : 0
    const estimatedSellTax = risks.includes('Possible fee-on-transfer') ? 5 : 0

    const isHoneypot =
      risks.length >= 3 ||
      risks.some((r) => r.includes('blacklist') || r.includes('No contract'))

    return {
      isHoneypot,
      canBuy: !isHoneypot,
      canSell: !isHoneypot,
      buyTax: estimatedBuyTax,
      sellTax: estimatedSellTax,
      risks,
    }
  }

  /**
   * Batch validate multiple pools
   */
  async validatePools(pools: Address[]): Promise<Map<Address, PoolValidation>> {
    const results = new Map<Address, PoolValidation>()

    const validations = await Promise.all(
      pools.map((pool) =>
        this.validatePool(pool).catch((e) => ({
          isValid: false,
          tvlUsd: 0,
          ageBlocks: 0,
          ageDays: 0,
          risks: [
            `Validation error: ${e instanceof Error ? e.message : 'Unknown'}`,
          ],
          score: 0,
        })),
      ),
    )

    for (let i = 0; i < pools.length; i++) {
      results.set(pools[i], validations[i])
    }

    return results
  }

  private async estimateTVL(
    token0: Address,
    token1: Address,
    reserve0: bigint,
    reserve1: bigint,
  ): Promise<number> {
    // Simplified TVL estimation
    // In production, would use oracle prices

    // Check if either token is WETH or stablecoin
    const token0Lower = token0.toLowerCase()
    const token1Lower = token1.toLowerCase()

    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7'

    let tvl = 0

    if (token0Lower === WETH) {
      tvl = (Number(reserve0) / 1e18) * this.ethPriceUsd * 2
    } else if (token1Lower === WETH) {
      tvl = (Number(reserve1) / 1e18) * this.ethPriceUsd * 2
    } else if (token0Lower === USDC || token0Lower === USDT) {
      tvl = (Number(reserve0) / 1e6) * 2
    } else if (token1Lower === USDC || token1Lower === USDT) {
      tvl = (Number(reserve1) / 1e6) * 2
    } else {
      // Unknown tokens - estimate conservatively
      tvl = 10000 // $10k default
    }

    return tvl
  }

  private async isTokenSafe(tokenAddress: Address): Promise<boolean> {
    // Known safe
    if (SAFE_TOKENS.has(tokenAddress)) return true

    try {
      // Basic checks
      const [totalSupply, bytecode] = await Promise.all([
        this.client.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: 'totalSupply',
        }),
        this.client.getCode({ address: tokenAddress }),
      ])

      if (totalSupply === 0n) return false
      if (!bytecode || bytecode === '0x') return false
      if (bytecode.length < 100) return false

      return true
    } catch {
      return false
    }
  }
}

export function createPoolValidator(
  client: PublicClient,
  chainId: number,
  ethPriceUsd?: number,
): PoolValidator {
  return new PoolValidator(client, chainId, ethPriceUsd)
}

export type { PoolValidation, TokenValidation }
