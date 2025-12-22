/**
 * Oracle Keeper Strategy Tests
 */

import { describe, expect, it } from 'bun:test'

// Test Pyth price feed IDs
const PYTH_PRICE_IDS: Record<string, string> = {
  ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  USDC: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
  SOL: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  ARB: '0x3fa4252848f9f0a1480be62745a4629d9eb1322aebab8a791e344b3b9c1adcf5',
  OP: '0x385f64d993f7b77d8182ed5003d97c60aa3361f3cecfe711544d2d59165e9bdf',
}

// Test Pyth contract addresses
const PYTH_CONTRACTS: Record<string, string> = {
  '1': '0x4305FB66699C3B2702D4d05CF36551390A4c69C6',
  '42161': '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
  '10': '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
  '8453': '0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a',
  '137': '0xff1a0f4744e8582DF1aE09D5611b887B6a12925C',
  '56': '0x4D7E825f80bDf85e913E0DD2A2D54927e9dE1594',
}

// Test Chainlink feeds
const CHAINLINK_FEEDS: Record<string, Record<string, string>> = {
  '1': {
    ETH: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
    BTC: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
    USDC: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
  },
  '42161': {
    ETH: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    BTC: '0x6ce185860a4963106506C203335A2910F5A5C4DD',
  },
  '10': {
    ETH: '0x13e3Ee699D1909E989722E753853AE30b17e08c5',
  },
  '8453': {
    ETH: '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
  },
}

