/**
 * @fileoverview Tests for type definitions and validation
 */

import { describe, expect, test } from 'bun:test'
import {
  getChainConfig,
  getEVMChains,
  getHomeChain,
  getSolanaChains,
  validateChainConfig,
} from '../config/chains'
import type {
  ChainId,
  FeeDistribution,
  TokenAllocation,
  VestingSchedule,
} from '../types'

describe('TokenEconomics', () => {
  test('allocation percentages should sum to 100', () => {
    const allocation: TokenAllocation = {
      publicSale: 30,
      presale: 10,
      team: 15,
      advisors: 5,
      ecosystem: 25,
      liquidity: 10,
      stakingRewards: 5,
    }

    const total = Object.values(allocation).reduce((sum, val) => sum + val, 0)
    expect(total).toBe(100)
  })

  test('fee distribution should sum to 100', () => {
    const distribution: FeeDistribution = {
      holders: 40,
      creators: 20,
      treasury: 20,
      liquidityProviders: 10,
      burn: 10,
    }

    const total = Object.values(distribution).reduce((sum, val) => sum + val, 0)
    expect(total).toBe(100)
  })

  test('vesting schedule should have valid parameters', () => {
    const schedule: VestingSchedule = {
      cliffDuration: 365 * 24 * 60 * 60, // 1 year
      vestingDuration: 3 * 365 * 24 * 60 * 60, // 3 years
      tgeUnlockPercent: 10,
      vestingType: 'linear',
    }

    expect(schedule.cliffDuration).toBeGreaterThan(0)
    expect(schedule.vestingDuration).toBeGreaterThan(0)
    expect(schedule.tgeUnlockPercent).toBeGreaterThanOrEqual(0)
    expect(schedule.tgeUnlockPercent).toBeLessThanOrEqual(100)
    expect(['linear', 'discrete']).toContain(schedule.vestingType)
  })
})

describe('ChainConfig', () => {
  test('should get Ethereum mainnet as home chain', () => {
    const home = getHomeChain()
    expect(home.chainId).toBe(1)
    expect(home.isHomeChain).toBe(true)
    expect(home.name).toBe('Ethereum Mainnet')
  })

  test('should get chain config by ID', () => {
    const baseConfig = getChainConfig(8453)
    expect(baseConfig.name).toBe('Base')
    expect(baseConfig.chainType).toBe('evm')
  })

  test('should throw for unknown chain ID', () => {
    expect(() => getChainConfig(999999 as ChainId)).toThrow('Unknown chain ID')
  })

  test('should get EVM chains only', () => {
    const evmChains = getEVMChains()
    expect(evmChains.length).toBeGreaterThan(0)
    expect(evmChains.every((c) => c.chainType === 'evm')).toBe(true)
  })

  test('should get Solana chains only', () => {
    const solanaChains = getSolanaChains()
    expect(solanaChains.length).toBeGreaterThan(0)
    expect(solanaChains.every((c) => c.chainType === 'solana')).toBe(true)
  })

  test('should validate chain config', () => {
    const validChain = getChainConfig(1)
    expect(() => validateChainConfig(validChain)).not.toThrow()
  })

  test('Solana mainnet should be configured', () => {
    const solana = getChainConfig('solana-mainnet')
    expect(solana.chainType).toBe('solana')
    expect(solana.nativeCurrency.symbol).toBe('SOL')
    expect(solana.nativeCurrency.decimals).toBe(9)
  })
})

describe('FeeComparison', () => {
  test('should document fee differences between platforms', () => {
    // This test documents the fee structure for reference
    const uniswapCCAFees = {
      auctionFee: 0, // No protocol fee
      tradingFee: 0.3, // 0.3% swap fee to LPs
      control: 'limited',
    }

    const hyperlaneFees = {
      protocolFee: 0, // No protocol fee
      relayerFee: 'variable', // Goes to relayer (can be you!)
      validatorFee: 0, // You run your own
    }

    // Document that Hyperlane is most permissionless
    expect(hyperlaneFees.protocolFee).toBe(0)
    expect(uniswapCCAFees.auctionFee).toBe(0)
  })
})

describe('SolanaIntegration', () => {
  test('should have Solana in mainnet chains', () => {
    const solanaChains = getSolanaChains(true)
    const solana = solanaChains.find((c) => c.chainId === 'solana-mainnet')
    expect(solana).toBeDefined()
  })

  test('should have Hyperlane mailbox configured for Solana', () => {
    const solana = getChainConfig('solana-mainnet')
    expect(solana.hyperlaneMailbox).toBeDefined()
    expect(solana.hyperlaneMailbox.length).toBeGreaterThan(0)
  })
})
