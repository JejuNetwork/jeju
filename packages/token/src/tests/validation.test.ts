/**
 * @fileoverview Comprehensive tests for Zod validation schemas
 * Tests edge cases, boundary conditions, and error handling
 */

import { describe, expect, test } from 'bun:test'
import {
  isValidAddress,
  isValidChainId,
  isValidHex,
  safeParse,
  ValidationError,
  validate,
  validateAddress,
} from '../validation'
import {
  addressSchema,
  bpsSchema,
  bridgeRequestSchema,
  bytes32Schema,
  chainIdSchema,
  evmChainIdSchema,
  feeDistributionSchema,
  hexSchema,
  liquidityConfigSchema,
  nonNegativeBigintSchema,
  percentageSchema,
  positiveBigintSchema,
  solanaNetworkSchema,
  solanaPublicKeySchema,
  tokenAllocationSchema,
  tokenEconomicsSchema,
  vestingScheduleSchema,
} from '../validation/schemas'

// ADDRESS SCHEMA

describe('addressSchema - Valid Addresses', () => {
  // Note: viem's isAddress requires valid checksums for mixed-case addresses
  // All lowercase or all uppercase hex (after 0x) is always valid
  const validAddresses = [
    '0x0000000000000000000000000000000000000000', // Zero address
    '0x1234567890123456789012345678901234567890', // All lowercase
    '0xffffffffffffffffffffffffffffffffffffffff', // All lowercase
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Valid checksum (WETH)
  ]

  test('accepts valid 40-character hex addresses', () => {
    for (const addr of validAddresses) {
      const result = addressSchema.safeParse(addr)
      expect(result.success).toBe(true)
    }
  })
})

describe('addressSchema - Invalid Addresses', () => {
  test('rejects address without 0x prefix', () => {
    const result = addressSchema.safeParse(
      '1234567890123456789012345678901234567890',
    )
    expect(result.success).toBe(false)
  })

  test('rejects address with wrong length (too short)', () => {
    const result = addressSchema.safeParse(
      '0x123456789012345678901234567890123456789',
    )
    expect(result.success).toBe(false)
  })

  test('rejects address with wrong length (too long)', () => {
    const result = addressSchema.safeParse(
      '0x12345678901234567890123456789012345678901',
    )
    expect(result.success).toBe(false)
  })

  test('rejects address with invalid characters', () => {
    const result = addressSchema.safeParse(
      '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG',
    )
    expect(result.success).toBe(false)
  })

  test('rejects empty string', () => {
    const result = addressSchema.safeParse('')
    expect(result.success).toBe(false)
  })

  test('rejects just 0x', () => {
    const result = addressSchema.safeParse('0x')
    expect(result.success).toBe(false)
  })

  test('rejects number', () => {
    const result = addressSchema.safeParse(123)
    expect(result.success).toBe(false)
  })

  test('rejects null', () => {
    const result = addressSchema.safeParse(null)
    expect(result.success).toBe(false)
  })
})

// HEX SCHEMA

describe('hexSchema - Valid Hex Strings', () => {
  test('accepts valid hex strings', () => {
    const validHex = [
      '0x1',
      '0x123',
      '0xabcdef',
      '0xABCDEF',
      '0x1234567890abcdef',
    ]

    for (const hex of validHex) {
      const result = hexSchema.safeParse(hex)
      expect(result.success).toBe(true)
    }
  })
})

describe('hexSchema - Invalid Hex Strings', () => {
  test('rejects without 0x prefix', () => {
    const result = hexSchema.safeParse('1234abcd')
    expect(result.success).toBe(false)
  })

  // Note: viem's isHex accepts '0x' as valid empty hex
  test('accepts empty hex (0x)', () => {
    const result = hexSchema.safeParse('0x')
    expect(result.success).toBe(true)
  })

  test('rejects with invalid characters', () => {
    const result = hexSchema.safeParse('0xghijk')
    expect(result.success).toBe(false)
  })
})

// BYTES32 SCHEMA

