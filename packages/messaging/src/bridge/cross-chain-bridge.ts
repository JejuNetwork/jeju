/**
 * Cross-Chain Messaging Bridge
 *
 * Enables users on different L2s to participate in the Jeju messaging protocol.
 * Uses L1 <-> L2 message passing for key registration and message routing.
 *
 * Architecture:
 * - Users on Base/Optimism register their keys locally
 * - Bridge relays key registrations to Jeju L2
 * - Messages can be sent cross-chain via relay nodes
 */

import { logger } from '@jejunetwork/shared'
import type { Address, Hex } from 'viem'
import { z } from 'zod'

/**
 * Supported chains for messaging
 */
export enum MessagingChain {
  JEJU = 1,
  BASE = 8453,
  BASE_SEPOLIA = 84532,
  OPTIMISM = 10,
}

// API Response Schemas
const RegisterKeysResponseSchema = z.object({
  txHash: z.string(),
})

const CrossChainMessageSchema = z.object({
  id: z.string(),
  sourceChain: z.nativeEnum(MessagingChain),
  destinationChain: z.nativeEnum(MessagingChain),
  sender: z.string(),
  recipient: z.string(),
  encryptedContent: z.string(),
  ephemeralPublicKey: z.string(),
  nonce: z.string(),
  timestamp: z.number(),
  bridgeNonce: z.union([z.bigint(), z.string(), z.number()]),
  signature: z.string().optional(),
})

const CrossChainMessagesResponseSchema = z.object({
  messages: z.array(CrossChainMessageSchema),
})

const HasKeysResponseSchema = z.object({
  hasKeys: z.boolean(),
})

const MessageRouteResponseSchema = z.object({
  route: z.enum(['direct', 'bridge']),
  sourceChain: z.nativeEnum(MessagingChain),
  destinationChain: z.nativeEnum(MessagingChain),
  estimatedTime: z.number(),
})

const MessageStatusResponseSchema = z.object({
  status: z.enum(['pending', 'bridging', 'delivered', 'failed']),
  sourceChain: z.nativeEnum(MessagingChain).optional(),
  destinationChain: z.nativeEnum(MessagingChain).optional(),
  deliveredAt: z.number().optional(),
  error: z.string().optional(),
})

/**
 * Cross-chain message envelope
 */
export interface CrossChainMessage {
  id: string
  sourceChain: MessagingChain
  destinationChain: MessagingChain
  sender: Address
  recipient: Address
  encryptedContent: string
  ephemeralPublicKey: string
  nonce: string
  timestamp: number
  bridgeNonce: bigint
  signature?: Hex
}

/**
 * Key registration across chains
 */
export interface CrossChainKeyRegistration {
  address: Address
  identityKey: string
  signedPreKey: string
  preKeySignature: string
  oneTimePreKeys: string[]
  sourceChain: MessagingChain
  destinationChains: MessagingChain[]
  timestamp: number
  signature: Hex
}

/**
 * Bridge configuration
 */
export interface CrossChainBridgeConfig {
  /** Jeju L2 RPC URL */
  jejuRpcUrl: string
  /** Source chain RPC URL (Base, Optimism, etc.) */
  sourceChainRpcUrl: string
  /** Bridge contract on Jeju */
  jejuBridgeAddress: Address
  /** Bridge contract on source chain */
  sourceBridgeAddress: Address
  /** KeyRegistry on Jeju */
  jejuKeyRegistryAddress: Address
  /** Relay node URL */
  relayNodeUrl: string
  /** Source chain identifier */
  sourceChain: MessagingChain
}

/**
 * Message route information
 */
export interface MessageRoute {
  route: 'direct' | 'bridge'
  sourceChain: MessagingChain
  destinationChain: MessagingChain
  estimatedTime: number
}

/**
 * Message delivery status
 */
export interface MessageStatus {
  status: 'pending' | 'bridging' | 'delivered' | 'failed'
  sourceChain?: MessagingChain
  destinationChain?: MessagingChain
  deliveredAt?: number
  error?: string
}

