/**
 * External Protocol Integration Tests
 *
 * Tests for the permissionless external protocol integrations:
 * - Across Protocol (cross-chain deposits)
 * - UniswapX (intent-based swaps)
 * - CoW Protocol (batch auctions)
 *
 * All integrations are fully permissionless - no API keys required.
 */

import { describe, expect, it } from 'bun:test'
import type { Address } from 'viem'
import {
  type ExternalOpportunityType,
  SUPPORTED_CHAINS,
} from '../../src/solver/external'
// Import modules to test type compatibility
import {
  ACROSS_SPOKE_POOLS,
  ACROSS_SPOKE_POOLS_TESTNET,
  type AcrossDeposit,
} from '../../src/solver/external/across'

import {
  COW_SETTLEMENT,
  type CowAuction,
  type CowOrder,
} from '../../src/solver/external/cow'
import {
  UNISWAPX_REACTORS,
  type UniswapXOrder,
} from '../../src/solver/external/uniswapx'

describe('External Protocol Addresses', () => {
  it('should have valid Across SpokePool addresses', () => {
    expect(Object.keys(ACROSS_SPOKE_POOLS).length).toBeGreaterThan(0)

    for (const [chainId, address] of Object.entries(ACROSS_SPOKE_POOLS)) {
      expect(Number(chainId)).toBeGreaterThan(0)
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    }
  })

  it('should have valid Across testnet addresses', () => {
    expect(Object.keys(ACROSS_SPOKE_POOLS_TESTNET).length).toBeGreaterThan(0)

    for (const [chainId, address] of Object.entries(
      ACROSS_SPOKE_POOLS_TESTNET,
    )) {
      expect(Number(chainId)).toBeGreaterThan(0)
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    }
  })

  it('should have valid UniswapX Reactor addresses', () => {
    expect(Object.keys(UNISWAPX_REACTORS).length).toBeGreaterThan(0)

    for (const [chainId, address] of Object.entries(UNISWAPX_REACTORS)) {
      expect(Number(chainId)).toBeGreaterThan(0)
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    }
  })

  it('should have valid CoW Settlement addresses', () => {
    expect(Object.keys(COW_SETTLEMENT).length).toBeGreaterThan(0)

    for (const [chainId, address] of Object.entries(COW_SETTLEMENT)) {
      expect(Number(chainId)).toBeGreaterThan(0)
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    }
  })
})

describe('Supported Chains', () => {
  it('should have all major chains defined', () => {
    expect(SUPPORTED_CHAINS.ethereum).toBe(1)
    expect(SUPPORTED_CHAINS.arbitrum).toBe(42161)
    expect(SUPPORTED_CHAINS.optimism).toBe(10)
    expect(SUPPORTED_CHAINS.base).toBe(8453)
    expect(SUPPORTED_CHAINS.polygon).toBe(137)
    expect(SUPPORTED_CHAINS.bsc).toBe(56)
    expect(SUPPORTED_CHAINS.jeju).toBe(420691)
  })
})

describe('Across Protocol Types', () => {
  it('should accept valid AcrossDeposit', () => {
    const deposit: AcrossDeposit = {
      depositId: 12345,
      originChainId: 1,
      destinationChainId: 8453,
      depositor: '0x1234567890123456789012345678901234567890' as Address,
      recipient: '0x1234567890123456789012345678901234567890' as Address,
      inputToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      outputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
      inputAmount: BigInt(1000000),
      outputAmount: BigInt(999000),
      relayerFeePct: BigInt(10),
      quoteTimestamp: 1700000000,
      fillDeadline: 1700003600,
      exclusivityDeadline: 1700000600,
      exclusiveRelayer: '0x0000000000000000000000000000000000000000' as Address,
      message: '0x' as `0x${string}`,
      transactionHash:
        '0x1234567890123456789012345678901234567890123456789012345678901234' as `0x${string}`,
      blockNumber: BigInt(18000000),
    }

    expect(deposit.depositId).toBe(12345)
    expect(deposit.originChainId).toBe(1)
    expect(deposit.destinationChainId).toBe(8453)
    expect(deposit.inputAmount).toBe(BigInt(1000000))
  })
})