describe('bytes32Schema', () => {
  test('accepts valid bytes32', () => {
    const validBytes32 =
      '0x1234567890123456789012345678901234567890123456789012345678901234'
    const result = bytes32Schema.safeParse(validBytes32)
    expect(result.success).toBe(true)
  })

  test('rejects bytes32 with wrong length', () => {
    const tooShort =
      '0x123456789012345678901234567890123456789012345678901234567890123'
    const tooLong =
      '0x12345678901234567890123456789012345678901234567890123456789012345'

    expect(bytes32Schema.safeParse(tooShort).success).toBe(false)
    expect(bytes32Schema.safeParse(tooLong).success).toBe(false)
  })

  test('rejects bytes32 with invalid characters', () => {
    const invalid =
      '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG'
    expect(bytes32Schema.safeParse(invalid).success).toBe(false)
  })
})

// SOLANA PUBLIC KEY SCHEMA

describe('solanaPublicKeySchema', () => {
  test('accepts valid Solana public keys', () => {
    const validKeys = [
      'EitxJuv2iBjsg2d7jVy2LDC1e2zBrx4GB5Y9h2Ko3A9Y',
      '11111111111111111111111111111111',
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    ]

    for (const key of validKeys) {
      const result = solanaPublicKeySchema.safeParse(key)
      expect(result.success).toBe(true)
    }
  })

  test('rejects invalid Solana public keys', () => {
    const invalidKeys = [
      '0x1234', // EVM format
      'abc', // Too short
      'O0Il', // Invalid base58 (contains 0, O, I, l)
    ]

    for (const key of invalidKeys) {
      const result = solanaPublicKeySchema.safeParse(key)
      expect(result.success).toBe(false)
    }
  })
})

// BIGINT SCHEMAS

describe('positiveBigintSchema', () => {
  test('accepts positive bigints', () => {
    const validValues = [1n, 100n, 10n ** 18n, 2n ** 128n]
    for (const val of validValues) {
      expect(positiveBigintSchema.safeParse(val).success).toBe(true)
    }
  })

  test('rejects zero', () => {
    expect(positiveBigintSchema.safeParse(0n).success).toBe(false)
  })

  test('rejects negative bigints', () => {
    expect(positiveBigintSchema.safeParse(-1n).success).toBe(false)
    expect(positiveBigintSchema.safeParse(-100n).success).toBe(false)
  })

  test('rejects non-bigint types', () => {
    expect(positiveBigintSchema.safeParse(1).success).toBe(false)
    expect(positiveBigintSchema.safeParse('1').success).toBe(false)
  })
})

describe('nonNegativeBigintSchema', () => {
  test('accepts zero and positive bigints', () => {
    expect(nonNegativeBigintSchema.safeParse(0n).success).toBe(true)
    expect(nonNegativeBigintSchema.safeParse(1n).success).toBe(true)
    expect(nonNegativeBigintSchema.safeParse(10n ** 18n).success).toBe(true)
  })

  test('rejects negative bigints', () => {
    expect(nonNegativeBigintSchema.safeParse(-1n).success).toBe(false)
  })
})

// PERCENTAGE AND BPS SCHEMAS

describe('percentageSchema', () => {
  test('accepts valid percentages', () => {
    const validPercentages = [0, 1, 50, 99.99, 100]
    for (const pct of validPercentages) {
      expect(percentageSchema.safeParse(pct).success).toBe(true)
    }
  })

  test('rejects negative percentages', () => {
    expect(percentageSchema.safeParse(-1).success).toBe(false)
    expect(percentageSchema.safeParse(-0.01).success).toBe(false)
  })

  test('rejects percentages over 100', () => {
    expect(percentageSchema.safeParse(100.01).success).toBe(false)
    expect(percentageSchema.safeParse(101).success).toBe(false)
  })
})

describe('bpsSchema (Basis Points)', () => {
  test('accepts valid basis points', () => {
    const validBps = [0, 1, 30, 100, 500, 1000, 10000]
    for (const bps of validBps) {
      expect(bpsSchema.safeParse(bps).success).toBe(true)
    }
  })

  test('rejects negative basis points', () => {
    expect(bpsSchema.safeParse(-1).success).toBe(false)
  })

  test('rejects basis points over 10000 (100%)', () => {
    expect(bpsSchema.safeParse(10001).success).toBe(false)
  })

  test('rejects non-integer basis points', () => {
    expect(bpsSchema.safeParse(30.5).success).toBe(false)
  })
})

// CHAIN ID SCHEMAS