/**
 * Cross-chain messaging bridge client
 *
 * Supports bridging messages between Jeju and other L2s like Base and Optimism.
 */
export class CrossChainBridgeClient {
  private config: CrossChainBridgeConfig
  private pendingMessages: Map<string, CrossChainMessage> = new Map()

  constructor(config: Partial<CrossChainBridgeConfig> = {}) {
    const zeroAddress: Address = '0x0000000000000000000000000000000000000000'
    const sourceChain = config.sourceChain ?? MessagingChain.BASE
    
    this.config = {
      jejuRpcUrl:
        config.jejuRpcUrl ??
        process.env.JEJU_RPC_URL ??
        'http://localhost:6545',
      sourceChainRpcUrl:
        config.sourceChainRpcUrl ??
        process.env.SOURCE_CHAIN_RPC_URL ??
        (sourceChain === MessagingChain.BASE
          ? 'https://mainnet.base.org'
          : 'https://mainnet.optimism.io'),
      jejuBridgeAddress:
        config.jejuBridgeAddress ??
        (process.env.JEJU_BRIDGE_ADDRESS as Address | undefined) ??
        zeroAddress,
      sourceBridgeAddress:
        config.sourceBridgeAddress ??
        (process.env.SOURCE_BRIDGE_ADDRESS as Address | undefined) ??
        zeroAddress,
      jejuKeyRegistryAddress:
        config.jejuKeyRegistryAddress ??
        (process.env.JEJU_KEY_REGISTRY_ADDRESS as Address | undefined) ??
        zeroAddress,
      relayNodeUrl:
        config.relayNodeUrl ??
        process.env.RELAY_NODE_URL ??
        'http://localhost:3400',
      sourceChain,
    }
  }

