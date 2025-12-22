/**
 * @fileoverview Comprehensive tests for HyperlaneAdapter
 * Tests error handling, edge cases, and actual data transformations
 */

import { beforeEach, describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import { HyperlaneAdapter } from '../bridge/hyperlane-adapter'
import { ALL_CHAINS, MAINNET_CHAINS, TESTNET_CHAINS } from '../config/chains'
import type { ChainId, MultisigISMConfig } from '../types'

describe('HyperlaneAdapter - Construction', () => {
  const emptyRoutes = {} as Record<ChainId, Address>

  test('creates adapter with empty chain list', () => {
    const adapter = new HyperlaneAdapter([], emptyRoutes)
    expect(adapter).toBeDefined()
  })

  test('creates adapter with empty warp routes', () => {
    const adapter = new HyperlaneAdapter(MAINNET_CHAINS, emptyRoutes)
    expect(adapter).toBeDefined()
  })

  test('creates adapter with partial warp routes', () => {
    const partialRoutes: Partial<Record<ChainId, Address>> = {
      1: '0x1111111111111111111111111111111111111111',
    }
    const adapter = new HyperlaneAdapter(
      MAINNET_CHAINS,
      partialRoutes as Record<ChainId, Address>,
    )
    expect(adapter.getWarpRoute(1)).toBe(
      '0x1111111111111111111111111111111111111111',
    )
  })

  test('initializes public clients only for EVM chains', () => {
    const adapter = new HyperlaneAdapter(ALL_CHAINS, emptyRoutes)
    // EVM chains should have clients
    expect(() => adapter.getClient(1)).not.toThrow()
    // SVM chains should not have clients
    expect(() => adapter.getClient('solana-mainnet')).toThrow()
  })
})

describe('HyperlaneAdapter - addressToBytes32', () => {
  let adapter: HyperlaneAdapter
  const emptyRoutes = {} as Record<ChainId, Address>

  beforeEach(() => {
    adapter = new HyperlaneAdapter(MAINNET_CHAINS, emptyRoutes)
  })

  test('rejects short address (security validation)', () => {
    const address = '0x1'
    // Short addresses are rejected for security - proper EVM addresses must be 40 hex chars
    expect(() => adapter.addressToBytes32(address)).toThrow(
      'Invalid EVM address format',
    )
  })

  test('handles full-length address', () => {
    const address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    const bytes32 = adapter.addressToBytes32(address)
    expect(bytes32.length).toBe(66)
    expect(bytes32.endsWith('abcdefabcdefabcdefabcdefabcdefabcdefabcd')).toBe(
      true,
    )
  })

  test('handles address and normalizes to lowercase', () => {
    const address = '0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd' as Address
    const bytes32 = adapter.addressToBytes32(address)
    expect(bytes32.startsWith('0x')).toBe(true)
    expect(bytes32.endsWith('abcdefabcdefabcdefabcdefabcdefabcdefabcd')).toBe(
      true,
    )
  })

  test('handles mixed case address', () => {
    const address = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12'
    const bytes32 = adapter.addressToBytes32(address)
    expect(bytes32.toLowerCase()).toContain('abcdef')
  })

  test('handles zero address', () => {
    const address = '0x0000000000000000000000000000000000000000'
    const bytes32 = adapter.addressToBytes32(address)
    expect(bytes32).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    )
  })

  test('handles checksummed address', () => {
    // EIP-55 checksummed address
    const address = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
    const bytes32 = adapter.addressToBytes32(address)
    expect(bytes32.length).toBe(66)
    expect(bytes32.toLowerCase()).toContain(
      '5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
    )
  })
})

describe('HyperlaneAdapter - bytes32ToAddress', () => {
  let adapter: HyperlaneAdapter
  const emptyRoutes = {} as Record<ChainId, Address>

  beforeEach(() => {
    adapter = new HyperlaneAdapter(MAINNET_CHAINS, emptyRoutes)
  })

  test('extracts address from padded bytes32', () => {
    const bytes32 =
      '0x000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd' as Hex
    const address = adapter.bytes32ToAddress(bytes32)
    expect(address.toLowerCase()).toBe(
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    )
  })

  test('extracts address from zero-padded bytes32', () => {
    const bytes32 =
      '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex
    const address = adapter.bytes32ToAddress(bytes32)
    // bytes32ToAddress takes last 40 chars (20 bytes)
    expect(address).toBe('0x0000000000000000000000000000000000000001')
    expect(address.length).toBe(42)
  })

  test('round-trip: address -> bytes32 -> address', () => {
    const originalAddress = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'
    const bytes32 = adapter.addressToBytes32(originalAddress)
    const recoveredAddress = adapter.bytes32ToAddress(bytes32)
    expect(recoveredAddress.toLowerCase()).toBe(originalAddress.toLowerCase())
  })
})