describe('UniswapX Types', () => {
  it('should accept valid UniswapXOrder', () => {
    const order: UniswapXOrder = {
      orderHash:
        '0x1234567890123456789012345678901234567890123456789012345678901234' as `0x${string}`,
      chainId: 1,
      swapper: '0x1234567890123456789012345678901234567890' as Address,
      reactor: '0x6000da47483062A0D734Ba3dc7576Ce6A0B645C4' as Address,
      deadline: 1700003600,
      input: {
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
        amount: BigInt(1000000),
      },
      outputs: [
        {
          token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
          amount: BigInt(500000000000000),
          recipient: '0x1234567890123456789012345678901234567890' as Address,
        },
      ],
      decayStartTime: 1700000000,
      decayEndTime: 1700001800,
      nonce: BigInt(1),
      encodedOrder: '0x' as `0x${string}`,
      signature: '0x' as `0x${string}`,
      createdAt: 1700000000,
      orderStatus: 'open',
    }

    expect(order.chainId).toBe(1)
    expect(order.orderStatus).toBe('open')
    expect(order.input.amount).toBe(BigInt(1000000))
  })
})

describe('CoW Protocol Types', () => {
  it('should accept valid CowOrder', () => {
    const order: CowOrder = {
      uid: '0x1234567890123456789012345678901234567890123456789012345678901234' as `0x${string}`,
      chainId: 1,
      owner: '0x1234567890123456789012345678901234567890' as Address,
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
      sellAmount: BigInt(1000000),
      buyAmount: BigInt(500000000000000),
      validTo: 1700003600,
      appData:
        '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
      feeAmount: BigInt(1000),
      kind: 'sell',
      partiallyFillable: false,
      receiver: '0x1234567890123456789012345678901234567890' as Address,
      signature: '0x' as `0x${string}`,
      signingScheme: 'eip712',
      status: 'open',
      createdAt: 1700000000,
      filledAmount: BigInt(0),
    }

    expect(order.chainId).toBe(1)
    expect(order.status).toBe('open')
    expect(order.sellAmount).toBe(BigInt(1000000))
    expect(order.kind).toBe('sell')
  })

  it('should accept valid CowAuction', () => {
    const order: CowOrder = {
      uid: '0x1234567890123456789012345678901234567890123456789012345678901234' as `0x${string}`,
      chainId: 1,
      owner: '0x1234567890123456789012345678901234567890' as Address,
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
      sellAmount: BigInt(1000000),
      buyAmount: BigInt(500000000000000),
      validTo: 1700003600,
      appData:
        '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
      feeAmount: BigInt(1000),
      kind: 'sell',
      partiallyFillable: false,
      receiver: '0x1234567890123456789012345678901234567890' as Address,
      signature: '0x' as `0x${string}`,
      signingScheme: 'eip712',
      status: 'open',
      createdAt: 1700000000,
      filledAmount: BigInt(0),
    }

    const auction: CowAuction = {
      id: 12345,
      chainId: 1,
      orders: [order],
      tokens: [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
      ],
      deadline: 1700003600,
    }

    expect(auction.id).toBe(12345)
    expect(auction.chainId).toBe(1)
    expect(auction.orders.length).toBe(1)
    expect(auction.tokens.length).toBe(2)
  })
})

describe('External Opportunity Types', () => {
  it('should have valid opportunity types', () => {
    const types: ExternalOpportunityType[] = ['across', 'uniswapx', 'cow']

    expect(types).toContain('across')
    expect(types).toContain('uniswapx')
    expect(types).toContain('cow')
  })
})

describe('Profitability Calculations', () => {
  it('should calculate Across relayer fee correctly', () => {
    const inputAmount = BigInt(1000000) // 1 USDC
    const outputAmount = BigInt(999000) // 0.999 USDC

    const fee = inputAmount - outputAmount
    const feeBps = Number((fee * BigInt(10000)) / inputAmount)

    expect(fee).toBe(BigInt(1000)) // 0.001 USDC fee
    expect(feeBps).toBe(10) // 10 bps = 0.1%
  })

  it('should calculate spread for limit orders', () => {
    const makingAmount = BigInt(1000000)
    const takingAmount = BigInt(990000)

    const spread = makingAmount - takingAmount
    const spreadBps =
      spread > BigInt(0) ? Number((spread * BigInt(10000)) / takingAmount) : 0

    expect(spread).toBe(BigInt(10000))
    expect(spreadBps).toBeGreaterThan(100) // >1%
  })

  it('should handle zero/negative spreads', () => {
    const makingAmount = BigInt(990000)
    const takingAmount = BigInt(1000000)

    const spread = makingAmount - takingAmount
    const spreadBps =
      spread > BigInt(0) ? Number((spread * BigInt(10000)) / takingAmount) : 0

    expect(spreadBps).toBe(0)
  })
})