  /**
   * Register keys on source chain and bridge to Jeju
   */
  async registerKeys(
    keys: {
      identityKey: string
      signedPreKey: string
      preKeySignature: string
      oneTimePreKeys: string[]
    },
    userAddress: Address,
    signature: Hex,
  ): Promise<{ txHash: string }> {
    const registration: CrossChainKeyRegistration = {
      address: userAddress,
      identityKey: keys.identityKey,
      signedPreKey: keys.signedPreKey,
      preKeySignature: keys.preKeySignature,
      oneTimePreKeys: keys.oneTimePreKeys,
      sourceChain: this.config.sourceChain,
      destinationChains: [MessagingChain.JEJU],
      timestamp: Date.now(),
      signature,
    }

    logger.info('[CrossChainBridge] Registering keys', {
      address: userAddress,
      sourceChain: this.config.sourceChain,
    })

    const response = await fetch(
      `${this.config.relayNodeUrl}/bridge/register-keys`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registration),
        signal: AbortSignal.timeout(30000),
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to register keys: ${response.status} - ${errorText}`)
    }

    const json: unknown = await response.json()
    const result = RegisterKeysResponseSchema.parse(json)
    
    logger.info('[CrossChainBridge] Keys registered', {
      address: userAddress,
      txHash: result.txHash,
    })
    
    return { txHash: result.txHash }
  }

  /**
   * Send a cross-chain message
   */
  async sendMessage(
    sender: Address,
    recipient: Address,
    encryptedContent: string,
    ephemeralPublicKey: string,
    nonce: string,
    destinationChain: MessagingChain = MessagingChain.JEJU,
  ): Promise<{ messageId: string }> {
    const messageId = `xc-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const message: CrossChainMessage = {
      id: messageId,
      sourceChain: this.config.sourceChain,
      destinationChain,
      sender,
      recipient,
      encryptedContent,
      ephemeralPublicKey,
      nonce,
      timestamp: Date.now(),
      bridgeNonce: BigInt(Date.now()),
    }

    logger.debug('[CrossChainBridge] Sending message', {
      messageId,
      sender,
      recipient,
      sourceChain: this.config.sourceChain,
      destinationChain,
    })

    const response = await fetch(
      `${this.config.relayNodeUrl}/bridge/send-message`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...message,
          bridgeNonce: message.bridgeNonce.toString(),
        }),
        signal: AbortSignal.timeout(30000),
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to send cross-chain message: ${response.status} - ${errorText}`)
    }

    this.pendingMessages.set(messageId, message)
    
    logger.info('[CrossChainBridge] Message sent', { messageId })
    
    return { messageId }
  }

  /**
   * Get message delivery status
   */
  async getMessageStatus(messageId: string): Promise<MessageStatus> {
    const response = await fetch(
      `${this.config.relayNodeUrl}/bridge/message-status/${messageId}`,
      { signal: AbortSignal.timeout(10000) },
    )

    if (!response.ok) {
      throw new Error(`Failed to get message status: ${response.status} ${response.statusText}`)
    }

    const json: unknown = await response.json()
    return MessageStatusResponseSchema.parse(json)
  }

  /**
   * Fetch cross-chain messages for a recipient
   */
  async fetchMessages(
    recipient: Address,
    destinationChain: MessagingChain = this.config.sourceChain,
  ): Promise<CrossChainMessage[]> {
    const response = await fetch(
      `${this.config.relayNodeUrl}/bridge/messages/${recipient}?chain=${destinationChain}`,
      { signal: AbortSignal.timeout(30000) },
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch cross-chain messages: ${response.status} ${response.statusText}`)
    }

    const json: unknown = await response.json()
    const data = CrossChainMessagesResponseSchema.parse(json)
    
    return data.messages.map((m) => ({
      id: m.id,
      sourceChain: m.sourceChain,
      destinationChain: m.destinationChain,
      sender: m.sender as Address,
      recipient: m.recipient as Address,
      encryptedContent: m.encryptedContent,
      ephemeralPublicKey: m.ephemeralPublicKey,
      nonce: m.nonce,
      timestamp: m.timestamp,
      bridgeNonce: BigInt(String(m.bridgeNonce)),
      signature: m.signature as Hex | undefined,
    }))
  }

  /**
   * Check if a user has keys registered on a specific chain
   */
  async hasKeysOnChain(
    address: Address,
    chain: MessagingChain,
  ): Promise<boolean> {
    const response = await fetch(
      `${this.config.relayNodeUrl}/bridge/has-keys/${address}?chain=${chain}`,
      { signal: AbortSignal.timeout(10000) },
    )

    if (!response.ok) {
      throw new Error(`Failed to check keys on chain: ${response.status} ${response.statusText}`)
    }

    const json: unknown = await response.json()
    const data = HasKeysResponseSchema.parse(json)
    return data.hasKeys
  }

  /**
   * Get the optimal route for a message (direct or bridged)
   */
  async getMessageRoute(
    sender: Address,
    recipient: Address,
  ): Promise<MessageRoute> {
    const response = await fetch(
      `${this.config.relayNodeUrl}/bridge/route?sender=${sender}&recipient=${recipient}`,
      { signal: AbortSignal.timeout(10000) },
    )

    if (!response.ok) {
      throw new Error(`Failed to get message route: ${response.status} ${response.statusText}`)
    }

    const json: unknown = await response.json()
    return MessageRouteResponseSchema.parse(json)
  }

  /**
   * Get pending messages
   */
  getPendingMessages(): CrossChainMessage[] {
    return Array.from(this.pendingMessages.values())
  }

  /**
   * Clear a pending message by ID
   */
  clearPendingMessage(messageId: string): boolean {
    return this.pendingMessages.delete(messageId)
  }

  /**
   * Get configuration
   */
  getConfig(): CrossChainBridgeConfig {
    return { ...this.config }
  }
}

/**
 * Factory function
 */
export function createCrossChainBridgeClient(
  config?: Partial<CrossChainBridgeConfig>,
): CrossChainBridgeClient {
  return new CrossChainBridgeClient(config)
}

// Singleton
let bridgeClient: CrossChainBridgeClient | null = null

export function getCrossChainBridgeClient(
  config?: Partial<CrossChainBridgeConfig>,
): CrossChainBridgeClient {
  if (!bridgeClient) {
    bridgeClient = new CrossChainBridgeClient(config)
  }
  return bridgeClient
}

export function resetCrossChainBridgeClient(): void {
  bridgeClient = null
}
