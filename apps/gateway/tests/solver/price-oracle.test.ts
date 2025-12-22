/**
 * Price Oracle Tests
 */

import { beforeAll, describe, expect, it } from 'bun:test'
import { type Address, createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'

import {
  CHAINLINK_FEEDS,
  PriceOracle,
  TOKEN_TO_FEED,
} from '../../src/solver/external/price-oracle'

const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Address
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Address
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7' as Address
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f' as Address

describe('Chainlink Feed Configuration', () => {
  it('should have major price feeds configured', () => {
    expect(CHAINLINK_FEEDS['ETH/USD']).toBeDefined()
    expect(CHAINLINK_FEEDS['BTC/USD']).toBeDefined()
    expect(CHAINLINK_FEEDS['USDC/USD']).toBeDefined()
    expect(CHAINLINK_FEEDS['USDT/USD']).toBeDefined()
    expect(CHAINLINK_FEEDS['DAI/USD']).toBeDefined()
  })

  it('should have valid feed addresses', () => {
    for (const [, feed] of Object.entries(CHAINLINK_FEEDS)) {
      expect(feed.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(feed.decimals).toBe(8)
    }
  })

  it('should have token to feed mappings', () => {
    expect(TOKEN_TO_FEED[WETH.toLowerCase()]).toBe('ETH/USD')
    expect(TOKEN_TO_FEED[USDC.toLowerCase()]).toBe('USDC/USD')
    expect(TOKEN_TO_FEED[USDT.toLowerCase()]).toBe('USDT/USD')
    expect(TOKEN_TO_FEED[DAI.toLowerCase()]).toBe('DAI/USD')
  })
})

describe('PriceOracle', () => {
  let oracle: PriceOracle

  beforeAll(() => {
    const client = createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    })
    oracle = new PriceOracle(client)
  })

  it('should instantiate correctly', () => {
    expect(oracle).toBeDefined()
  })

  it('should have empty cache initially', () => {
    oracle.clearCache()
    const stats = oracle.getCacheStats()
    expect(stats.size).toBe(0)
    expect(stats.entries).toEqual([])
  })
})

describe('Live Price Fetching', () => {
  let oracle: PriceOracle

  beforeAll(() => {
    const client = createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    })
    oracle = new PriceOracle(client)
  })

  it('should fetch ETH price from Chainlink', async () => {
    const price = await oracle.getPrice(WETH)

    expect(price).not.toBeNull()
    if (price) {
      expect(price.source).toBe('chainlink')
      expect(price.decimals).toBe(8)
      expect(price.price).toBeGreaterThan(1000)
      expect(price.price).toBeLessThan(100000)
    }
  }, 15000)

  it('should fetch USDC price from Chainlink', async () => {
    const price = await oracle.getPrice(USDC)

    expect(price).not.toBeNull()
    if (price) {
      expect(price.source).toBe('chainlink')
      expect(price.price).toBeGreaterThan(0.95)
      expect(price.price).toBeLessThan(1.05)
    }
  }, 15000)

  it('should cache prices', async () => {
    oracle.clearCache()

    const price1 = await oracle.getPrice(WETH)
    expect(price1?.source).toBe('chainlink')

    const price2 = await oracle.getPrice(WETH)
    expect(price2?.source).toBe('cached')
    expect(price2?.price).toBe(price1?.price)
  }, 15000)

  it('should fetch multiple prices in parallel', async () => {
    const tokens = [WETH, USDC, USDT, DAI]
    const prices = await oracle.getPrices(tokens)

    expect(prices.size).toBe(4)

    for (const token of tokens) {
      const price = prices.get(token.toLowerCase())
      expect(price).toBeDefined()
      expect(price?.priceUsd).toBeGreaterThan(0)
    }
  }, 20000)
})

describe('Relative Price Calculation', () => {
  let oracle: PriceOracle

  beforeAll(() => {
    const client = createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    })
    oracle = new PriceOracle(client)
  })

  it('should calculate ETH/USDC relative price', async () => {
    const relativePrice = await oracle.getRelativePrice(WETH, USDC)

    expect(relativePrice).not.toBeNull()
    if (relativePrice) {
      expect(relativePrice).toBeGreaterThan(1000)
      expect(relativePrice).toBeLessThan(100000)
    }
  }, 15000)

  it('should calculate stablecoin relative price', async () => {
    const relativePrice = await oracle.getRelativePrice(USDC, USDT)

    expect(relativePrice).not.toBeNull()
    if (relativePrice) {
      expect(relativePrice).toBeGreaterThan(0.95)
      expect(relativePrice).toBeLessThan(1.05)
    }
  }, 15000)
})

describe('Fair Value Calculation', () => {
  let oracle: PriceOracle

  beforeAll(() => {
    const client = createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    })
    oracle = new PriceOracle(client)
  })

  it('should calculate fair value for USDC to WETH swap', async () => {
    const sellAmount = BigInt('3000000000')
    const fairValue = await oracle.getFairValue(USDC, WETH, sellAmount, 6, 18)

    expect(fairValue).not.toBeNull()
    if (fairValue) {
      const ethAmount = Number(fairValue) / 1e18
      expect(ethAmount).toBeGreaterThan(0.5)
      expect(ethAmount).toBeLessThan(3)
    }
  }, 15000)
})
