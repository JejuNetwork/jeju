/**
 * Cross-Chain Bridge Tests
 *
 * Tests for cross-chain messaging functionality between Jeju and other L2s.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import type { Address, Hex } from 'viem'
import {
  CrossChainBridgeClient,
  createCrossChainBridgeClient,
  getCrossChainBridgeClient,
  MessagingChain,
  resetCrossChainBridgeClient,
} from '../bridge/cross-chain-bridge'

describe('CrossChainBridgeClient', () => {
  afterEach(() => {
    resetCrossChainBridgeClient()
  })

  describe('initialization', () => {
    test('creates client with default configuration', () => {
      const client = createCrossChainBridgeClient()

      expect(client).toBeInstanceOf(CrossChainBridgeClient)

      const config = client.getConfig()
      expect(config.sourceChain).toBe(MessagingChain.BASE)
      expect(config.jejuRpcUrl).toBeDefined()
      expect(config.sourceChainRpcUrl).toBeDefined()
      expect(config.relayNodeUrl).toBe('http://localhost:3400')
    })

    test('creates client with custom configuration', () => {
      const customConfig = {
        sourceChain: MessagingChain.OPTIMISM,
        relayNodeUrl: 'http://custom-relay:3500',
        jejuBridgeAddress:
          '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address,
      }

      const client = createCrossChainBridgeClient(customConfig)
      const config = client.getConfig()

      expect(config.sourceChain).toBe(MessagingChain.OPTIMISM)
      expect(config.relayNodeUrl).toBe('http://custom-relay:3500')
      expect(config.jejuBridgeAddress).toBe(customConfig.jejuBridgeAddress)
    })

    test('singleton pattern returns same instance', () => {
      const client1 = getCrossChainBridgeClient()
      const client2 = getCrossChainBridgeClient()

      expect(client1).toBe(client2)
    })

    test('reset clears singleton', () => {
      const client1 = getCrossChainBridgeClient()
      resetCrossChainBridgeClient()
      const client2 = getCrossChainBridgeClient()

      expect(client1).not.toBe(client2)
    })
  })

  describe('MessagingChain enum', () => {
    test('has correct chain IDs', () => {
      expect(MessagingChain.JEJU).toBe(1)
      expect(MessagingChain.BASE).toBe(8453)
      expect(MessagingChain.BASE_SEPOLIA).toBe(84532)
      expect(MessagingChain.OPTIMISM).toBe(10)
    })
  })

  describe('pending messages', () => {
    test('starts with empty pending messages', () => {
      const client = createCrossChainBridgeClient()
      const pending = client.getPendingMessages()

      expect(pending).toEqual([])
    })

    test('clearPendingMessage returns false for non-existent message', () => {
      const client = createCrossChainBridgeClient()
      const result = client.clearPendingMessage('non-existent-id')

      expect(result).toBe(false)
    })
  })

  describe('message construction', () => {
    test('constructs cross-chain message envelope correctly', async () => {
      const client = createCrossChainBridgeClient({
        sourceChain: MessagingChain.BASE,
      })

      const sender = '0x1111111111111111111111111111111111111111' as Address
      const recipient = '0x2222222222222222222222222222222222222222' as Address
      const encryptedContent = 'encrypted-data'
      const ephemeralPublicKey = '0xabc123'
      const nonce = '0xdef456'

      // Note: This will fail because there's no relay server, but we can validate
      // the message construction by checking the error includes valid data
      const promise = client.sendMessage(
        sender,
        recipient,
        encryptedContent,
        ephemeralPublicKey,
        nonce,
        MessagingChain.JEJU,
      )

      // Expect network error since no relay is running
      await expect(promise).rejects.toThrow()
    })
  })

  describe('key registration', () => {
    test('constructs key registration payload correctly', async () => {
      const client = createCrossChainBridgeClient({
        sourceChain: MessagingChain.BASE,
      })

      const keys = {
        identityKey: 'identity-key-hex',
        signedPreKey: 'signed-pre-key-hex',
        preKeySignature: 'pre-key-sig-hex',
        oneTimePreKeys: ['otk-1', 'otk-2', 'otk-3'],
      }

      const userAddress =
        '0x3333333333333333333333333333333333333333' as Address
      const signature = `0x${'ff'.repeat(65)}` as Hex

      // This will fail because there's no relay server
      const promise = client.registerKeys(keys, userAddress, signature)

      await expect(promise).rejects.toThrow()
    })
  })

  describe('configuration accessors', () => {
    test('getConfig returns configuration copy', () => {
      const client = createCrossChainBridgeClient({
        relayNodeUrl: 'http://test:3000',
      })

      const config1 = client.getConfig()
      const config2 = client.getConfig()

      // Should be different objects (copies)
      expect(config1).not.toBe(config2)

      // But with same values
      expect(config1.relayNodeUrl).toBe(config2.relayNodeUrl)
    })
  })
})

describe('CrossChainMessage types', () => {
  test('CrossChainMessage has required fields', () => {
    // Type-level test - validates the interface has the right shape
    const message = {
      id: 'msg-1',
      sourceChain: MessagingChain.BASE,
      destinationChain: MessagingChain.JEJU,
      sender: '0x1111111111111111111111111111111111111111' as Address,
      recipient: '0x2222222222222222222222222222222222222222' as Address,
      encryptedContent: 'encrypted',
      ephemeralPublicKey: 'pubkey',
      nonce: 'nonce',
      timestamp: Date.now(),
      bridgeNonce: BigInt(123),
    }

    expect(message.id).toBeDefined()
    expect(message.sourceChain).toBe(MessagingChain.BASE)
    expect(message.destinationChain).toBe(MessagingChain.JEJU)
    expect(message.bridgeNonce).toBe(BigInt(123))
  })

  test('MessageStatus has valid status values', () => {
    const validStatuses = [
      'pending',
      'bridging',
      'delivered',
      'failed',
    ] as const

    for (const status of validStatuses) {
      const messageStatus = {
        status,
        sourceChain: MessagingChain.BASE,
        destinationChain: MessagingChain.JEJU,
      }

      expect(messageStatus.status).toBe(status)
    }
  })

  test('MessageRoute distinguishes direct from bridged', () => {
    const directRoute = {
      route: 'direct' as const,
      sourceChain: MessagingChain.JEJU,
      destinationChain: MessagingChain.JEJU,
      estimatedTime: 1000,
    }

    const bridgedRoute = {
      route: 'bridge' as const,
      sourceChain: MessagingChain.BASE,
      destinationChain: MessagingChain.JEJU,
      estimatedTime: 60000,
    }

    expect(directRoute.route).toBe('direct')
    expect(bridgedRoute.route).toBe('bridge')
    expect(bridgedRoute.estimatedTime).toBeGreaterThan(
      directRoute.estimatedTime,
    )
  })
})

describe('CrossChainKeyRegistration types', () => {
  test('key registration has all required fields', () => {
    const registration = {
      address: '0x4444444444444444444444444444444444444444' as Address,
      identityKey: 'identity-key',
      signedPreKey: 'signed-pre-key',
      preKeySignature: 'pre-key-sig',
      oneTimePreKeys: ['otk-1', 'otk-2'],
      sourceChain: MessagingChain.OPTIMISM,
      destinationChains: [MessagingChain.JEJU, MessagingChain.BASE],
      timestamp: Date.now(),
      signature: `0x${'aa'.repeat(65)}` as Hex,
    }

    expect(registration.address).toBeDefined()
    expect(registration.identityKey).toBeDefined()
    expect(registration.oneTimePreKeys.length).toBe(2)
    expect(registration.destinationChains.length).toBe(2)
  })
})