describe('evmChainIdSchema', () => {
  test('accepts positive integer chain IDs', () => {
    const validIds = [1, 10, 56, 137, 8453, 42161, 11155111]
    for (const id of validIds) {
      expect(evmChainIdSchema.safeParse(id).success).toBe(true)
    }
  })

  test('rejects zero', () => {
    expect(evmChainIdSchema.safeParse(0).success).toBe(false)
  })

  test('rejects negative chain IDs', () => {
    expect(evmChainIdSchema.safeParse(-1).success).toBe(false)
  })

  test('rejects non-integer chain IDs', () => {
    expect(evmChainIdSchema.safeParse(1.5).success).toBe(false)
  })
})

describe('solanaNetworkSchema', () => {
  test('accepts valid Solana networks', () => {
    expect(solanaNetworkSchema.safeParse('solana-mainnet').success).toBe(true)
    expect(solanaNetworkSchema.safeParse('solana-devnet').success).toBe(true)
  })

  test('rejects invalid network names', () => {
    expect(solanaNetworkSchema.safeParse('solana-testnet').success).toBe(false)
    expect(solanaNetworkSchema.safeParse('solana').success).toBe(false)
  })
})

describe('chainIdSchema (union)', () => {
  test('accepts EVM chain IDs', () => {
    expect(chainIdSchema.safeParse(1).success).toBe(true)
    expect(chainIdSchema.safeParse(8453).success).toBe(true)
  })

  test('accepts Solana networks', () => {
    expect(chainIdSchema.safeParse('solana-mainnet').success).toBe(true)
    expect(chainIdSchema.safeParse('solana-devnet').success).toBe(true)
  })

  test('rejects invalid values', () => {
    expect(chainIdSchema.safeParse(0).success).toBe(false)
    expect(chainIdSchema.safeParse('ethereum').success).toBe(false)
  })
})

// TOKEN ALLOCATION SCHEMA

