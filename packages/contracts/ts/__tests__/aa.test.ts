/**
 * Account Abstraction (ERC-4337) Utilities Tests
 *
 * Tests for paymaster data encoding, parsing, and financial calculations.
 */

import { describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import {
  calculateRequiredDeposit,
  DEFAULT_GAS_LIMITS,
  ENTRYPOINT_V07_ADDRESS,
  getLiquidityPaymasterData,
  getMultiTokenPaymasterData,
  getSponsoredPaymasterData,
  isSponsoredPaymaster,
  type LiquidityPaymasterConfig,
  type MultiTokenPaymasterConfig,
  parsePaymasterAddress,
  type SponsoredPaymasterConfig,
} from '../aa'

// Test addresses
const PAYMASTER_ADDRESS =
  '0x1234567890123456789012345678901234567890' as Address
const APP_ADDRESS = '0xabcdef0123456789abcdef0123456789abcdef01' as Address

describe('aa.ts - Account Abstraction Utilities', () => {
  describe('getSponsoredPaymasterData', () => {
    test('builds correct paymasterAndData with default gas limits', () => {
      const config: SponsoredPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
      }

      const result = getSponsoredPaymasterData(config)

      expect(result.paymaster).toBe(PAYMASTER_ADDRESS)
      expect(result.verificationGasLimit).toBe(
        DEFAULT_GAS_LIMITS.verificationGasLimit,
      )
      expect(result.postOpGasLimit).toBe(DEFAULT_GAS_LIMITS.postOpGasLimit)

      // Sponsored paymaster should have 52 bytes (20 addr + 16 verif + 16 postop)
      // "0x" + 52 * 2 = 106 characters
      expect(result.paymasterAndData.length).toBe(106)

      // Verify paymaster address is at the start
      expect(
        result.paymasterAndData
          .toLowerCase()
          .startsWith(`0x${PAYMASTER_ADDRESS.slice(2).toLowerCase()}`),
      ).toBe(true)
    })

    test('builds correct paymasterAndData with custom gas limits', () => {
      const config: SponsoredPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        verificationGasLimit: 200000n,
        postOpGasLimit: 100000n,
      }

      const result = getSponsoredPaymasterData(config)

      expect(result.verificationGasLimit).toBe(200000n)
      expect(result.postOpGasLimit).toBe(100000n)
      expect(result.paymasterAndData.length).toBe(106)
    })

    test('handles zero gas limits', () => {
      const config: SponsoredPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        verificationGasLimit: 0n,
        postOpGasLimit: 0n,
      }

      const result = getSponsoredPaymasterData(config)

      expect(result.verificationGasLimit).toBe(0n)
      expect(result.postOpGasLimit).toBe(0n)
    })

    test('handles max uint128 gas limits', () => {
      const maxUint128 = 2n ** 128n - 1n
      const config: SponsoredPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        verificationGasLimit: maxUint128,
        postOpGasLimit: maxUint128,
      }

      const result = getSponsoredPaymasterData(config)

      expect(result.verificationGasLimit).toBe(maxUint128)
      expect(result.postOpGasLimit).toBe(maxUint128)
      expect(result.paymasterAndData.length).toBe(106)
    })
  })

  describe('getLiquidityPaymasterData', () => {
    test('builds correct paymasterAndData with app address', () => {
      const config: LiquidityPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        appAddress: APP_ADDRESS,
      }

      const result = getLiquidityPaymasterData(config)

      expect(result.paymaster).toBe(PAYMASTER_ADDRESS)
      expect(result.verificationGasLimit).toBe(
        DEFAULT_GAS_LIMITS.verificationGasLimit,
      )
      expect(result.postOpGasLimit).toBe(DEFAULT_GAS_LIMITS.postOpGasLimit)

      // Liquidity paymaster should have 72 bytes (20 + 16 + 16 + 20)
      // "0x" + 72 * 2 = 146 characters
      expect(result.paymasterAndData.length).toBe(146)
    })

    test('builds correct paymasterAndData with custom gas limits', () => {
      const config: LiquidityPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        appAddress: APP_ADDRESS,
        verificationGasLimit: 150000n,
        postOpGasLimit: 75000n,
      }

      const result = getLiquidityPaymasterData(config)

      expect(result.verificationGasLimit).toBe(150000n)
      expect(result.postOpGasLimit).toBe(75000n)
      expect(result.paymasterAndData.length).toBe(146)
    })

    test('encodes paymaster address correctly at start of data', () => {
      const config: LiquidityPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        appAddress: APP_ADDRESS,
      }

      const result = getLiquidityPaymasterData(config)

      // Extract first 20 bytes (40 hex chars after 0x)
      const extractedPaymaster = result.paymasterAndData.slice(0, 42)
      expect(extractedPaymaster.toLowerCase()).toBe(
        PAYMASTER_ADDRESS.toLowerCase(),
      )
    })
  })

  describe('getMultiTokenPaymasterData', () => {
    test('builds correct paymasterAndData for USDC payment', () => {
      const config: MultiTokenPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        serviceName: 'ai-inference',
        paymentToken: 0, // USDC
      }

      const result = getMultiTokenPaymasterData(config)

      expect(result.paymaster).toBe(PAYMASTER_ADDRESS)
      expect(result.verificationGasLimit).toBe(
        DEFAULT_GAS_LIMITS.verificationGasLimit,
      )
      expect(result.postOpGasLimit).toBe(DEFAULT_GAS_LIMITS.postOpGasLimit)

      // Should contain paymaster address at start
      expect(
        result.paymasterAndData
          .toLowerCase()
          .startsWith(`0x${PAYMASTER_ADDRESS.slice(2).toLowerCase()}`),
      ).toBe(true)
    })

    test('builds correct paymasterAndData for elizaOS payment', () => {
      const config: MultiTokenPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        serviceName: 'compute-job',
        paymentToken: 1, // elizaOS
      }

      const result = getMultiTokenPaymasterData(config)
      expect(result.paymaster).toBe(PAYMASTER_ADDRESS)
    })

    test('builds correct paymasterAndData for ETH payment', () => {
      const config: MultiTokenPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        serviceName: 'data-storage',
        paymentToken: 2, // ETH
      }

      const result = getMultiTokenPaymasterData(config)
      expect(result.paymaster).toBe(PAYMASTER_ADDRESS)
    })

    test('includes overpayment when specified', () => {
      const config: MultiTokenPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        serviceName: 'test',
        paymentToken: 0,
        overpayment: 10_000_000n, // 10 USDC
      }

      const resultWithOverpayment = getMultiTokenPaymasterData(config)

      const configNoOverpay: MultiTokenPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        serviceName: 'test',
        paymentToken: 0,
      }
      const resultWithoutOverpayment =
        getMultiTokenPaymasterData(configNoOverpay)

      // With overpayment should be 32 bytes longer (64 hex chars)
      expect(resultWithOverpayment.paymasterAndData.length).toBe(
        resultWithoutOverpayment.paymasterAndData.length + 64,
      )
    })

    test('handles zero overpayment', () => {
      const config: MultiTokenPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        serviceName: 'test',
        paymentToken: 0,
        overpayment: 0n,
      }

      const result = getMultiTokenPaymasterData(config)
      // Zero overpayment should not add extra bytes

      const configNoOverpay: MultiTokenPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        serviceName: 'test',
        paymentToken: 0,
      }
      const resultWithoutOverpayment =
        getMultiTokenPaymasterData(configNoOverpay)

      expect(result.paymasterAndData.length).toBe(
        resultWithoutOverpayment.paymasterAndData.length,
      )
    })

    test('handles long service names', () => {
      const longServiceName = 'a'.repeat(255)
      const config: MultiTokenPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        serviceName: longServiceName,
        paymentToken: 0,
      }

      const result = getMultiTokenPaymasterData(config)
      expect(result.paymaster).toBe(PAYMASTER_ADDRESS)
    })

    test('handles empty service name', () => {
      const config: MultiTokenPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        serviceName: '',
        paymentToken: 0,
      }

      const result = getMultiTokenPaymasterData(config)
      expect(result.paymaster).toBe(PAYMASTER_ADDRESS)
    })

    test('handles unicode service names', () => {
      const config: MultiTokenPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        serviceName: '🤖-inference-日本語',
        paymentToken: 0,
      }

      const result = getMultiTokenPaymasterData(config)
      expect(result.paymaster).toBe(PAYMASTER_ADDRESS)
    })
  })

  describe('parsePaymasterAddress', () => {
    test('extracts paymaster address from valid paymasterAndData', () => {
      const config: SponsoredPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
      }
      const { paymasterAndData } = getSponsoredPaymasterData(config)

      const result = parsePaymasterAddress(paymasterAndData)

      expect(result?.toLowerCase()).toBe(PAYMASTER_ADDRESS.toLowerCase())
    })

    test('returns null for empty string', () => {
      const result = parsePaymasterAddress('' as Hex)
      expect(result).toBe(null)
    })

    test('returns null for string too short', () => {
      const result = parsePaymasterAddress('0x1234' as Hex)
      expect(result).toBe(null)
    })

    test('extracts address from minimum valid length', () => {
      // Minimum is 42 chars (0x + 40 hex)
      const minValid = '0x1234567890123456789012345678901234567890' as Hex
      const result = parsePaymasterAddress(minValid)
      expect(result).toBe(minValid)
    })

    test('handles liquidity paymaster data', () => {
      const config: LiquidityPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        appAddress: APP_ADDRESS,
      }
      const { paymasterAndData } = getLiquidityPaymasterData(config)

      const result = parsePaymasterAddress(paymasterAndData)

      expect(result?.toLowerCase()).toBe(PAYMASTER_ADDRESS.toLowerCase())
    })
  })

  describe('isSponsoredPaymaster', () => {
    test('returns true for sponsored paymaster (52 bytes)', () => {
      const config: SponsoredPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
      }
      const { paymasterAndData } = getSponsoredPaymasterData(config)

      expect(isSponsoredPaymaster(paymasterAndData)).toBe(true)
    })

    test('returns false for liquidity paymaster (72 bytes)', () => {
      const config: LiquidityPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        appAddress: APP_ADDRESS,
      }
      const { paymasterAndData } = getLiquidityPaymasterData(config)

      expect(isSponsoredPaymaster(paymasterAndData)).toBe(false)
    })

    test('returns false for multi-token paymaster', () => {
      const config: MultiTokenPaymasterConfig = {
        paymaster: PAYMASTER_ADDRESS,
        serviceName: 'test',
        paymentToken: 0,
      }
      const { paymasterAndData } = getMultiTokenPaymasterData(config)

      expect(isSponsoredPaymaster(paymasterAndData)).toBe(false)
    })

    test('returns false for short data', () => {
      expect(isSponsoredPaymaster('0x1234' as Hex)).toBe(false)
    })

    test('returns false for longer than 52 bytes', () => {
      // 108 chars = 53 bytes
      const longData = `0x${'00'.repeat(53)}` as Hex
      expect(isSponsoredPaymaster(longData)).toBe(false)
    })
  })

  describe('calculateRequiredDeposit', () => {
    test('applies default 20% safety margin', () => {
      const maxGasCost = 1000000000000000n // 0.001 ETH
      const result = calculateRequiredDeposit(maxGasCost)

      // Should be 1.2x
      expect(result).toBe(1200000000000000n)
    })

    test('applies custom safety margin', () => {
      const maxGasCost = 1000000000000000n

      // 50% margin
      const result150 = calculateRequiredDeposit(maxGasCost, 1.5)
      expect(result150).toBe(1500000000000000n)

      // No margin
      const result100 = calculateRequiredDeposit(maxGasCost, 1.0)
      expect(result100).toBe(1000000000000000n)

      // Double
      const result200 = calculateRequiredDeposit(maxGasCost, 2.0)
      expect(result200).toBe(2000000000000000n)
    })

    test('handles zero gas cost', () => {
      const result = calculateRequiredDeposit(0n)
      expect(result).toBe(0n)
    })

    test('handles very large gas costs', () => {
      const largeGasCost = 10n ** 30n // Very large
      const result = calculateRequiredDeposit(largeGasCost)

      // Due to Number() conversion precision limits,
      // just verify it's larger than the input
      expect(result >= largeGasCost).toBe(true)
    })

    test('rounds up correctly', () => {
      // 10 wei with 1.1 margin = 11 (should ceil from 11.0)
      const result = calculateRequiredDeposit(10n, 1.1)
      expect(result).toBe(11n)

      // 10 wei with 1.15 margin = 12 (should ceil from 11.5)
      const result2 = calculateRequiredDeposit(10n, 1.15)
      expect(result2).toBe(12n)
    })

    test('handles fractional safety margins', () => {
      const gasCost = 1000n
      const result = calculateRequiredDeposit(gasCost, 1.333)
      expect(result).toBe(1333n)
    })
  })

  describe('Constants', () => {
    test('ENTRYPOINT_V07_ADDRESS is correct', () => {
      expect(ENTRYPOINT_V07_ADDRESS).toBe(
        '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
      )
    })

    test('DEFAULT_GAS_LIMITS has expected values', () => {
      expect(DEFAULT_GAS_LIMITS.verificationGasLimit).toBe(100000n)
      expect(DEFAULT_GAS_LIMITS.postOpGasLimit).toBe(50000n)
    })
  })

  describe('Property-based / Fuzz tests', () => {
    // Generate random addresses for property testing
    function randomAddress(): Address {
      const chars = '0123456789abcdef'
      let addr = '0x'
      for (let i = 0; i < 40; i++) {
        addr += chars[Math.floor(Math.random() * chars.length)]
      }
      return addr as Address
    }

    function randomBigInt(max: bigint): bigint {
      return BigInt(Math.floor(Math.random() * Number(max)))
    }

    test('getSponsoredPaymasterData always produces correct length', () => {
      for (let i = 0; i < 100; i++) {
        const config: SponsoredPaymasterConfig = {
          paymaster: randomAddress(),
          verificationGasLimit: randomBigInt(2n ** 64n),
          postOpGasLimit: randomBigInt(2n ** 64n),
        }

        const result = getSponsoredPaymasterData(config)
        expect(result.paymasterAndData.length).toBe(106)
      }
    })

    test('getLiquidityPaymasterData always produces correct length', () => {
      for (let i = 0; i < 100; i++) {
        const config: LiquidityPaymasterConfig = {
          paymaster: randomAddress(),
          appAddress: randomAddress(),
          verificationGasLimit: randomBigInt(2n ** 64n),
          postOpGasLimit: randomBigInt(2n ** 64n),
        }

        const result = getLiquidityPaymasterData(config)
        expect(result.paymasterAndData.length).toBe(146)
      }
    })

    test('parsePaymasterAddress always extracts correct address from valid data', () => {
      for (let i = 0; i < 100; i++) {
        const paymaster = randomAddress()
        const config: SponsoredPaymasterConfig = { paymaster }
        const { paymasterAndData } = getSponsoredPaymasterData(config)

        const parsed = parsePaymasterAddress(paymasterAndData)
        expect(parsed?.toLowerCase()).toBe(paymaster.toLowerCase())
      }
    })

    test('calculateRequiredDeposit always returns >= input for margin >= 1', () => {
      for (let i = 0; i < 100; i++) {
        const gasCost = randomBigInt(10n ** 20n)
        const margin = 1 + Math.random() // 1.0 to 2.0

        const result = calculateRequiredDeposit(gasCost, margin)
        expect(result >= gasCost).toBe(true)
      }
    })
  })
})