describe('HyperlaneAdapter - getWarpRoute Error Handling', () => {
  let adapter: HyperlaneAdapter
  const routes = {
    1: '0x1111111111111111111111111111111111111111' as Address,
  } as Record<ChainId, Address>

  beforeEach(() => {
    adapter = new HyperlaneAdapter(MAINNET_CHAINS, routes)
  })

  test('throws for unconfigured EVM chain', () => {
    expect(() => adapter.getWarpRoute(8453)).toThrow('No warp route')
  })

  test('throws for unconfigured SVM chain', () => {
    expect(() => adapter.getWarpRoute('solana-mainnet')).toThrow(
      'No warp route',
    )
  })

  test('returns configured route', () => {
    const route = adapter.getWarpRoute(1)
    expect(route).toBe('0x1111111111111111111111111111111111111111')
  })
})

describe('HyperlaneAdapter - getClient Error Handling', () => {
  let adapter: HyperlaneAdapter
  const emptyRoutes = {} as Record<ChainId, Address>

  beforeEach(() => {
    adapter = new HyperlaneAdapter(MAINNET_CHAINS, emptyRoutes)
  })

  test('throws for chain not in config', () => {
    // Create adapter with only testnet chains
    const testnetAdapter = new HyperlaneAdapter(TESTNET_CHAINS, emptyRoutes)
    expect(() => testnetAdapter.getClient(1)).toThrow('No client for chain')
  })

  test('throws for SVM chain (no EVM client)', () => {
    expect(() => adapter.getClient('solana-mainnet')).toThrow(
      'Invalid EVM chain ID',
    )
  })
})

describe('HyperlaneAdapter - generateWarpRouteConfig', () => {
  let adapter: HyperlaneAdapter
  const tokenAddress = '0xTokenAddress123456789012345678901234567890' as Address
  const emptyRoutes = {} as Record<ChainId, Address>
  const validators = [
    '0xVal1Address12345678901234567890123456789' as Address,
    '0xVal2Address12345678901234567890123456789' as Address,
    '0xVal3Address12345678901234567890123456789' as Address,
  ]

  beforeEach(() => {
    adapter = new HyperlaneAdapter(MAINNET_CHAINS, emptyRoutes)
  })

  test('generates collateral config by default', () => {
    const ismConfig: MultisigISMConfig = {
      type: 'multisig',
      validators,
      threshold: 2,
    }
    const config = adapter.generateWarpRouteConfig(tokenAddress, ismConfig)
    expect(config.tokenType).toBe('collateral')
    expect(config.token).toBe(tokenAddress)
  })

  test('generates native config when isNative=true', () => {
    const ismConfig: MultisigISMConfig = {
      type: 'multisig',
      validators,
      threshold: 2,
    }
    const config = adapter.generateWarpRouteConfig(
      tokenAddress,
      ismConfig,
      true,
    )
    expect(config.tokenType).toBe('native')
    expect(config.token).toBe(tokenAddress)
  })

  test('includes ISM config in result', () => {
    const ismConfig: MultisigISMConfig = {
      type: 'multisig',
      validators,
      threshold: 2,
    }
    const config = adapter.generateWarpRouteConfig(tokenAddress, ismConfig)
    expect(config.ism.type).toBe('multisig')
    expect(config.ism.validators).toEqual(validators)
    expect(config.ism.threshold).toBe(2)
  })

  test('mailbox is placeholder address', () => {
    const ismConfig: MultisigISMConfig = {
      type: 'multisig',
      validators,
      threshold: 1,
    }
    const config = adapter.generateWarpRouteConfig(tokenAddress, ismConfig)
    expect(config.mailbox).toBe('0x0000000000000000000000000000000000000000')
  })

  test('preserves ISM threshold', () => {
    const ismConfig: MultisigISMConfig = {
      type: 'multisig',
      validators,
      threshold: 3,
    }
    const config = adapter.generateWarpRouteConfig(tokenAddress, ismConfig)
    expect(config.ism.threshold).toBe(3)
  })

  test('handles single validator', () => {
    const singleValidator = [validators[0]]
    const ismConfig: MultisigISMConfig = {
      type: 'multisig',
      validators: singleValidator,
      threshold: 1,
    }
    const config = adapter.generateWarpRouteConfig(tokenAddress, ismConfig)
    expect(config.ism.validators.length).toBe(1)
    expect(config.ism.threshold).toBe(1)
  })
})

