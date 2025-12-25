/**
 * Network Messaging Client
 *
 * High-level client for sending and receiving encrypted messages
 * via the decentralized relay network.
 */

import { createLogger } from '@jejunetwork/shared'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'

const log = createLogger('messaging-client')

import { privateKeyToAccount } from 'viem/accounts'
import {
  MessagingClientConfigBaseSchema,
  SendMessageRequestSchema,
  SendMessageResponseSchema,
  WebSocketIncomingMessageSchema,
} from '../schemas'
import { KEY_REGISTRY_ABI, MESSAGE_NODE_REGISTRY_ABI } from './abis'
import {
  bytes32ToPublicKey,
  decryptMessage,
  deriveKeyPairFromWallet,
  deserializeEncryptedMessage,
  encryptMessage,
  KEY_DERIVATION_MESSAGE,
  type KeyPair,
  publicKeyToBytes32,
  serializeEncryptedMessage,
} from './crypto'
import {
  type DeliveryReceiptData,
  ErrorCodes,
  type KeyBundleResponse,
  type Message,
  type MessageEnvelope,
  type MessageEvent,
  type MessageEventHandler,
  type MessagingClientConfig,
  MessagingError,
  type NodeRegistryResponse,
  type ReadReceiptData,
  type RelayNode,
  type SendMessageRequest,
  type SendMessageResponse,
} from './types'

// Maximum messages to cache in memory to prevent unbounded growth
const MAX_MESSAGE_CACHE_SIZE = 1000

export class MessagingClient {
  private config: MessagingClientConfig
  private publicClient: PublicClient
  private walletClient?: WalletClient
  private keyPair?: KeyPair
  private relayNode?: RelayNode
  private ws?: WebSocket
  private eventHandlers: Set<MessageEventHandler> = new Set()
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private messageCache: Map<string, Message> = new Map()
  private messageCacheOrder: string[] = [] // Track insertion order for LRU eviction