describe('tokenAllocationSchema - Sum Validation', () => {
  test('accepts allocation summing to exactly 100', () => {
    const valid = {
      publicSale: 30,
      presale: 10,
      team: 15,
      advisors: 5,
      ecosystem: 25,
      liquidity: 10,
      stakingRewards: 5,
    }
    expect(tokenAllocationSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects allocation summing to less than 100', () => {
    const invalid = {
      publicSale: 30,
      presale: 10,
      team: 15,
      advisors: 5,
      ecosystem: 20, // Changed from 25 to 20
      liquidity: 10,
      stakingRewards: 5,
    } // Sum = 95
    expect(tokenAllocationSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects allocation summing to more than 100', () => {
    const invalid = {
      publicSale: 35, // Changed from 30 to 35
      presale: 10,
      team: 15,
      advisors: 5,
      ecosystem: 25,
      liquidity: 10,
      stakingRewards: 5,
    } // Sum = 105
    expect(tokenAllocationSchema.safeParse(invalid).success).toBe(false)
  })

  test('accepts allocation with zeros that sum to 100', () => {
    const valid = {
      publicSale: 100,
      presale: 0,
      team: 0,
      advisors: 0,
      ecosystem: 0,
      liquidity: 0,
      stakingRewards: 0,
    }
    expect(tokenAllocationSchema.safeParse(valid).success).toBe(true)
  })

  test('accepts fractional percentages that sum to 100', () => {
    const valid = {
      publicSale: 33.33,
      presale: 16.67,
      team: 10,
      advisors: 5,
      ecosystem: 20,
      liquidity: 10,
      stakingRewards: 5,
    }
    expect(tokenAllocationSchema.safeParse(valid).success).toBe(true)
  })
})

describe('tokenAllocationSchema - Field Validation', () => {
  test('rejects negative allocation values', () => {
    const invalid = {
      publicSale: -10,
      presale: 50,
      team: 20,
      advisors: 10,
      ecosystem: 20,
      liquidity: 5,
      stakingRewards: 5,
    }
    expect(tokenAllocationSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects allocation values over 100', () => {
    const invalid = {
      publicSale: 150,
      presale: -50,
      team: 0,
      advisors: 0,
      ecosystem: 0,
      liquidity: 0,
      stakingRewards: 0,
    }
    expect(tokenAllocationSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects missing fields', () => {
    const invalid = {
      publicSale: 50,
      presale: 50,
      // Missing other fields
    }
    expect(tokenAllocationSchema.safeParse(invalid).success).toBe(false)
  })
})

// FEE DISTRIBUTION SCHEMA

describe('feeDistributionSchema - Sum Validation', () => {
  test('accepts distribution summing to exactly 100', () => {
    const valid = {
      holders: 40,
      creators: 20,
      treasury: 20,
      liquidityProviders: 10,
      burn: 10,
    }
    expect(feeDistributionSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects distribution not summing to 100', () => {
    const tooLow = {
      holders: 40,
      creators: 20,
      treasury: 20,
      liquidityProviders: 10,
      burn: 5, // Sum = 95
    }
    expect(feeDistributionSchema.safeParse(tooLow).success).toBe(false)

    const tooHigh = {
      holders: 40,
      creators: 25,
      treasury: 20,
      liquidityProviders: 10,
      burn: 10, // Sum = 105
    }
    expect(feeDistributionSchema.safeParse(tooHigh).success).toBe(false)
  })

  test('accepts all-burn distribution', () => {
    const valid = {
      holders: 0,
      creators: 0,
      treasury: 0,
      liquidityProviders: 0,
      burn: 100,
    }
    expect(feeDistributionSchema.safeParse(valid).success).toBe(true)
  })
})

// VESTING SCHEDULE SCHEMA

describe('vestingScheduleSchema', () => {
  test('accepts valid vesting schedule', () => {
    const valid = {
      cliffDuration: 365 * 24 * 60 * 60, // 1 year
      vestingDuration: 3 * 365 * 24 * 60 * 60, // 3 years
      tgeUnlockPercent: 10,
      vestingType: 'linear',
    }
    expect(vestingScheduleSchema.safeParse(valid).success).toBe(true)
  })

  test('accepts zero cliff and vesting', () => {
    const valid = {
      cliffDuration: 0,
      vestingDuration: 0,
      tgeUnlockPercent: 100,
      vestingType: 'linear',
    }
    expect(vestingScheduleSchema.safeParse(valid).success).toBe(true)
  })

  test('accepts discrete vesting with periods', () => {
    const valid = {
      cliffDuration: 0,
      vestingDuration: 365 * 24 * 60 * 60,
      tgeUnlockPercent: 0,
      vestingType: 'discrete',
      discretePeriods: 12,
    }
    expect(vestingScheduleSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects negative cliff duration', () => {
    const invalid = {
      cliffDuration: -1,
      vestingDuration: 0,
      tgeUnlockPercent: 100,
      vestingType: 'linear',
    }
    expect(vestingScheduleSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects TGE unlock over 100%', () => {
    const invalid = {
      cliffDuration: 0,
      vestingDuration: 0,
      tgeUnlockPercent: 101,
      vestingType: 'linear',
    }
    expect(vestingScheduleSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects invalid vesting type', () => {
    const invalid = {
      cliffDuration: 0,
      vestingDuration: 0,
      tgeUnlockPercent: 100,
      vestingType: 'exponential',
    }
    expect(vestingScheduleSchema.safeParse(invalid).success).toBe(false)
  })
})

// LIQUIDITY CONFIG SCHEMA

describe('liquidityConfigSchema', () => {
  test('accepts valid liquidity config with allocations summing to 100', () => {
    const valid = {
      lockDuration: 365 * 24 * 60 * 60,
      lpTokenRecipient: '0x1234567890123456789012345678901234567890',
      allocations: [
        {
          chainId: 1,
          percentage: 60,
          initialPriceUsd: 1.0,
          pairedAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          dex: 'uniswap-v4',
        },
        {
          chainId: 8453,
          percentage: 40,
          initialPriceUsd: 1.0,
          pairedAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          dex: 'uniswap-v4',
        },
      ],
    }
    expect(liquidityConfigSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects allocations not summing to 100', () => {
    const invalid = {
      lockDuration: 0,
      lpTokenRecipient: '0x1234567890123456789012345678901234567890',
      allocations: [
        {
          chainId: 1,
          percentage: 60,
          initialPriceUsd: 1.0,
          pairedAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          dex: 'uniswap-v4',
        },
        // Sum = 60, not 100
      ],
    }
    expect(liquidityConfigSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects empty allocations', () => {
    const invalid = {
      lockDuration: 0,
      lpTokenRecipient: '0x1234567890123456789012345678901234567890',
      allocations: [],
    }
    expect(liquidityConfigSchema.safeParse(invalid).success).toBe(false)
  })
})

// BRIDGE REQUEST SCHEMA

describe('bridgeRequestSchema', () => {
  test('accepts valid bridge request', () => {
    const valid = {
      sourceChain: 1,
      destinationChain: 8453,
      sender: '0x1234567890123456789012345678901234567890',
      recipient: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      amount: 1000000000000000000n,
    }
    expect(bridgeRequestSchema.safeParse(valid).success).toBe(true)
  })

  test('accepts bridge request with callData', () => {
    const valid = {
      sourceChain: 1,
      destinationChain: 'solana-mainnet',
      sender: '0x1234567890123456789012345678901234567890',
      recipient: 'EitxJuv2iBjsg2d7jVy2LDC1e2zBrx4GB5Y9h2Ko3A9Y',
      amount: 1000000000n,
      callData: '0x1234abcd',
    }
    expect(bridgeRequestSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects zero amount', () => {
    const invalid = {
      sourceChain: 1,
      destinationChain: 8453,
      sender: '0x1234567890123456789012345678901234567890',
      recipient: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      amount: 0n,
    }
    expect(bridgeRequestSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects negative amount', () => {
    const invalid = {
      sourceChain: 1,
      destinationChain: 8453,
      sender: '0x1234567890123456789012345678901234567890',
      recipient: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      amount: -1n,
    }
    expect(bridgeRequestSchema.safeParse(invalid).success).toBe(false)
  })
})

// VALIDATOR FUNCTIONS

describe('validate function', () => {
  test('returns validated data on success', () => {
    const result = validate(
      addressSchema,
      '0x1234567890123456789012345678901234567890',
    )
    expect(result).toBe('0x1234567890123456789012345678901234567890')
  })

  test('throws ValidationError on failure', () => {
    expect(() => validate(addressSchema, 'invalid')).toThrow(ValidationError)
  })

  test('ValidationError contains error details', () => {
    try {
      validate(addressSchema, 'invalid')
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError)
      expect((e as ValidationError).errors.length).toBeGreaterThan(0)
    }
  })
})

describe('safeParse function', () => {
  test('returns success result for valid data', () => {
    const result = safeParse(
      addressSchema,
      '0x1234567890123456789012345678901234567890',
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('0x1234567890123456789012345678901234567890')
    }
  })

  test('returns failure result for invalid data', () => {
    const result = safeParse(addressSchema, 'invalid')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBeDefined()
    }
  })
})

describe('validateAddress function', () => {
  test('returns address for valid input', () => {
    const result = validateAddress('0x1234567890123456789012345678901234567890')
    expect(result).toBe('0x1234567890123456789012345678901234567890')
  })

  test('throws for invalid address', () => {
    expect(() => validateAddress('invalid')).toThrow(ValidationError)
  })
})

// TYPE GUARDS

describe('isValidAddress', () => {
  test('returns true for valid addresses', () => {
    expect(isValidAddress('0x1234567890123456789012345678901234567890')).toBe(
      true,
    )
  })

  test('returns false for invalid addresses', () => {
    expect(isValidAddress('invalid')).toBe(false)
    expect(isValidAddress('0x123')).toBe(false)
    expect(isValidAddress('')).toBe(false)
  })
})

describe('isValidChainId', () => {
  test('returns true for valid EVM chain IDs', () => {
    expect(isValidChainId(1)).toBe(true)
    expect(isValidChainId(8453)).toBe(true)
  })

  test('returns true for valid Solana networks', () => {
    expect(isValidChainId('solana-mainnet')).toBe(true)
    expect(isValidChainId('solana-devnet')).toBe(true)
  })

  test('returns false for invalid chain IDs', () => {
    expect(isValidChainId(0)).toBe(false)
    expect(isValidChainId(-1)).toBe(false)
    expect(isValidChainId('ethereum')).toBe(false)
    // null is now prevented at compile time since isValidChainId expects string | number
  })
})

describe('isValidHex', () => {
  test('returns true for valid hex strings', () => {
    expect(isValidHex('0x123abc')).toBe(true)
    expect(isValidHex('0xABCDEF')).toBe(true)
  })

  test('returns false for invalid hex strings', () => {
    expect(isValidHex('123abc')).toBe(false)
    // Note: isValidHex uses regex requiring at least one hex char after 0x
    // This differs from hexSchema which uses viem's isHex (accepts 0x)
    expect(isValidHex('0x')).toBe(false)
    expect(isValidHex('0xghij')).toBe(false)
  })
})

// TOKEN ECONOMICS FULL VALIDATION

describe('tokenEconomicsSchema - Full Integration', () => {
  const validVesting = {
    team: {
      cliffDuration: 31536000,
      vestingDuration: 94608000,
      tgeUnlockPercent: 0,
      vestingType: 'linear' as const,
    },
    advisors: {
      cliffDuration: 15768000,
      vestingDuration: 63072000,
      tgeUnlockPercent: 0,
      vestingType: 'linear' as const,
    },
    presale: {
      cliffDuration: 7884000,
      vestingDuration: 31536000,
      tgeUnlockPercent: 10,
      vestingType: 'linear' as const,
    },
    ecosystem: {
      cliffDuration: 0,
      vestingDuration: 126144000,
      tgeUnlockPercent: 5,
      vestingType: 'linear' as const,
    },
  }

  const validAllocation = {
    publicSale: 30,
    presale: 10,
    team: 15,
    advisors: 5,
    ecosystem: 25,
    liquidity: 10,
    stakingRewards: 5,
  }

  const validFeeDistribution = {
    holders: 40,
    creators: 20,
    treasury: 20,
    liquidityProviders: 10,
    burn: 10,
  }

  test('accepts valid complete token economics', () => {
    const valid = {
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 18,
      totalSupply: 1000000000n,
      allocation: validAllocation,
      vesting: validVesting,
      fees: {
        transferFeeBps: 0,
        bridgeFeeBps: 50,
        swapFeeBps: 30,
        distribution: validFeeDistribution,
        feeExemptAddresses: [],
      },
      maxWalletPercent: 0,
      maxTxPercent: 0,
    }
    expect(tokenEconomicsSchema.safeParse(valid).success).toBe(true)
  })

  test('rejects empty symbol', () => {
    const invalid = {
      name: 'Test Token',
      symbol: '',
      decimals: 18,
      totalSupply: 1000000000n,
      allocation: validAllocation,
      vesting: validVesting,
      fees: {
        transferFeeBps: 0,
        bridgeFeeBps: 50,
        swapFeeBps: 30,
        distribution: validFeeDistribution,
        feeExemptAddresses: [],
      },
      maxWalletPercent: 0,
      maxTxPercent: 0,
    }
    expect(tokenEconomicsSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects symbol longer than 10 chars', () => {
    const invalid = {
      name: 'Test Token',
      symbol: 'VERYLONGSYMBOL',
      decimals: 18,
      totalSupply: 1000000000n,
      allocation: validAllocation,
      vesting: validVesting,
      fees: {
        transferFeeBps: 0,
        bridgeFeeBps: 50,
        swapFeeBps: 30,
        distribution: validFeeDistribution,
        feeExemptAddresses: [],
      },
      maxWalletPercent: 0,
      maxTxPercent: 0,
    }
    expect(tokenEconomicsSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects decimals over 18', () => {
    const invalid = {
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 19,
      totalSupply: 1000000000n,
      allocation: validAllocation,
      vesting: validVesting,
      fees: {
        transferFeeBps: 0,
        bridgeFeeBps: 50,
        swapFeeBps: 30,
        distribution: validFeeDistribution,
        feeExemptAddresses: [],
      },
      maxWalletPercent: 0,
      maxTxPercent: 0,
    }
    expect(tokenEconomicsSchema.safeParse(invalid).success).toBe(false)
  })

  test('rejects negative decimals', () => {
    const invalid = {
      name: 'Test Token',
      symbol: 'TEST',
      decimals: -1,
      totalSupply: 1000000000n,
      allocation: validAllocation,
      vesting: validVesting,
      fees: {
        transferFeeBps: 0,
        bridgeFeeBps: 50,
        swapFeeBps: 30,
        distribution: validFeeDistribution,
        feeExemptAddresses: [],
      },
      maxWalletPercent: 0,
      maxTxPercent: 0,
    }
    expect(tokenEconomicsSchema.safeParse(invalid).success).toBe(false)
  })
})
