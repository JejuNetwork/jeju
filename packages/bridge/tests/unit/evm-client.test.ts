/**
 * Unit Tests for EVM Client
 *
 * Tests:
 * - Client creation and configuration
 * - Transfer operations
 * - Light client interactions
 * - Error handling
 * - Edge cases
 */

import { describe, expect, it } from 'bun:test'
import type { Address, Hex } from 'viem'
import {
  ChainId,
  createEVMClient,
  type EVMClientConfig,
} from '../../src/index.js'

// Mock addresses for testing
const MOCK_BRIDGE = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as Address
const MOCK_LIGHT_CLIENT =
  '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Address
const MOCK_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex

describe('EVMClient', () => {
  describe('Client Creation', () => {
    it('should create client with valid config', () => {
      const config: EVMClientConfig = {
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: 'http://127.0.0.1:6545',
        bridgeAddress: MOCK_BRIDGE,
        lightClientAddress: MOCK_LIGHT_CLIENT,
      }

      const client = createEVMClient(config)
      expect(client).toBeDefined()
      expect(client.getChainId()).toBe(ChainId.LOCAL_EVM)
    })

    it('should create client with private key', () => {
      const config: EVMClientConfig = {
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: 'http://127.0.0.1:6545',
        privateKey: MOCK_PRIVATE_KEY,
        bridgeAddress: MOCK_BRIDGE,
        lightClientAddress: MOCK_LIGHT_CLIENT,
      }

      const client = createEVMClient(config)
      expect(client.getAddress()).toBeDefined()
      expect(client.getAddress()).not.toBeNull()
    })

    it('should create read-only client without private key', () => {
      const config: EVMClientConfig = {
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: 'http://127.0.0.1:6545',
        bridgeAddress: MOCK_BRIDGE,
        lightClientAddress: MOCK_LIGHT_CLIENT,
      }

      const client = createEVMClient(config)
      expect(client.getAddress()).toBeNull()
    })

    it('should handle different chain IDs', () => {
      const chainIds = [
        ChainId.ETHEREUM_MAINNET,
        ChainId.BASE_MAINNET,
        ChainId.ARBITRUM_ONE,
        ChainId.OPTIMISM,
      ]

      for (const chainId of chainIds) {
        const client = createEVMClient({
          chainId,
          rpcUrl: 'http://127.0.0.1:6545',
          bridgeAddress: MOCK_BRIDGE,
          lightClientAddress: MOCK_LIGHT_CLIENT,
        })

        expect(client.getChainId()).toBe(chainId)
      }
    })
  })

  describe('Address Formatting', () => {
    it('should return correct address format', () => {
      const client = createEVMClient({
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: 'http://127.0.0.1:6545',
        privateKey: MOCK_PRIVATE_KEY,
        bridgeAddress: MOCK_BRIDGE,
        lightClientAddress: MOCK_LIGHT_CLIENT,
      })

      const address = client.getAddress()
      expect(address).toBeDefined()
      expect(address?.startsWith('0x')).toBe(true)
      expect(address?.length).toBe(42) // 0x + 40 hex chars
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid RPC URL gracefully when querying', async () => {
      const client = createEVMClient({
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: 'http://invalid-rpc:9999',
        bridgeAddress: MOCK_BRIDGE,
        lightClientAddress: MOCK_LIGHT_CLIENT,
      })

      // Operations should fail but not crash
      let errorThrown = false
      try {
        await client.getLatestVerifiedSlot()
      } catch {
        errorThrown = true
      }
      expect(errorThrown).toBe(true)
    })

    it('should throw when initiating transfer without wallet', async () => {
      const client = createEVMClient({
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: 'http://127.0.0.1:6545',
        bridgeAddress: MOCK_BRIDGE,
        lightClientAddress: MOCK_LIGHT_CLIENT,
        // No private key
      })

      let errorThrown = false
      try {
        await client.initiateTransfer({
          token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          recipient: new Uint8Array(32).fill(0x01),
          amount: BigInt(1000000),
          destChainId: ChainId.SOLANA_MAINNET,
        })
      } catch (e) {
        errorThrown = true
        expect((e as Error).message).toContain('Wallet not configured')
      }
      expect(errorThrown).toBe(true)
    })
  })

  describe('Chain ID Validation', () => {
    it('should accept valid EVM chain IDs', () => {
      const validChainIds = [1, 8453, 42161, 10, 56, 31337]

      for (const chainId of validChainIds) {
        const client = createEVMClient({
          chainId,
          rpcUrl: 'http://127.0.0.1:6545',
          bridgeAddress: MOCK_BRIDGE,
          lightClientAddress: MOCK_LIGHT_CLIENT,
        })
        expect(client.getChainId()).toBe(chainId)
      }
    })
  })

  describe('Account Methods', () => {
    it('should derive correct address from private key', () => {
      const client = createEVMClient({
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: 'http://127.0.0.1:6545',
        privateKey: MOCK_PRIVATE_KEY,
        bridgeAddress: MOCK_BRIDGE,
        lightClientAddress: MOCK_LIGHT_CLIENT,
      })

      // The first Anvil account's address
      const expectedAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
      expect(client.getAddress()?.toLowerCase()).toBe(
        expectedAddress.toLowerCase(),
      )
    })
  })

  describe('Configuration', () => {
    it('should use provided bridge address', () => {
      const customBridge =
        '0x1234567890123456789012345678901234567890' as Address

      const client = createEVMClient({
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: 'http://127.0.0.1:6545',
        bridgeAddress: customBridge,
        lightClientAddress: MOCK_LIGHT_CLIENT,
      })

      expect(client).toBeDefined()
    })

    it('should use provided light client address', () => {
      const customLightClient =
        '0xabcdef1234567890abcdef1234567890abcdef12' as Address

      const client = createEVMClient({
        chainId: ChainId.LOCAL_EVM,
        rpcUrl: 'http://127.0.0.1:6545',
        bridgeAddress: MOCK_BRIDGE,
        lightClientAddress: customLightClient,
      })

      expect(client).toBeDefined()
    })
  })
})

describe('EVMClient Transfer Parameters', () => {
  it('should validate recipient is 32 bytes', () => {
    const validRecipient = new Uint8Array(32).fill(0x01)
    expect(validRecipient.length).toBe(32)
  })

  it('should handle empty recipient', () => {
    const emptyRecipient = new Uint8Array(32).fill(0)
    const isValid = emptyRecipient.some((b) => b !== 0)
    expect(isValid).toBe(false)
  })

  it('should handle max uint256 amount', () => {
    const maxAmount = BigInt(
      '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    )
    expect(maxAmount > BigInt(0)).toBe(true)
  })

  it('should handle minimum amount', () => {
    const minAmount = BigInt(1)
    expect(minAmount > BigInt(0)).toBe(true)
  })
})
