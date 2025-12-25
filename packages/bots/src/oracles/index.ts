import type { EVMChainId } from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  http,
  type PublicClient,
  parseAbi,
} from 'viem'
import { z } from 'zod'
import { expectEVMChainId } from '../schemas'
import type { OraclePrice } from '../types'

// Pyth oracle return type schema
const PythPriceSchema = z.object({
  price: z.bigint(),
  conf: z.bigint(),
  expo: z.number(),
  publishTime: z.bigint(),
})

const PYTH_ABI = parseAbi([
  'function getPriceUnsafe(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))',
  'function getPriceNoOlderThan(bytes32 id, uint256 age) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))',
  'function getEmaPrice(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))',
  'function updatePriceFeeds(bytes[] calldata updateData) payable',
  'function getUpdateFee(bytes[] calldata updateData) view returns (uint256)',
])

const CHAINLINK_ABI = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
])

const UNISWAP_V3_POOL_ABI = parseAbi([
  'function observe(uint32[] calldata secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)',
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
])

const PYTH_PRICE_IDS: Record<string, `0x${string}`> = {
  'ETH/USD':
    '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'BTC/USD':
    '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  'USDC/USD':
    '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  'USDT/USD':
    '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
  'SOL/USD':
    '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'BNB/USD':
    '0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f',
  'ARB/USD':
    '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5',
  'OP/USD':
    '0x385f64d993f7b77d8182ed5003d97c60aa3361f3cecfe711544d2d59165e9bdf',
  'MATIC/USD':
    '0x5de33440a4e71f4f0c6e5e2b7c0b0a3c6c8d5f0e1d2c3b4a5f6e7d8c9b0a1f2e3',
  'AVAX/USD':
    '0x93da3352f9f1d105fdfe4971cfa80e9dd777bfc5d0f683ebb6e1294b92137bb7',
  'LINK/USD':
    '0x8ac0c70fff57e9aefdf5edf44b51d62c2d433653cbb2cf5cc06bb115af04d221',
}

const CHAINLINK_FEEDS: Partial<Record<EVMChainId, Record<string, Address>>> = {
  1: {
    'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    'BTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    'USDC/USD': '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
    'USDT/USD': '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D',
    'LINK/USD': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',
  },
  8453: {
    'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
    'BTC/USD': '0x64c911996D3c6aC71E9b8A4D84E4aE3A91FEf81C',
    'USDC/USD': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
  },
  42161: {
    'ETH/USD': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    'BTC/USD': '0x6ce185860a4963106506C203335A73A3d3fA5F8F',
    'USDC/USD': '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
    'ARB/USD': '0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6',
  },
  10: {
    'ETH/USD': '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
    'BTC/USD': '0xD702DD976Fb76Fffc2D3963D037dfDae5b04E593',
    'USDC/USD': '0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3',
    'OP/USD': '0x0D276FC14719f9292D5C1eA2198673d1f4269246',
  },
  56: {
    'ETH/USD': '0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e',
    'BTC/USD': '0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf',
    'BNB/USD': '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE',
    'USDC/USD': '0x51597f405303C4377E36123cBc172b13269EA163',
  },
  84532: {},
  11155111: {},
  420690: {},
  420691: {},
  31337: {},
}

const PYTH_ADDRESSES: Partial<Record<EVMChainId, Address>> = {
  1: '0x4305FB66699C3B2702D4d05CF36551390A4c69C6',
  8453: '0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a',
  42161: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
  10: '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
  56: '0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594',
}

export class OracleAggregator {
  private clients: Map<EVMChainId, PublicClient> = new Map()
  private priceCache: Map<string, OraclePrice> = new Map()
  private cacheTtlMs = 10000 // 10 second cache

  constructor(rpcUrls: Partial<Record<EVMChainId, string>>) {
    for (const [chainIdStr, rpcUrl] of Object.entries(rpcUrls)) {
      const chainId = expectEVMChainId(Number(chainIdStr), 'rpcUrls key')
      this.clients.set(chainId, createPublicClient({ transport: http(rpcUrl) }))
    }
  }

  async getPrice(
    token: string,
    chainId: EVMChainId,
    maxStalenessSeconds = 60,
  ): Promise<OraclePrice> {
    const cacheKey = `${chainId}-${token}`
    const cached = this.priceCache.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached
    }

    // Try Pyth first (permissionless, real-time)
    const pythPrice = await this.getPythPrice(
      token,
      chainId,
      maxStalenessSeconds,
    )
    if (pythPrice) {
      this.priceCache.set(cacheKey, pythPrice)
      return pythPrice
    }

