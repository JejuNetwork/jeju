/**
 * Unit tests for Otto Launch Service
 */

import { describe, expect, test } from 'bun:test'
import {
  BondingCurveConfigSchema,
  DEFAULT_BONDING_CONFIG,
  DEFAULT_ICO_CONFIG,
  DEGEN_CONFIG,
  ICOConfigSchema,
  LaunchRequestSchema,
  LaunchResultSchema,
  LaunchTypeSchema,
  SocialLaunchConfigSchema,
  TokenCustomizationSchema,
} from '../../api/services/launch'
import {
  parseLaunchParams,
  validateLaunchParams,
} from '../../api/utils/parsing'

describe('LaunchTypeSchema', () => {
  test('accepts valid launch types', () => {
    expect(LaunchTypeSchema.parse('bonding')).toBe('bonding')
    expect(LaunchTypeSchema.parse('ico')).toBe('ico')
    expect(LaunchTypeSchema.parse('simple')).toBe('simple')
  })

  test('rejects invalid launch types', () => {
    expect(() => LaunchTypeSchema.parse('invalid')).toThrow()
    expect(() => LaunchTypeSchema.parse('')).toThrow()
  })
})

describe('BondingCurveConfigSchema', () => {
  test('validates default config', () => {
    const result = BondingCurveConfigSchema.safeParse(DEFAULT_BONDING_CONFIG)
    expect(result.success).toBe(true)
  })

  test('validates degen config', () => {
    const result = BondingCurveConfigSchema.safeParse(DEGEN_CONFIG)
    expect(result.success).toBe(true)
  })

  test('rejects invalid config', () => {
    expect(
      BondingCurveConfigSchema.safeParse({
        virtualEthReserves: '0', // Must be positive
        graduationTarget: '10',
        tokenSupply: '1000000000',
      }).success,
    ).toBe(false)

    expect(
      BondingCurveConfigSchema.safeParse({
        virtualEthReserves: '-5', // Negative
        graduationTarget: '10',
        tokenSupply: '1000000000',
      }).success,
    ).toBe(false)
  })
})

describe('ICOConfigSchema', () => {
  test('validates default config', () => {
    const result = ICOConfigSchema.safeParse(DEFAULT_ICO_CONFIG)
    expect(result.success).toBe(true)
  })

  test('rejects hard cap less than soft cap', () => {
    const invalidConfig = {
      ...DEFAULT_ICO_CONFIG,
      softCap: '100',
      hardCap: '50', // Less than soft cap
    }
    const result = ICOConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })

  test('rejects invalid allocation bps', () => {
    const invalidConfig = {
      ...DEFAULT_ICO_CONFIG,
      presaleAllocationBps: 15000, // Over 100%
    }
    const result = ICOConfigSchema.safeParse(invalidConfig)
    expect(result.success).toBe(false)
  })
})

describe('TokenCustomizationSchema', () => {
  test('validates minimal token config', () => {
    // imageUrl is required
    const result = TokenCustomizationSchema.safeParse({
      name: 'Moon Token',
      symbol: 'MOON',
      imageUrl: 'https://example.com/moon.png',
      initialSupply: '1000000000000000000000000000',
    })
    expect(result.success).toBe(true)
  })

  test('validates full token config', () => {
    const result = TokenCustomizationSchema.safeParse({
      name: 'Moon Token',
      symbol: 'MOON',
      description: 'To the moon',
      imageUrl: 'https://example.com/moon.png',
      websiteUrl: 'https://moontoken.com',
      twitterUrl: 'https://twitter.com/moontoken', // Changed from twitterHandle
      telegramUrl: 'https://t.me/moontoken',
      farcasterUrl: 'https://warpcast.com/moontoken',
      initialSupply: '1000000000000000000000000000',
      antiSnipe: true,
      antiSnipeBlocks: 3,
      tradingDelayBlocks: 5,
      lockLiquidity: true,
      liquidityLockDuration: 90 * 24 * 60 * 60,
    })
    expect(result.success).toBe(true)
  })

  test('rejects symbol too long', () => {
    const result = TokenCustomizationSchema.safeParse({
      name: 'Moon Token',
      symbol: 'MOONTOKENVERYLONG', // Over 10 chars
      imageUrl: 'https://example.com/moon.png',
      initialSupply: '1000000000',
    })
    expect(result.success).toBe(false)
  })

  test('rejects invalid symbol characters', () => {
    const result = TokenCustomizationSchema.safeParse({
      name: 'Moon Token',
      symbol: 'moon!', // Special chars
      imageUrl: 'https://example.com/moon.png',
      initialSupply: '1000000000',
    })
    expect(result.success).toBe(false)
  })

  test('rejects missing imageUrl', () => {
    // imageUrl is required
    const result = TokenCustomizationSchema.safeParse({
      name: 'Moon Token',
      symbol: 'MOON',
      initialSupply: '1000000000',
    })
    expect(result.success).toBe(false)
  })
})

