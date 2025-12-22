import { describe, expect, test } from 'bun:test'
import {
  IERC20_ABI,
  LIQUIDITY_VAULT_ABI,
  PAYMASTER_FACTORY_ABI,
  TOKEN_REGISTRY_ABI,
  ZERO_ADDRESS,
  ZERO_BYTES32,
} from '../src/contracts'
import {
  calculateSharePercent,
  parseLPPosition,
  parsePositionFromBalance,
  parsePositionFromTuple,
} from '../src/hooks/liquidity-utils'

let sdkAvailable = false
try {
  const sdk = require('@jejunetwork/sdk')
  sdkAvailable = typeof sdk.createJejuClient === 'function'
} catch {
  sdkAvailable = false
}

// Test pure utility exports that don't require SDK
describe('Pure Utility Exports', () => {
  test('exports ZERO_ADDRESS constant', () => {
    expect(ZERO_ADDRESS).toBe('0x0000000000000000000000000000000000000000')
  })

  test('exports ZERO_BYTES32 constant', () => {
    expect(ZERO_BYTES32).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    )
  })

  test('exports TOKEN_REGISTRY_ABI', () => {
    expect(Array.isArray(TOKEN_REGISTRY_ABI)).toBe(true)
    expect(TOKEN_REGISTRY_ABI.length).toBeGreaterThan(0)
  })

  test('exports PAYMASTER_FACTORY_ABI', () => {
    expect(Array.isArray(PAYMASTER_FACTORY_ABI)).toBe(true)
    expect(PAYMASTER_FACTORY_ABI.length).toBeGreaterThan(0)
  })

  test('exports LIQUIDITY_VAULT_ABI', () => {
    expect(Array.isArray(LIQUIDITY_VAULT_ABI)).toBe(true)
    expect(LIQUIDITY_VAULT_ABI.length).toBeGreaterThan(0)
  })

  test('exports IERC20_ABI', () => {
    expect(Array.isArray(IERC20_ABI)).toBe(true)
    expect(IERC20_ABI.length).toBeGreaterThan(0)
  })
})

describe('Liquidity Utils Exports', () => {
  test('exports calculateSharePercent function', () => {
    expect(typeof calculateSharePercent).toBe('function')
  })

  test('exports parsePositionFromTuple function', () => {
    expect(typeof parsePositionFromTuple).toBe('function')
  })

  test('exports parsePositionFromBalance function', () => {
    expect(typeof parsePositionFromBalance).toBe('function')
  })

  test('exports parseLPPosition function', () => {
    expect(typeof parseLPPosition).toBe('function')
  })
})

// Conditional tests that require SDK to be built
describe.skipIf(!sdkAvailable)('UI Package Exports (requires SDK)', () => {
  test('exports NetworkProvider', async () => {
    const { NetworkProvider } = await import('../src/index')
    expect(NetworkProvider).toBeDefined()
    expect(typeof NetworkProvider).toBe('function')
  })

  test('exports useJeju hook', async () => {
    const { useJeju } = await import('../src/index')
    expect(useJeju).toBeDefined()
    expect(typeof useJeju).toBe('function')
  })

  test('exports useBalance hook', async () => {
    const { useBalance } = await import('../src/index')
    expect(useBalance).toBeDefined()
    expect(typeof useBalance).toBe('function')
  })

  test('exports useCompute hook', async () => {
    const { useCompute } = await import('../src/index')
    expect(useCompute).toBeDefined()
    expect(typeof useCompute).toBe('function')
  })

  test('exports useStorage hook', async () => {
    const { useStorage } = await import('../src/index')
    expect(useStorage).toBeDefined()
    expect(typeof useStorage).toBe('function')
  })

  test('exports useDefi hook', async () => {
    const { useDefi } = await import('../src/index')
    expect(useDefi).toBeDefined()
    expect(typeof useDefi).toBe('function')
  })

  test('exports useGovernance hook', async () => {
    const { useGovernance } = await import('../src/index')
    expect(useGovernance).toBeDefined()
    expect(typeof useGovernance).toBe('function')
  })

  test('exports useNames hook', async () => {
    const { useNames } = await import('../src/index')
    expect(useNames).toBeDefined()
    expect(typeof useNames).toBe('function')
  })

  test('exports useIdentity hook', async () => {
    const { useIdentity } = await import('../src/index')
    expect(useIdentity).toBeDefined()
    expect(typeof useIdentity).toBe('function')
  })

  test('exports useCrossChain hook', async () => {
    const { useCrossChain } = await import('../src/index')
    expect(useCrossChain).toBeDefined()
    expect(typeof useCrossChain).toBe('function')
  })

  test('exports usePayments hook', async () => {
    const { usePayments } = await import('../src/index')
    expect(usePayments).toBeDefined()
    expect(typeof usePayments).toBe('function')
  })
})

describe.skipIf(!sdkAvailable)('Hook Return Types (requires SDK)', () => {
  test('hooks throw when used outside provider', async () => {
    const { useJeju } = await import('../src/index')

    // Hooks should throw when used outside JejuProvider
    expect(() => {
      useJeju()
    }).toThrow()
  })
})
