import { describe, expect, test } from 'bun:test'
import { getL2RpcUrl } from '@jejunetwork/config'
import {
  createSecureNodeClient,
  getChain,
  getContractAddresses,
  jejuMainnet,
  jejuTestnet,
  networkLocalnet,
} from './contracts'

describe('Contract Client', () => {
  test('getChain returns correct chain for localnet', () => {
    const chain = getChain(31337)
    expect(chain.id).toBe(31337)
    expect(chain.name.toLowerCase()).toContain('local')
  })

  test('getChain returns correct chain for testnet', () => {
    const chain = getChain(420691)
    expect(chain.id).toBe(420691)
    expect(typeof chain.name).toBe('string')
    expect(chain.name.length).toBeGreaterThan(0)
  })

  test('getChain returns correct chain for mainnet', () => {
    const chain = getChain(420690)
    expect(chain.id).toBe(420690)
    expect(typeof chain.name).toBe('string')
    expect(chain.name.length).toBeGreaterThan(0)
  })

  test('getChain throws for unknown chain', () => {
    expect(() => getChain(12345)).toThrow('Unknown chain ID: 12345')
  })

  test('getContractAddresses returns valid addresses for localnet', () => {
    const addresses = getContractAddresses(31337)

    expect(addresses.identityRegistry).toBeDefined()
    expect(addresses.identityRegistry).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(addresses.computeRegistry).toBeDefined()
    expect(addresses.nodeStakingManager).toBeDefined()
  })

  test('createSecureNodeClient creates client with KMS signer', () => {
    const keyId = 'test-key-id-12345'
    const client = createSecureNodeClient(getL2RpcUrl(), 31337, keyId)

    expect(client.publicClient).toBeDefined()
    expect(client.signer).toBeDefined()
    expect(client.keyId).toBe(keyId)
    expect(client.chainId).toBe(31337)
  })
})

describe('Chain Definitions', () => {
  test('networkLocalnet has correct chain ID', () => {
    expect(networkLocalnet.id).toBe(31337)
  })

  test('jejuTestnet and mainnet have distinct chain IDs', () => {
    expect(typeof jejuTestnet.id).toBe('number')
    expect(typeof jejuMainnet.id).toBe('number')
    expect(jejuTestnet.id).not.toBe(jejuMainnet.id)
    expect(jejuTestnet.id).not.toBe(31337)
    expect(jejuMainnet.id).not.toBe(31337)
  })

  test('chains have RPC URLs', () => {
    expect(networkLocalnet.rpcUrls.default.http.length).toBeGreaterThan(0)
    expect(jejuTestnet.rpcUrls.default.http.length).toBeGreaterThan(0)
    expect(jejuMainnet.rpcUrls.default.http.length).toBeGreaterThan(0)
  })
})