    // Fallback to Chainlink
    const chainlinkPrice = await this.getChainlinkPrice(
      token,
      chainId,
      maxStalenessSeconds,
    )
    if (chainlinkPrice) {
      this.priceCache.set(cacheKey, chainlinkPrice)
      return chainlinkPrice
    }

    throw new Error(`No price available for ${token} on chain ${chainId}`)
  }

  async getPrices(
    tokens: string[],
    chainId: EVMChainId,
    maxStalenessSeconds = 60,
  ): Promise<Map<string, OraclePrice>> {
    const prices = new Map<string, OraclePrice>()

    await Promise.all(
      tokens.map(async (token) => {
        const price = await this.getPrice(token, chainId, maxStalenessSeconds)
        prices.set(token, price)
      }),
    )

    return prices
  }

  // Maximum acceptable confidence interval as a ratio of price (5% = 0.05)
  private readonly MAX_CONFIDENCE_RATIO = 0.05

  private async getPythPrice(
    token: string,
    chainId: EVMChainId,
    maxStalenessSeconds: number,
  ): Promise<OraclePrice | null> {
    const pythAddress = PYTH_ADDRESSES[chainId]
    if (!pythAddress) return null

    const pairKey = this.tokenToPair(token)
    const priceId = PYTH_PRICE_IDS[pairKey]
    if (!priceId) return null

    const client = this.clients.get(chainId)
    if (!client) return null

    const rawResult = await client.readContract({
      address: pythAddress,
      abi: PYTH_ABI,
      functionName: 'getPriceNoOlderThan',
      args: [priceId, BigInt(maxStalenessSeconds)],
    })
    const result = PythPriceSchema.parse(rawResult)

    // Validate price is positive
    if (result.price <= 0n) {
      console.warn(
        `Pyth returned non-positive price for ${token}: ${result.price}`,
      )
      return null
    }

    const confidenceRatio = Number(result.conf) / Number(result.price)
    if (confidenceRatio > this.MAX_CONFIDENCE_RATIO) {
      console.warn(
        `Pyth price confidence too low for ${token}: ${(confidenceRatio * 100).toFixed(2)}% interval (max ${this.MAX_CONFIDENCE_RATIO * 100}%)`,
      )
      return null
    }

    const exponent = result.expo
    const rawPrice = result.price
    const targetDecimals = 8
    let normalizedPrice: bigint
    if (exponent >= 0) {
      normalizedPrice = rawPrice * BigInt(10 ** (targetDecimals + exponent))
    } else {
      const scaleDown = -exponent
      if (scaleDown > targetDecimals) {
        normalizedPrice = rawPrice / BigInt(10 ** (scaleDown - targetDecimals))
      } else {
        normalizedPrice = rawPrice * BigInt(10 ** (targetDecimals - scaleDown))
      }
    }

    return {
      token,
      price: normalizedPrice,
      decimals: targetDecimals,
      timestamp: Number(result.publishTime) * 1000,
      source: 'pyth',
      confidence: confidenceRatio,
    }
  }

  private async getChainlinkPrice(
    token: string,
    chainId: EVMChainId,
    maxStalenessSeconds: number,
  ): Promise<OraclePrice | null> {
    const feeds = CHAINLINK_FEEDS[chainId]
    if (!feeds || Object.keys(feeds).length === 0) return null

    const pairKey = this.tokenToPair(token)
    const feedAddress = feeds[pairKey]
    if (!feedAddress) return null

    const client = this.clients.get(chainId)
    if (!client) return null

    const [roundData, decimals] = await Promise.all([
      client.readContract({
        address: feedAddress,
        abi: CHAINLINK_ABI,
        functionName: 'latestRoundData',
      }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
      client.readContract({
        address: feedAddress,
        abi: CHAINLINK_ABI,
        functionName: 'decimals',
      }) as Promise<number>,
    ])

    const [, answer, , updatedAt] = roundData
    const staleness = Math.floor(Date.now() / 1000) - Number(updatedAt)

    if (staleness > maxStalenessSeconds) {
      return null
    }

    const targetDecimals = 8
    let normalizedPrice: bigint
    if (decimals > targetDecimals) {
      normalizedPrice = answer / BigInt(10 ** (decimals - targetDecimals))
    } else {
      normalizedPrice = answer * BigInt(10 ** (targetDecimals - decimals))
    }

    return {
      token,
      price: normalizedPrice,
      decimals: targetDecimals,
      timestamp: Number(updatedAt) * 1000,
      source: 'chainlink',
    }
  }

  async getUniswapTWAP(
    poolAddress: Address,
    chainId: EVMChainId,
    twapPeriodSeconds: number,
  ): Promise<{ tick: number; price: bigint }> {
    const client = this.clients.get(chainId)
    if (!client) throw new Error(`No client for chain ${chainId}`)

    const secondsAgos = [twapPeriodSeconds, 0]

    const [tickCumulatives] = (await client.readContract({
      address: poolAddress,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: 'observe',
      args: [secondsAgos.map((s) => s)],
    })) as [bigint[], bigint[]]

    const tickDiff = Number(tickCumulatives[1] - tickCumulatives[0])
    const twapTick = Math.floor(tickDiff / twapPeriodSeconds)
    const price = this.tickToPrice(twapTick)

    return { tick: twapTick, price }
  }

  private tickToPrice(tick: number): bigint {
    const MAX_TICK = 887272
    const clampedTick = Math.max(-MAX_TICK, Math.min(MAX_TICK, tick))

    const price = 1.0001 ** clampedTick

    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(
        `Invalid TWAP price calculation: tick ${tick} resulted in ${price}`,
      )
    }

    const maxPrice = 1e37
    const safePrice = Math.min(price, maxPrice)

    return BigInt(Math.floor(safePrice * 1e18))
  }

  private tokenToPair(token: string): string {
    const symbol = token.toUpperCase()
    if (symbol === 'WETH' || symbol === 'ETH') return 'ETH/USD'
    if (symbol === 'WBTC' || symbol === 'BTC') return 'BTC/USD'
    return `${symbol}/USD`
  }

  isStale(price: OraclePrice, maxAgeMs: number): boolean {
    if (maxAgeMs === 0) return true
    return Date.now() - price.timestamp > maxAgeMs
  }

  calculateDeviation(price1: bigint, price2: bigint): number {
    const diff = price1 > price2 ? price1 - price2 : price2 - price1
    const avg = (price1 + price2) / 2n
    return Number((diff * 10000n) / avg) // Returns basis points
  }

  async validatePrice(
    token: string,
    chainId: EVMChainId,
    maxDeviationBps: number,
  ): Promise<{ valid: boolean; price: OraclePrice; deviation?: number }> {
    const pythPrice = await this.getPythPrice(token, chainId, 120)
    const chainlinkPrice = await this.getChainlinkPrice(token, chainId, 120)

    if (!pythPrice && !chainlinkPrice) {
      throw new Error(`No price sources available for ${token}`)
    }

    if (!pythPrice && chainlinkPrice) {
      return { valid: true, price: chainlinkPrice }
    }

    if (pythPrice && !chainlinkPrice) {
      return { valid: true, price: pythPrice }
    }

    const pyth = pythPrice as OraclePrice
    const chainlink = chainlinkPrice as OraclePrice

    const deviation = this.calculateDeviation(pyth.price, chainlink.price)

    return {
      valid: deviation <= maxDeviationBps,
      price: pyth,
      deviation,
    }
  }
}