describe('HyperlaneAdapter - getDeploymentSalt', () => {
  let adapter: HyperlaneAdapter
  const emptyRoutes = {} as Record<ChainId, Address>

  beforeEach(() => {
    adapter = new HyperlaneAdapter(MAINNET_CHAINS, emptyRoutes)
  })

  test('generates valid hex string', () => {
    const salt = adapter.getDeploymentSalt('TEST', 1)
    expect(salt.startsWith('0x')).toBe(true)
    expect(salt.length).toBe(66) // 0x + 64 hex chars
  })

  test('different symbols produce different salts', () => {
    const salt1 = adapter.getDeploymentSalt('TOKEN1', 1)
    const salt2 = adapter.getDeploymentSalt('TOKEN2', 1)
    expect(salt1).not.toBe(salt2)
  })

  test('different versions produce different salts', () => {
    const salt1 = adapter.getDeploymentSalt('TOKEN', 1)
    const salt2 = adapter.getDeploymentSalt('TOKEN', 2)
    expect(salt1).not.toBe(salt2)
  })

  test('same inputs always produce same output', () => {
    const results: Hex[] = []
    for (let i = 0; i < 10; i++) {
      results.push(adapter.getDeploymentSalt('TOKEN', 1))
    }
    const uniqueResults = new Set(results)
    expect(uniqueResults.size).toBe(1)
  })

  test('handles empty symbol', () => {
    const salt = adapter.getDeploymentSalt('', 1)
    expect(salt.length).toBe(66)
  })

  test('handles very long symbol', () => {
    const longSymbol = 'A'.repeat(1000)
    const salt = adapter.getDeploymentSalt(longSymbol, 1)
    expect(salt.length).toBe(66)
  })

  test('handles version 0', () => {
    const salt = adapter.getDeploymentSalt('TEST', 0)
    expect(salt.length).toBe(66)
  })

  test('handles large version numbers', () => {
    const salt = adapter.getDeploymentSalt('TEST', 1000000)
    expect(salt.length).toBe(66)
  })
})

describe('HyperlaneAdapter - computeWarpRouteAddress', () => {
  let adapter: HyperlaneAdapter
  const emptyRoutes = {} as Record<ChainId, Address>
  // Valid EVM addresses (40 hex chars after 0x)
  const factory = '0x1234567890123456789012345678901234567890' as Address
  const salt1 =
    '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex
  const salt2 =
    '0x0000000000000000000000000000000000000000000000000000000000000002' as Hex
  const initCodeHash =
    '0x1234567890123456789012345678901234567890123456789012345678901234' as Hex

  beforeEach(() => {
    adapter = new HyperlaneAdapter(MAINNET_CHAINS, emptyRoutes)
  })

  test('generates valid address format', () => {
    const address = adapter.computeWarpRouteAddress(
      factory,
      salt1,
      initCodeHash,
    )
    expect(address.startsWith('0x')).toBe(true)
    expect(address.length).toBe(42)
  })

  test('different salts produce different addresses', () => {
    const address1 = adapter.computeWarpRouteAddress(
      factory,
      salt1,
      initCodeHash,
    )
    const address2 = adapter.computeWarpRouteAddress(
      factory,
      salt2,
      initCodeHash,
    )
    expect(address1).not.toBe(address2)
  })

  test('is deterministic', () => {
    const address1 = adapter.computeWarpRouteAddress(
      factory,
      salt1,
      initCodeHash,
    )
    const address2 = adapter.computeWarpRouteAddress(
      factory,
      salt1,
      initCodeHash,
    )
    expect(address1).toBe(address2)
  })
})
