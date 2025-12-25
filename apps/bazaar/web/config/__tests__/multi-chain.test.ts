import { describe, expect, test } from 'bun:test'
import {
  EvmChainIds,
  getAvailableChains,
  isChainAvailable,
  isLocalnetMode,
} from '../multi-chain'

describe('Multi-Chain Config', () => {
  test('should have chain IDs defined', () => {
    expect(EvmChainIds.localnetChain).toBe(31337)
    expect(EvmChainIds.testnetChain).toBe(420690)
    expect(EvmChainIds.mainnetChain).toBe(420691)
    expect(EvmChainIds.EthereumMainnet).toBe(1)
    expect(EvmChainIds.EthereumSepolia).toBe(11155111)
  })

  test('should check if chain is available', () => {
    const jejuAvailable = isChainAvailable(EvmChainIds.localnetChain)
    expect(typeof jejuAvailable).toBe('boolean')
  })

  test('should get available chains', () => {
    const chains = getAvailableChains()
    expect(Array.isArray(chains)).toBe(true)
    expect(chains.length).toBeGreaterThan(0)
  })

  test('should detect localnet mode', () => {
    const isLocal = isLocalnetMode()
    expect(typeof isLocal).toBe('boolean')
  })
})