  constructor(config: MessagingClientConfig) {
    // Validate the JSON-serializable portion of config
    MessagingClientConfigBaseSchema.parse(config)

    this.config = config

    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    })

    if (config.keyPair) {
      this.keyPair = config.keyPair
    }
  }

  /**
   * Initialize the client: derive keys, register on-chain, connect to relay
   */
  async initialize(signature?: string): Promise<void> {
    // 1. Derive or use provided key pair
    if (!this.keyPair) {
      if (!signature) {
        throw new MessagingError(
          'Signature required to derive messaging keys',
          ErrorCodes.UNAUTHORIZED,
        )
      }
      this.keyPair = deriveKeyPairFromWallet(this.config.address, signature)
    }

    // 2. Check if key is registered on-chain
    const isRegistered = await this.isKeyRegistered()

    if (!isRegistered) {
      await this.registerKeyOnChain()
    }

    // 3. Discover and connect to relay node
    await this.connectToRelay()
  }

  /**
   * Get the message to sign for key derivation
   */
  getKeyDerivationMessage(): string {
    return KEY_DERIVATION_MESSAGE
  }

  /**
   * Check if user's key is registered on-chain
   */
  async isKeyRegistered(): Promise<boolean> {
    if (!this.config.keyRegistryAddress) return false

    const bundle = (await this.publicClient.readContract({
      address: this.config.keyRegistryAddress as Address,
      abi: KEY_REGISTRY_ABI,
      functionName: 'getKeyBundle',
      args: [this.config.address as Address],
    })) as KeyBundleResponse

    return bundle.isActive
  }

  /**
   * Register key bundle on-chain
   */
  async registerKeyOnChain(): Promise<void> {
    if (!this.keyPair) {
      throw new MessagingError(
        'Key pair not initialized',
        ErrorCodes.NO_KEY_BUNDLE,
      )
    }
    if (!this.config.keyRegistryAddress) {
      throw new MessagingError(
        'KeyRegistry address not configured',
        ErrorCodes.NOT_CONNECTED,
      )
    }
    if (!this.walletClient) {
      throw new MessagingError(
        'Wallet client not configured',
        ErrorCodes.UNAUTHORIZED,
      )
    }
    if (!this.walletClient.account) {
      throw new MessagingError(
        'Wallet client has no account',
        ErrorCodes.UNAUTHORIZED,
      )
    }

    const identityKey = publicKeyToBytes32(this.keyPair.publicKey)
    // For MVP, use same key as signed pre-key (should rotate in production)
    const signedPreKey = identityKey
    const preKeySignature = `0x${'00'.repeat(32)}` as Hex // Placeholder

    await this.walletClient.writeContract({
      chain: null, // Use chain from wallet client
      account: this.walletClient.account,
      address: this.config.keyRegistryAddress as Address,
      abi: KEY_REGISTRY_ABI,
      functionName: 'registerKeyBundle',
      args: [identityKey, signedPreKey, preKeySignature],
    })
  }

  /**
   * Discover relay nodes from on-chain registry
   */
  async discoverNodes(): Promise<RelayNode[]> {
    if (!this.config.nodeRegistryAddress) {
      // If no registry, use configured relay URL
      if (this.config.relayUrl) {
        return [
          {
            nodeId: 'direct',
            endpoint: this.config.relayUrl,
            region: 'unknown',
            isHealthy: true,
          },
        ]
      }
      return []
    }

    const activeNodeIds = (await this.publicClient.readContract({
      address: this.config.nodeRegistryAddress as Address,
      abi: MESSAGE_NODE_REGISTRY_ABI,
      functionName: 'getActiveNodes',
    })) as Hex[]

    const nodes: RelayNode[] = []

    for (const nodeId of activeNodeIds) {
      const nodeInfo = (await this.publicClient.readContract({
        address: this.config.nodeRegistryAddress as Address,
        abi: MESSAGE_NODE_REGISTRY_ABI,
        functionName: 'getNode',
        args: [nodeId],
      })) as NodeRegistryResponse

      if (nodeInfo.isActive) {
        nodes.push({
          nodeId: nodeInfo.nodeId,
          endpoint: nodeInfo.endpoint,
          region: nodeInfo.region,
          isHealthy: true,
        })
      }
    }

    return nodes
  }

  /**
   * Select best relay node based on region and latency
   * Returns null if no healthy nodes are available
   */
  async selectBestNode(): Promise<RelayNode | null> {
    const nodes = await this.discoverNodes()

    if (nodes.length === 0) {
      return null
    }

    // Filter by preferred region if specified
    let candidates = this.config.preferredRegion
      ? nodes.filter((n) => n.region === this.config.preferredRegion)
      : nodes

    // Fall back to all nodes if no regional match
    if (candidates.length === 0) {
      candidates = nodes
    }

    // Test latency and select best - collect results with error handling per node
    const latencyResults = await Promise.all(
      candidates.map(async (node) => {
        const start = Date.now()
        let healthy = false
        try {
          healthy = await this.checkNodeHealth(node.endpoint)
        } catch {
          // Node is unhealthy if health check fails
          healthy = false
        }
        const latency = Date.now() - start
        return { node, latency, healthy }
      }),
    )

    const healthyNodes = latencyResults.filter((l) => l.healthy)
    if (healthyNodes.length === 0) {
      return null
    }

    // Sort by latency and return best
    healthyNodes.sort((a, b) => a.latency - b.latency)
    const best = healthyNodes[0]
    if (!best) {
      throw new Error('No healthy nodes available')
    }
    best.node.latency = best.latency

    return best.node
  }

  /**
   * Validate URL to prevent SSRF attacks
   */
  private validateEndpointUrl(endpoint: string): boolean {
    let url: URL
    try {
      url = new URL(endpoint)
    } catch {
      return false
    }

    // Only allow http and https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }

    // Block localhost/internal addresses in production
    // Note: In development, localhost is allowed
    const hostname = url.hostname.toLowerCase()
    const blockedPatterns = [
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^0\./,
      /^169\.254\./,
      /^fc00:/i,
      /^fe80:/i,
      /^::1$/,
    ]

    for (const pattern of blockedPatterns) {
      if (pattern.test(hostname)) {
        return false
      }
    }

    return true
  }

  /**
   * Check if relay node is healthy
   * @throws Error if health check fails or times out
   */
  async checkNodeHealth(endpoint: string): Promise<boolean> {
    // Validate URL to prevent SSRF
    if (!this.validateEndpointUrl(endpoint)) {
      throw new Error(`Invalid endpoint URL: ${endpoint}`)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const healthUrl = `${endpoint.replace(/\/$/, '')}/health`
    const response = await fetch(healthUrl, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    return response.ok
  }

  /**
   * Connect to relay node via WebSocket
   */
  async connectToRelay(): Promise<void> {
    // Select best node if not already connected
    if (!this.relayNode) {
      const selectedNode = await this.selectBestNode()

      if (selectedNode) {
        this.relayNode = selectedNode
      } else if (this.config.relayUrl) {
        // Use direct URL if configured and no nodes discovered
        this.relayNode = {
          nodeId: 'direct',
          endpoint: this.config.relayUrl,
          region: 'unknown',
          isHealthy: true,
        }
      } else {
        throw new MessagingError(
          'No relay nodes available',
          ErrorCodes.NODE_NOT_FOUND,
        )
      }
    }

    const relayNode = this.relayNode

    // Connect WebSocket
    const wsUrl = `${relayNode.endpoint
      .replace('http://', 'ws://')
      .replace('https://', 'wss://')
      .replace(/\/$/, '')}/ws`

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      this.ws = ws

      ws.onopen = () => {
        this.reconnectAttempts = 0

        // Subscribe to messages for this address
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            address: this.config.address,
          }),
        )

        resolve()
      }

      ws.onmessage = (event) => {
        // WebSocket text messages are strings - binary messages are not supported
        if (typeof event.data !== 'string') {
          log.warn('Received non-string message, ignoring')
          return
        }
        this.handleWebSocketMessage(event.data)
      }

      ws.onclose = () => {
        if (this.config.autoReconnect !== false) {
          this.handleReconnect()
        }
      }

      ws.onerror = () => {
        reject(
          new MessagingError(
            'Failed to connect to relay',
            ErrorCodes.NOT_CONNECTED,
          ),
        )
      }
    })
  }

  private handleWebSocketMessage(data: string): void {
    // Safe JSON parsing with size limit
    if (data.length > 1024 * 1024) {
      this.emitEvent({
        type: 'error',
        data: {
          code: ErrorCodes.INVALID_MESSAGE,
          message: 'Message too large',
        },
      })
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    } catch {
      this.emitEvent({
        type: 'error',
        data: {
          code: ErrorCodes.INVALID_MESSAGE,
          message: 'Invalid JSON in WebSocket message',
        },
      })
      return
    }

    const parseResult = WebSocketIncomingMessageSchema.safeParse(parsed)

    if (!parseResult.success) {
      this.emitEvent({
        type: 'error',
        data: {
          code: ErrorCodes.INVALID_MESSAGE,
          message: 'Invalid WebSocket message format',
        },
      })
      return
    }

    const wsMessage = parseResult.data

    switch (wsMessage.type) {
      case 'message':
        this.handleIncomingMessage(wsMessage.data as MessageEnvelope)
        break
      case 'delivery_receipt': {
        if (!this.relayNode) {
          throw new MessagingError(
            'Received delivery receipt but not connected to relay',
            ErrorCodes.NOT_CONNECTED,
          )
        }
        const deliveryData = wsMessage.data as DeliveryReceiptData
        this.emitEvent({
          type: 'message:delivered',
          data: {
            messageId: deliveryData.messageId,
            nodeId: this.relayNode.nodeId,
            deliveredAt: Date.now(),
            signature: '',
          },
        })
        break
      }
      case 'read_receipt': {
        const readData = wsMessage.data as ReadReceiptData
        this.emitEvent({
          type: 'message:read',
          data: readData,
        })
        break
      }
    }
  }

  private handleIncomingMessage(envelope: MessageEnvelope): void {
    if (!this.keyPair) return

    const encrypted = deserializeEncryptedMessage(envelope.encryptedContent)
    const decrypted = decryptMessage(encrypted, this.keyPair.privateKey)
    const content = new TextDecoder().decode(decrypted)

    const message: Message = {
      id: envelope.id,
      chatId: this.getChatId(envelope.from, envelope.to),
      senderId: envelope.from,
      recipientId: envelope.to,
      content,
      timestamp: envelope.timestamp,
      status: 'delivered',
    }

    this.addToMessageCache(message)
    this.emitEvent({ type: 'message:new', data: message })
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emitEvent({
        type: 'error',
        data: {
          code: ErrorCodes.NOT_CONNECTED,
          message: `Failed to reconnect after ${this.maxReconnectAttempts} attempts`,
        },
      })
      return
    }

    this.reconnectAttempts++
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000)

    setTimeout(() => {
      this.connectToRelay().catch((err: Error) => {
        this.emitEvent({
          type: 'error',
          data: {
            code: ErrorCodes.NOT_CONNECTED,
            message: `Reconnection attempt ${this.reconnectAttempts} failed: ${err.message}`,
          },
        })
      })
    }, delay)
  }

  /**
   * Send a message to a recipient
   */
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    // Validate request
    SendMessageRequestSchema.parse(request)

    if (!this.keyPair) {
      throw new MessagingError(
        'Client not initialized',
        ErrorCodes.NO_KEY_BUNDLE,
      )
    }

    // 1. Get recipient's public key
    const recipientKey = await this.getRecipientPublicKey(request.to)
    if (!recipientKey) {
      throw new MessagingError(
        'Recipient has no registered key',
        ErrorCodes.RECIPIENT_NO_KEY,
      )
    }

    // 2. Encrypt message
    const encrypted = encryptMessage(
      request.content,
      recipientKey,
      this.keyPair.privateKey,
    )

    // 3. Create envelope
    const envelope: MessageEnvelope = {
      id: crypto.randomUUID(),
      from: this.config.address,
      to: request.to,
      encryptedContent: serializeEncryptedMessage(encrypted),
      timestamp: Date.now(),
    }

    // 4. Send to relay
    const response = await this.sendToRelay(envelope)

    // 5. Cache locally
    if (response.success) {
      const message: Message = {
        id: envelope.id,
        chatId: request.chatId ?? this.getChatId(envelope.from, envelope.to),
        senderId: this.config.address,
        recipientId: request.to,
        content: request.content,
        timestamp: envelope.timestamp,
        status: 'sent',
      }
      this.addToMessageCache(message)
    }

    return response
  }

  /**
   * Get recipient's public key from on-chain registry
   */
  async getRecipientPublicKey(
    address: string,
  ): Promise<Uint8Array | undefined> {
    if (!this.config.keyRegistryAddress) return undefined

    const bundle = (await this.publicClient.readContract({
      address: this.config.keyRegistryAddress as Address,
      abi: KEY_REGISTRY_ABI,
      functionName: 'getKeyBundle',
      args: [address as Address],
    })) as KeyBundleResponse

    if (!bundle.isActive) return undefined

    return bytes32ToPublicKey(bundle.identityKey)
  }

  /**
   * Send envelope to relay node
   */
  private async sendToRelay(
    envelope: MessageEnvelope,
  ): Promise<SendMessageResponse> {
    if (!this.relayNode) {
      throw new MessagingError(
        'Not connected to relay',
        ErrorCodes.NOT_CONNECTED,
      )
    }

    const sendUrl = `${this.relayNode.endpoint.replace(/\/$/, '')}/send`
    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new MessagingError(
        `Failed to send message: ${error}`,
        ErrorCodes.DELIVERY_FAILED,
      )
    }

    const rawResult: unknown = await response.json()
    const result = SendMessageResponseSchema.parse(rawResult)
    return result as SendMessageResponse
  }

  /**
   * Subscribe to message events
   */
  onMessage(handler: MessageEventHandler): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  private emitEvent(event: MessageEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event)
    }
  }

  /**
   * Add message to cache with LRU eviction to prevent memory leaks
   */
  private addToMessageCache(message: Message): void {
    // If already in cache, update and move to end of order
    if (this.messageCache.has(message.id)) {
      this.messageCache.set(message.id, message)
      const idx = this.messageCacheOrder.indexOf(message.id)
      if (idx >= 0) {
        this.messageCacheOrder.splice(idx, 1)
        this.messageCacheOrder.push(message.id)
      }
      return
    }

    // Evict oldest entries if at capacity
    while (this.messageCache.size >= MAX_MESSAGE_CACHE_SIZE) {
      const oldestId = this.messageCacheOrder.shift()
      if (oldestId) {
        this.messageCache.delete(oldestId)
      }
    }

    this.messageCache.set(message.id, message)
    this.messageCacheOrder.push(message.id)
  }

  /**
   * Generate deterministic chat ID for DM
   */
  getChatId(address1: string, address2: string): string {
    const sorted = [address1.toLowerCase(), address2.toLowerCase()].sort()
    return `dm-${sorted[0]}-${sorted[1]}`
  }

  /**
   * Get cached messages for a chat
   */
  getMessages(chatId: string): Message[] {
    return Array.from(this.messageCache.values())
      .filter((m) => m.chatId === chatId)
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  /**
   * Get public key (for sharing)
   * Returns null if client not initialized
   */
  getPublicKey(): Uint8Array | null {
    if (!this.keyPair) {
      return null
    }
    return this.keyPair.publicKey
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== undefined && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Disconnect from relay
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = undefined
    }
    this.relayNode = undefined
  }

  /**
   * Set wallet client for transactions
   */
  setWalletClient(client: WalletClient): void {
    this.walletClient = client
  }

  /**
   * Create wallet client from private key
   */
  setPrivateKey(privateKey: Hex): void {
    const account = privateKeyToAccount(privateKey)
    this.walletClient = createWalletClient({
      account,
      transport: http(this.config.rpcUrl),
    })
  }
}

/**
 * Create a new messaging client
 */
export function createMessagingClient(
  config: MessagingClientConfig,
): MessagingClient {
  return new MessagingClient(config)
}