describe('SocialLaunchConfigSchema', () => {
  test('validates minimal social config', () => {
    const result = SocialLaunchConfigSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  test('validates full social config', () => {
    const result = SocialLaunchConfigSchema.safeParse({
      farcasterEnabled: true,
      farcasterChannelId: 'memecoins',
      farcasterCastOnLaunch: true,
      twitterEnabled: true,
      twitterTweetOnLaunch: true,
      discordEnabled: true,
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
      telegramEnabled: true,
      telegramChatId: '-100123456789',
      announcementTemplate: 'New token: {name} ({symbol})',
    })
    expect(result.success).toBe(true)
  })

  test('rejects invalid webhook URL', () => {
    const result = SocialLaunchConfigSchema.safeParse({
      discordEnabled: true,
      discordWebhookUrl: 'not-a-url',
    })
    expect(result.success).toBe(false)
  })
})

describe('LaunchRequestSchema', () => {
  test('validates minimal bonding launch request', () => {
    const result = LaunchRequestSchema.safeParse({
      userId: 'user123',
      walletAddress: '0x1234567890123456789012345678901234567890',
      chain: 'base',
      token: {
        name: 'Moon Token',
        symbol: 'MOON',
        imageUrl: 'https://example.com/moon.png',
        initialSupply: '1000000000000000000000000000',
      },
      launchType: 'bonding',
    })
    expect(result.success).toBe(true)
  })

  test('validates full ICO launch request', () => {
    const result = LaunchRequestSchema.safeParse({
      userId: 'user123',
      walletAddress: '0x1234567890123456789012345678901234567890',
      chain: 'base',
      chainId: 8453,
      token: {
        name: 'Presale Token',
        symbol: 'PRE',
        description: 'A great presale',
        imageUrl: 'https://example.com/presale.png',
        initialSupply: '1000000000000000000000000000',
        antiSnipe: true,
        antiSnipeBlocks: 5,
        tradingDelayBlocks: 10,
        lockLiquidity: true,
        liquidityLockDuration: 180 * 24 * 60 * 60,
      },
      launchType: 'ico',
      icoConfig: DEFAULT_ICO_CONFIG,
      social: {
        farcasterEnabled: true,
        twitterEnabled: true,
      },
    })
    expect(result.success).toBe(true)
  })

  test('rejects invalid wallet address', () => {
    const result = LaunchRequestSchema.safeParse({
      userId: 'user123',
      walletAddress: 'invalid',
      chain: 'base',
      token: {
        name: 'Moon Token',
        symbol: 'MOON',
        imageUrl: 'https://example.com/moon.png',
        initialSupply: '1000000000',
      },
      launchType: 'bonding',
    })
    expect(result.success).toBe(false)
  })
})

describe('LaunchResultSchema', () => {
  test('validates success result', () => {
    const result = LaunchResultSchema.safeParse({
      success: true,
      tokenAddress: '0x1234567890123456789012345678901234567890',
      poolAddress: '0x0987654321098765432109876543210987654321',
      txHash:
        '0x1234567890123456789012345678901234567890123456789012345678901234',
      launchId: 'launch_123',
    })
    expect(result.success).toBe(true)
  })

  test('validates failure result', () => {
    const result = LaunchResultSchema.safeParse({
      success: false,
      error: 'Insufficient funds',
    })
    expect(result.success).toBe(true)
  })

  test('validates result with social announcements', () => {
    const result = LaunchResultSchema.safeParse({
      success: true,
      tokenAddress: '0x1234567890123456789012345678901234567890',
      txHash:
        '0x1234567890123456789012345678901234567890123456789012345678901234',
      farcasterCastHash: '0xabc123',
      twitterTweetId: '1234567890',
    })
    expect(result.success).toBe(true)
  })
})

describe('parseLaunchParams', () => {
  test('parses basic launch command', () => {
    const result = parseLaunchParams('launch Moon Token MOON')
    expect(result.name).toBe('Moon Token')
    expect(result.symbol).toBe('MOON')
    expect(result.launchType).toBe('bonding')
  })

  test('parses launch with supply', () => {
    const result = parseLaunchParams('launch Moon Token MOON 1000000')
    expect(result.name).toBe('Moon Token')
    expect(result.symbol).toBe('MOON')
    expect(result.supply).toBe('1000000')
  })

  test('parses launch with liquidity', () => {
    const result = parseLaunchParams('launch Moon Token MOON 1000000 5ETH')
    expect(result.name).toBe('Moon Token')
    expect(result.symbol).toBe('MOON')
    expect(result.supply).toBe('1000000')
    expect(result.liquidity).toBe('5')
  })

  test('parses bonding curve launch', () => {
    const result = parseLaunchParams('launch Degen Token DEGEN bonding')
    expect(result.name).toBe('Degen Token')
    expect(result.symbol).toBe('DEGEN')
    expect(result.launchType).toBe('bonding')
  })

  test('parses ICO launch', () => {
    const result = parseLaunchParams('launch My Token MTK ico')
    expect(result.name).toBe('My Token')
    expect(result.symbol).toBe('MTK')
    expect(result.launchType).toBe('ico')
  })

  test('parses presale keyword as ICO', () => {
    const result = parseLaunchParams('launch My Token MTK presale')
    expect(result.launchType).toBe('ico')
  })

  test('parses quoted name', () => {
    const result = parseLaunchParams('launch "Moon Rocket Token" MRT')
    expect(result.name).toBe('Moon Rocket Token')
    expect(result.symbol).toBe('MRT')
  })

  test('parses create token syntax', () => {
    const result = parseLaunchParams('create token Moon MOON')
    expect(result.name).toBe('Moon')
    expect(result.symbol).toBe('MOON')
  })

  test('parses launch with chain specification', () => {
    const result = parseLaunchParams('launch Moon Token MOON on base')
    expect(result.name).toBe('Moon Token')
    expect(result.symbol).toBe('MOON')
    expect(result.chain).toBe('base')
  })

  test('parses launch with arbitrum chain', () => {
    const result = parseLaunchParams('launch Degen Token DEGEN on arbitrum')
    expect(result.name).toBe('Degen Token')
    expect(result.symbol).toBe('DEGEN')
    expect(result.chain).toBe('arbitrum')
  })

  test('handles empty input', () => {
    const result = parseLaunchParams('')
    expect(result.name).toBeUndefined()
    expect(result.symbol).toBeUndefined()
  })

  test('handles missing symbol', () => {
    const result = parseLaunchParams('launch Moon')
    expect(result.name).toBeUndefined()
    expect(result.symbol).toBeUndefined()
  })

  test('defaults to bonding launch type', () => {
    const result = parseLaunchParams('launch Test TOKEN')
    expect(result.launchType).toBe('bonding')
  })
})

describe('validateLaunchParams', () => {
  test('validates valid params', () => {
    const result = validateLaunchParams({
      name: 'Moon Token',
      symbol: 'MOON',
      supply: '1000000',
    })
    expect(result.valid).toBe(true)
  })

  test('rejects missing name', () => {
    const result = validateLaunchParams({
      symbol: 'MOON',
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('name')
  })

  test('rejects missing symbol', () => {
    const result = validateLaunchParams({
      name: 'Moon Token',
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('symbol')
  })

  test('rejects symbol too long', () => {
    const result = validateLaunchParams({
      name: 'Moon Token',
      symbol: 'MOONTOKENVERYLONG',
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('10 characters')
  })

  test('rejects invalid symbol characters', () => {
    const result = validateLaunchParams({
      name: 'Moon Token',
      symbol: 'MOO!N',
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('letters and numbers')
  })

  test('rejects invalid supply', () => {
    const result = validateLaunchParams({
      name: 'Moon Token',
      symbol: 'MOON',
      supply: '-100',
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('supply')
  })

  test('rejects invalid liquidity', () => {
    const result = validateLaunchParams({
      name: 'Moon Token',
      symbol: 'MOON',
      liquidity: 'abc',
    })
    expect(result.valid).toBe(false)
    expect(result.error).toContain('liquidity')
  })
})