export const TOKEN_SYMBOLS: Partial<
  Record<EVMChainId, Record<string, string>>
> = {
  1: {
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
    '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 'WBTC',
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'USDC',
    '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT',
    '0x6B175474E89094C44Da98b954EesdfDcD5F8a01': 'DAI',
  },
  8453: {
    '0x4200000000000000000000000000000000000006': 'WETH',
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 'USDC',
    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb': 'DAI',
  },
  42161: {
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1': 'WETH',
    '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': 'WBTC',
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': 'USDC',
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9': 'USDT',
    '0x912CE59144191C1204E64559FE8253a0e49E6548': 'ARB',
  },
  10: {
    '0x4200000000000000000000000000000000000006': 'WETH',
    '0x68f180fcCe6836688e9084f035309E29Bf0A2095': 'WBTC',
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85': 'USDC',
    '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58': 'USDT',
    '0x4200000000000000000000000000000000000042': 'OP',
  },
  56: {
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c': 'WBNB',
    '0x2170Ed0880ac9A755fd29B2688956BD959F933F8': 'ETH',
    '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c': 'BTCB',
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d': 'USDC',
    '0x55d398326f99059fF775485246999027B3197955': 'USDT',
  },
  84532: {},
  11155111: {},
  420690: {},
  420691: {},
  31337: {},
}

export function getTokenSymbol(address: string, chainId: EVMChainId): string {
  const normalized = address.toLowerCase()
  const chainTokens = TOKEN_SYMBOLS[chainId]

  if (!chainTokens) {
    return 'UNKNOWN'
  }

  for (const [addr, symbol] of Object.entries(chainTokens)) {
    if (addr.toLowerCase() === normalized) return symbol
  }

  return 'UNKNOWN'
}
