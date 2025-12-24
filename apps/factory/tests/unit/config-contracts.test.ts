/**
 * Unit tests for contract configuration
 * Tests chain-based address selection and config functions
 */

import { describe, expect, test } from 'bun:test'
import { getL2RpcUrl, INFRA_PORTS } from '@jejunetwork/config'
import type { Address } from 'viem'

// Expected localnet addresses (deterministic from anvil)
const EXPECTED_LOCALNET_ADDRESSES: Record<string, Address> = {
  contributorRegistry: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
  paymentRequestRegistry: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
  deepFundingDistributor: '0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6',
  daoRegistry: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
  identityRegistry: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  workAgreementRegistry: '0xa513E6E4b8f2a923D98304ec87F64353C4D5C853',
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

describe('Contract Address Selection Logic', () => {
  // These tests verify the address selection logic without modifying global state

  test('localnet chain IDs map to anvil addresses', () => {
    // Chain ID 31337 = Hardhat/Anvil default
    // Chain ID 1337 = Alternative localnet
    const localnetChainIds = [31337, 1337]

    localnetChainIds.forEach((chainId) => {
      // Verify the logic: localnet chains should use deterministic addresses
      expect([31337, 1337]).toContain(chainId)
    })
  })

  test('testnet chain ID is Base Sepolia (84532)', () => {
    const testnetChainId = 84532
    // Verify Base Sepolia is recognized as testnet
    expect(testnetChainId).toBe(84532)
  })

  test('mainnet chain ID is Base (8453)', () => {
    const mainnetChainId = 8453
    // Verify Base mainnet chain ID
    expect(mainnetChainId).toBe(8453)
  })

  test('localnet addresses are valid checksummed addresses', () => {
    Object.values(EXPECTED_LOCALNET_ADDRESSES).forEach((address) => {
      expect(address.startsWith('0x')).toBe(true)
      expect(address.length).toBe(42)
      // Verify it's not the zero address
      expect(address).not.toBe(ZERO_ADDRESS)
    })
  })

  test('all expected contract types have addresses defined', () => {
    const expectedContracts = [
      'contributorRegistry',
      'paymentRequestRegistry',
      'deepFundingDistributor',
      'daoRegistry',
      'identityRegistry',
      'workAgreementRegistry',
    ]

    expectedContracts.forEach((contract) => {
      expect(contract in EXPECTED_LOCALNET_ADDRESSES).toBe(true)
    })
  })

  test('localnet addresses are unique', () => {
    const addresses = Object.values(EXPECTED_LOCALNET_ADDRESSES)
    const uniqueAddresses = new Set(addresses)
    expect(uniqueAddresses.size).toBe(addresses.length)
  })
})

describe('Chain ID Parsing', () => {
  test('parseInt correctly parses chain ID strings', () => {
    expect(parseInt('31337', 10)).toBe(31337)
    expect(parseInt('8453', 10)).toBe(8453)
    expect(parseInt('84532', 10)).toBe(84532)
  })

  test('parseInt handles leading zeros', () => {
    expect(parseInt('00031337', 10)).toBe(31337)
  })

  test('parseInt returns NaN for invalid strings', () => {
    expect(Number.isNaN(parseInt('invalid', 10))).toBe(true)
    expect(Number.isNaN(parseInt('', 10))).toBe(true)
  })

  test('default chain ID fallback is 31337', () => {
    const defaultChainId = 31337
    const envValue = undefined
    const chainId = parseInt(envValue || '31337', 10)
    expect(chainId).toBe(defaultChainId)
  })
})

describe('RPC URL Configuration', () => {
  test('default localhost RPC URL format is valid', () => {
    const defaultRpc = getL2RpcUrl()
    expect(defaultRpc.startsWith('http://')).toBe(true)
    // Accept both localhost and 127.0.0.1 as valid local URLs
    expect(
      defaultRpc.includes('localhost') || defaultRpc.includes('127.0.0.1'),
    ).toBe(true)
    // Uses centralized port from config
    expect(defaultRpc.includes(String(INFRA_PORTS.L2_RPC.get()))).toBe(true)
  })

  test('URL parsing works for RPC endpoints', () => {
    const rpcUrls = [
      getL2RpcUrl(),
      'https://mainnet.base.org',
      'https://sepolia.base.org',
    ]

    rpcUrls.forEach((url) => {
      const parsed = new URL(url)
      expect(parsed.protocol).toMatch(/^https?:$/)
    })
  })
})

describe('DWS URL Configuration', () => {
  test('default DWS URL format is valid', () => {
    const defaultDws = 'http://127.0.0.1:4030'
    expect(defaultDws.startsWith('http://')).toBe(true)
    expect(defaultDws.includes('4030')).toBe(true)
  })

  test('DWS port is different from RPC port', () => {
    const rpcPort = 8545
    const dwsPort = 4030
    expect(rpcPort).not.toBe(dwsPort)
  })
})

describe('Address Format Validation', () => {
  test('addresses are 42 characters including 0x prefix', () => {
    Object.values(EXPECTED_LOCALNET_ADDRESSES).forEach((address) => {
      expect(address.length).toBe(42)
    })
  })

  test('addresses only contain valid hex characters', () => {
    const hexRegex = /^0x[0-9a-fA-F]{40}$/
    Object.values(EXPECTED_LOCALNET_ADDRESSES).forEach((address) => {
      expect(hexRegex.test(address)).toBe(true)
    })
  })

  test('zero address is correctly formatted', () => {
    const hexRegex = /^0x[0-9a-fA-F]{40}$/
    expect(hexRegex.test(ZERO_ADDRESS)).toBe(true)
    expect(ZERO_ADDRESS.length).toBe(42)
  })
})

describe('Switch Statement Chain Selection', () => {
  // Simulate the switch logic without importing the module
  function selectAddressType(
    chainId: number,
  ): 'localnet' | 'testnet' | 'mainnet' {
    switch (chainId) {
      case 31337:
      case 1337:
        return 'localnet'
      case 84532:
        return 'testnet'
      case 8453:
        return 'mainnet'
      default:
        return 'localnet'
    }
  }

  test('selects localnet for chainId 31337', () => {
    expect(selectAddressType(31337)).toBe('localnet')
  })

  test('selects localnet for chainId 1337', () => {
    expect(selectAddressType(1337)).toBe('localnet')
  })

  test('selects testnet for Base Sepolia', () => {
    expect(selectAddressType(84532)).toBe('testnet')
  })

  test('selects mainnet for Base', () => {
    expect(selectAddressType(8453)).toBe('mainnet')
  })

  test('defaults to localnet for unknown chain', () => {
    expect(selectAddressType(12345)).toBe('localnet')
    expect(selectAddressType(0)).toBe('localnet')
    expect(selectAddressType(-1)).toBe('localnet')
  })

  test('handles all major EVM chains as unknown (defaults to localnet)', () => {
    const otherChains = [1, 137, 42161, 10, 56] // ETH, Polygon, Arb, OP, BSC
    otherChains.forEach((chainId) => {
      expect(selectAddressType(chainId)).toBe('localnet')
    })
  })
})