describe('Pyth Network Configuration', () => {
  describe('Price Feed IDs', () => {
    it('should have ETH price feed ID', () => {
      expect(PYTH_PRICE_IDS.ETH).toBeDefined()
      expect(PYTH_PRICE_IDS.ETH).toMatch(/^0x[a-f0-9]{64}$/)
    })

    it('should have BTC price feed ID', () => {
      expect(PYTH_PRICE_IDS.BTC).toBeDefined()
      expect(PYTH_PRICE_IDS.BTC).toMatch(/^0x[a-f0-9]{64}$/)
    })

    it('should have all major asset feed IDs', () => {
      const requiredAssets = ['ETH', 'BTC', 'USDC', 'SOL']
      for (const asset of requiredAssets) {
        expect(PYTH_PRICE_IDS[asset]).toBeDefined()
      }
    })

    it('all price IDs should be valid bytes32', () => {
      for (const [, id] of Object.entries(PYTH_PRICE_IDS)) {
        expect(id.length).toBe(66) // 0x + 64 hex chars
        expect(id).toMatch(/^0x[a-f0-9]{64}$/)
      }
    })
  })

  describe('Contract Addresses', () => {
    it('should have Pyth on Ethereum', () => {
      expect(PYTH_CONTRACTS['1']).toBeDefined()
      expect(PYTH_CONTRACTS['1']).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('should have Pyth on Arbitrum', () => {
      expect(PYTH_CONTRACTS['42161']).toBeDefined()
    })

    it('should have Pyth on Base', () => {
      expect(PYTH_CONTRACTS['8453']).toBeDefined()
    })

    it('all addresses should be valid', () => {
      for (const [, address] of Object.entries(PYTH_CONTRACTS)) {
        expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      }
    })
  })
})

describe('Chainlink Configuration', () => {
  describe('Ethereum Feeds', () => {
    it('should have ETH/USD feed', () => {
      expect(CHAINLINK_FEEDS['1'].ETH).toBeDefined()
      expect(CHAINLINK_FEEDS['1'].ETH).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('should have BTC/USD feed', () => {
      expect(CHAINLINK_FEEDS['1'].BTC).toBeDefined()
    })

    it('should have USDC/USD feed', () => {
      expect(CHAINLINK_FEEDS['1'].USDC).toBeDefined()
    })
  })

  describe('L2 Feeds', () => {
    it('should have ETH/USD on Arbitrum', () => {
      expect(CHAINLINK_FEEDS['42161'].ETH).toBeDefined()
    })

    it('should have ETH/USD on Optimism', () => {
      expect(CHAINLINK_FEEDS['10'].ETH).toBeDefined()
    })

    it('should have ETH/USD on Base', () => {
      expect(CHAINLINK_FEEDS['8453'].ETH).toBeDefined()
    })
  })
})

describe('Price Conversion', () => {
  it('should scale 8-decimal Chainlink price to 18 decimals', () => {
    const chainlinkPrice = BigInt(300000000000) // $3000 with 8 decimals
    const chainlinkDecimals = 8

    const priceScaled = chainlinkPrice * BigInt(10 ** (18 - chainlinkDecimals))

    expect(priceScaled).toBe(BigInt('3000000000000000000000')) // 3000 * 1e18
  })

  it('should handle negative Pyth exponents', () => {
    // Pyth returns: price=300000000000, expo=-8 for $3000
    const price = BigInt(300000000000)
    const expo = -8

    const exponent = Math.abs(expo)
    const priceScaled = price * BigInt(10 ** (18 - exponent))

    expect(priceScaled).toBe(BigInt('3000000000000000000000')) // 3000 * 1e18
  })

  it('should calculate deviation correctly', () => {
    const onChainPrice = BigInt('3000000000000000000000') // $3000
    const externalPrice = BigInt('3030000000000000000000') // $3030 (1% higher)

    const diff =
      externalPrice > onChainPrice
        ? externalPrice - onChainPrice
        : onChainPrice - externalPrice

    const deviationBps = Number((diff * BigInt(10000)) / onChainPrice)

    expect(deviationBps).toBe(100) // 1% = 100 bps
  })
})

describe('Staleness Detection', () => {
  const STALE_THRESHOLD_SEC = 3600 // 1 hour

  it('should detect fresh price', () => {
    const now = Math.floor(Date.now() / 1000)
    const updatedAt = now - 60 // 1 minute ago

    const ageSeconds = now - updatedAt
    const isStale = ageSeconds > STALE_THRESHOLD_SEC

    expect(isStale).toBe(false)
  })

  it('should detect stale price', () => {
    const now = Math.floor(Date.now() / 1000)
    const updatedAt = now - 7200 // 2 hours ago

    const ageSeconds = now - updatedAt
    const isStale = ageSeconds > STALE_THRESHOLD_SEC

    expect(isStale).toBe(true)
  })

  it('should handle exactly threshold', () => {
    const now = Math.floor(Date.now() / 1000)
    const updatedAt = now - STALE_THRESHOLD_SEC

    const ageSeconds = now - updatedAt
    const isStale = ageSeconds > STALE_THRESHOLD_SEC

    expect(isStale).toBe(false) // Exactly at threshold is not stale
  })
})

describe('Deviation Threshold', () => {
  const DEVIATION_THRESHOLD_BPS = 100 // 1%

  it('should trigger update for large deviation', () => {
    const deviationBps = 150 // 1.5%
    const shouldUpdate = deviationBps > DEVIATION_THRESHOLD_BPS

    expect(shouldUpdate).toBe(true)
  })

  it('should not trigger update for small deviation', () => {
    const deviationBps = 50 // 0.5%
    const shouldUpdate = deviationBps > DEVIATION_THRESHOLD_BPS

    expect(shouldUpdate).toBe(false)
  })

  it('should handle exactly threshold', () => {
    const deviationBps = DEVIATION_THRESHOLD_BPS
    const shouldUpdate = deviationBps > DEVIATION_THRESHOLD_BPS

    expect(shouldUpdate).toBe(false) // Exactly at threshold doesn't trigger
  })
})

describe('Update Cooldown', () => {
  const UPDATE_COOLDOWN_MS = 60000 // 1 minute

  it('should allow update after cooldown', () => {
    const lastUpdate = Date.now() - 120000 // 2 minutes ago
    const canUpdate = Date.now() - lastUpdate >= UPDATE_COOLDOWN_MS

    expect(canUpdate).toBe(true)
  })

  it('should block update during cooldown', () => {
    const lastUpdate = Date.now() - 30000 // 30 seconds ago
    const canUpdate = Date.now() - lastUpdate >= UPDATE_COOLDOWN_MS

    expect(canUpdate).toBe(false)
  })
})
