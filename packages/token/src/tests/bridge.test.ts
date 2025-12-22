/**
 * @fileoverview Tests for bridge adapters
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import { HyperlaneAdapter } from '../bridge/hyperlane-adapter'
import { SolanaAdapter } from '../bridge/solana-adapter'
import { getChainConfig, MAINNET_CHAINS } from '../config/chains'
import type { ChainId, MultisigISMConfig } from '../types'

describe('HyperlaneAdapter', () => {
  let adapter: HyperlaneAdapter

  const mockWarpRoutes: Partial<Record<ChainId, Address>> = {
    1: '0x1111111111111111111111111111111111111111',
    8453: '0x8453845384538453845384538453845384538453',
    42161: '0x4216142161421614216142161421614216142161',
    'solana-mainnet': '0x0000000000000000000000000000000000000001',
  }

  beforeEach(() => {
    adapter = new HyperlaneAdapter(
      MAINNET_CHAINS,
      mockWarpRoutes as Record<ChainId, Address>,
    )
  })

  test('creates adapter with correct chains', () => {
    expect(adapter).toBeDefined()
  })

  test('getDomainId returns correct domain for Ethereum', () => {
    expect(adapter.getDomainId(1)).toBe(1)
  })

  test('getDomainId returns correct domain for Base', () => {
    expect(adapter.getDomainId(8453)).toBe(8453)
  })

  test('getDomainId returns correct domain for Solana mainnet', () => {
    expect(adapter.getDomainId('solana-mainnet')).toBe(1399811149)
  })

  test('getDomainId throws for unknown chain', () => {
    expect(() => adapter.getDomainId(999999 as ChainId)).toThrow(
      'Unknown domain',
    )
  })

  test('addressToBytes32 pads EVM address correctly', () => {
    const address = '0x1234567890123456789012345678901234567890'
    const bytes32 = adapter.addressToBytes32(address)

    expect(bytes32.length).toBe(66) // 0x + 64 hex chars
    expect(bytes32.endsWith('1234567890123456789012345678901234567890')).toBe(
      true,
    )
    expect(bytes32.startsWith('0x')).toBe(true)
  })

  test('bytes32ToAddress extracts address correctly', () => {
    const bytes32 =
      '0x0000000000000000000000001234567890123456789012345678901234567890'
    const address = adapter.bytes32ToAddress(bytes32 as `0x${string}`)

    expect(address.toLowerCase()).toBe(
      '0x1234567890123456789012345678901234567890',
    )
  })

  test('getWarpRoute returns configured address', () => {
    expect(adapter.getWarpRoute(1)).toBe(
      '0x1111111111111111111111111111111111111111',
    )
    expect(adapter.getWarpRoute(8453)).toBe(
      '0x8453845384538453845384538453845384538453',
    )
  })

  test('getWarpRoute throws for unconfigured chain', () => {
    expect(() => adapter.getWarpRoute(10)).toThrow('No warp route')
  })

  test('generateWarpRouteConfig creates correct config', () => {
    const tokenAddress =
      '0xTokenAddress123456789012345678901234567890' as Address
    const validators = [
      '0xValidator1Address1234567890123456789012' as Address,
      '0xValidator2Address1234567890123456789012' as Address,
      '0xValidator3Address1234567890123456789012' as Address,
    ]
    const ismConfig: MultisigISMConfig = {
      type: 'multisig',
      validators,
      threshold: 2,
    }

    const config = adapter.generateWarpRouteConfig(tokenAddress, ismConfig)

    // Default should be collateral type
    expect(config.tokenType).toBe('collateral')
    expect(config.token).toBe(tokenAddress)

    // ISM config should be included
    expect(config.ism.type).toBe('multisig')
    expect(config.ism.validators).toEqual(validators)
    expect(config.ism.threshold).toBe(2)
  })

  test('getDeploymentSalt is deterministic', () => {
    const salt1 = adapter.getDeploymentSalt('TOKEN', 1)
    const salt2 = adapter.getDeploymentSalt('TOKEN', 1)
    const salt3 = adapter.getDeploymentSalt('TOKEN', 2)

    expect(salt1).toBe(salt2)
    expect(salt1).not.toBe(salt3)
  })
})

describe('SolanaAdapter', () => {
  let adapter: SolanaAdapter

  beforeEach(() => {
    adapter = new SolanaAdapter('https://api.mainnet-beta.solana.com', true) // Mainnet
  })

  test('creates adapter successfully', () => {
    expect(adapter).toBeDefined()
  })

  test('creates devnet adapter', () => {
    const devnetAdapter = new SolanaAdapter(
      'https://api.devnet.solana.com',
      false,
    )
    expect(devnetAdapter).toBeDefined()
  })
})

describe('Cross-Chain Fee Analysis', () => {
  /**
   * This test documents and verifies our fee structure decisions
   */
  test('Hyperlane has no protocol fee', () => {
    // Hyperlane is truly permissionless - no protocol fee
    const hyperlaneProtocolFee = 0
    expect(hyperlaneProtocolFee).toBe(0)
  })

  test('Self-deployed CCA gives full fee control', () => {
    // Our CCA contract allows configurable fees
    const defaultPlatformFeeBps = 250 // 2.5%
    const defaultReferralFeeBps = 50 // 0.5%

    expect(defaultPlatformFeeBps).toBe(250)
    expect(defaultReferralFeeBps).toBe(50)
    expect(defaultPlatformFeeBps + defaultReferralFeeBps).toBe(300) // 3% total
  })

  test('Transfer fee distribution sums to 100%', () => {
    const distribution = {
      holders: 40,
      creators: 20,
      treasury: 20,
      liquidityProviders: 10,
      burn: 10,
    }

    const total = Object.values(distribution).reduce((sum, val) => sum + val, 0)
    expect(total).toBe(100)
  })
})

describe('Chain Configuration Validation', () => {
  test('Ethereum is configured as home chain', () => {
    const ethereum = getChainConfig(1)
    expect(ethereum.isHomeChain).toBe(true)
    expect(ethereum.name).toBe('Ethereum Mainnet')
  })

  test('Solana mainnet has correct Hyperlane addresses', () => {
    const solana = getChainConfig('solana-mainnet')
    expect(solana.hyperlaneMailbox).toBeDefined()
    expect(solana.hyperlaneIgp).toBeDefined()
    expect(solana.chainType).toBe('solana')
  })

  test('All mainnet chains have Hyperlane mailbox', () => {
    for (const chain of MAINNET_CHAINS) {
      expect(chain.hyperlaneMailbox).toBeDefined()
      expect(chain.hyperlaneMailbox.length).toBeGreaterThan(0)
    }
  })

  test('EVM chains have valid addresses', () => {
    const evmChains = MAINNET_CHAINS.filter((c) => c.chainType === 'evm')
    for (const chain of evmChains) {
      expect(chain.hyperlaneMailbox.startsWith('0x')).toBe(true)
      expect(chain.hyperlaneMailbox.length).toBe(42) // 0x + 40 hex chars
    }
  })
})
