/**
 * Jeju Messaging Client
 * 
 * High-level client for sending and receiving encrypted messages
 * via the decentralized relay network.
 */

import { createPublicClient, createWalletClient, http, type PublicClient, type WalletClient, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  generateKeyPair,
  deriveKeyPairFromWallet,
  encryptMessage,
  decryptMessage,
  serializeEncryptedMessage,
  deserializeEncryptedMessage,
  publicKeyToBytes32,
  bytes32ToPublicKey,
  KEY_DERIVATION_MESSAGE,
  type KeyPair,
  type SerializedEncryptedMessage,
} from './crypto';
import {
  type MessagingClientConfig,
  type Message,
  type MessageEnvelope,
  type RelayNode,
  type SendMessageRequest,
  type SendMessageResponse,
  type MessageEvent,
  type MessageEventHandler,
  MessagingError,
  ErrorCodes,
} from './types';
import { KEY_REGISTRY_ABI, MESSAGE_NODE_REGISTRY_ABI } from './abis';

// ============ Client Implementation ============

export class MessagingClient {
  private config: MessagingClientConfig;
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  private keyPair?: KeyPair;
  private relayNode?: RelayNode;
  private ws?: WebSocket;
  private eventHandlers: Set<MessageEventHandler> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private messageCache: Map<string, Message> = new Map();

  constructor(config: MessagingClientConfig) {
    this.config = config;
    
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });

    if (config.keyPair) {
      this.keyPair = config.keyPair;
    }
  }

  // ============ Initialization ============

  /**
   * Initialize the client: derive keys, register on-chain, connect to relay
   */
  async initialize(signature?: string): Promise<void> {
    // 1. Derive or use provided key pair
    if (!this.keyPair) {
      if (!signature) {
        throw new MessagingError(
          'Signature required to derive messaging keys',
          ErrorCodes.UNAUTHORIZED
        );
      }
      this.keyPair = deriveKeyPairFromWallet(this.config.address, signature);
    }

    // 2. Check if key is registered on-chain
    const isRegistered = await this.isKeyRegistered();
    
    if (!isRegistered) {
      console.log('Key not registered, registering on-chain...');
      await this.registerKeyOnChain();
    }

    // 3. Discover and connect to relay node
    await this.connectToRelay();
  }

  /**
   * Get the message to sign for key derivation
   */
  getKeyDerivationMessage(): string {
    return KEY_DERIVATION_MESSAGE;
  }

  /**
   * Check if user's key is registered on-chain
   */
  async isKeyRegistered(): Promise<boolean> {
    if (!this.config.keyRegistryAddress) return false;

    const bundle = await this.publicClient.readContract({
      address: this.config.keyRegistryAddress as Address,
      abi: KEY_REGISTRY_ABI,
      functionName: 'getKeyBundle',
      args: [this.config.address as Address],
    });

    return (bundle as { isActive: boolean }).isActive;
  }

  /**
   * Register key bundle on-chain
   */
  async registerKeyOnChain(): Promise<void> {
    if (!this.keyPair) {
      throw new MessagingError('Key pair not initialized', ErrorCodes.NO_KEY_BUNDLE);
    }
    if (!this.config.keyRegistryAddress) {
      throw new MessagingError('KeyRegistry address not configured', ErrorCodes.NOT_CONNECTED);
    }
    if (!this.walletClient) {
      throw new MessagingError('Wallet client not configured', ErrorCodes.UNAUTHORIZED);
    }

    const identityKey = publicKeyToBytes32(this.keyPair.publicKey);
    // For MVP, use same key as signed pre-key (should rotate in production)
    const signedPreKey = identityKey;
    const preKeySignature = '0x' + '00'.repeat(32) as Hex; // Placeholder

    await this.walletClient.writeContract({
      chain: null, // Use chain from wallet client
      account: this.walletClient.account!,
      address: this.config.keyRegistryAddress as Address,
      abi: KEY_REGISTRY_ABI,
      functionName: 'registerKeyBundle',
      args: [identityKey, signedPreKey, preKeySignature],
    });
  }

  // ============ Node Discovery ============

  /**
   * Discover relay nodes from on-chain registry
   */
  async discoverNodes(): Promise<RelayNode[]> {
    if (!this.config.nodeRegistryAddress) {
      // If no registry, use configured relay URL
      if (this.config.relayUrl) {
        return [{
          nodeId: 'direct',
          endpoint: this.config.relayUrl,
          region: 'unknown',
          isHealthy: true,
        }];
      }
      return [];
    }

    const activeNodeIds = await this.publicClient.readContract({
      address: this.config.nodeRegistryAddress as Address,
      abi: MESSAGE_NODE_REGISTRY_ABI,
      functionName: 'getActiveNodes',
    }) as Hex[];

    const nodes: RelayNode[] = [];

    for (const nodeId of activeNodeIds) {
      const nodeInfo = await this.publicClient.readContract({
        address: this.config.nodeRegistryAddress as Address,
        abi: MESSAGE_NODE_REGISTRY_ABI,
        functionName: 'getNode',
        args: [nodeId],
      }) as {
        nodeId: Hex;
        operator: Address;
        endpoint: string;
        region: string;
        isActive: boolean;
      };

      if (nodeInfo.isActive) {
        nodes.push({
          nodeId: nodeInfo.nodeId,
          endpoint: nodeInfo.endpoint,
          region: nodeInfo.region,
          isHealthy: true, // Will verify on connect
        });
      }
    }

    return nodes;
  }

  /**
   * Select best relay node based on region and latency
   */
  async selectBestNode(): Promise<RelayNode | undefined> {
    const nodes = await this.discoverNodes();
    
    if (nodes.length === 0) return undefined;

    // Filter by preferred region if specified
    let candidates = this.config.preferredRegion
      ? nodes.filter(n => n.region === this.config.preferredRegion)
      : nodes;

    // Fall back to all nodes if no regional match
    if (candidates.length === 0) {
      candidates = nodes;
    }

    // Test latency and select best
    const latencies = await Promise.all(
      candidates.map(async (node) => {
        const start = Date.now();
        const healthy = await this.checkNodeHealth(node.endpoint);
        const latency = Date.now() - start;
        return { node, latency, healthy };
      })
    );

    const healthyNodes = latencies.filter(l => l.healthy);
    if (healthyNodes.length === 0) return undefined;

    // Sort by latency and return best
    healthyNodes.sort((a, b) => a.latency - b.latency);
    const best = healthyNodes[0];
    best.node.latency = best.latency;
    
    return best.node;
  }

  /**
   * Check if relay node is healthy
   */
  async checkNodeHealth(endpoint: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const healthUrl = endpoint.replace(/\/$/, '') + '/health';
    const response = await fetch(healthUrl, {
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);
    return response?.ok ?? false;
  }

  // ============ Relay Connection ============

  /**
   * Connect to relay node via WebSocket
   */
  async connectToRelay(): Promise<void> {
    // Select best node if not already connected
    if (!this.relayNode) {
      this.relayNode = await this.selectBestNode();
      
      if (!this.relayNode) {
        // Use direct URL if configured
        if (this.config.relayUrl) {
          this.relayNode = {
            nodeId: 'direct',
            endpoint: this.config.relayUrl,
            region: 'unknown',
            isHealthy: true,
          };
        } else {
          throw new MessagingError('No relay nodes available', ErrorCodes.NODE_NOT_FOUND);
        }
      }
    }

    // Connect WebSocket
    const wsUrl = this.relayNode.endpoint
      .replace('http://', 'ws://')
      .replace('https://', 'wss://')
      .replace(/\/$/, '') + '/ws';

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Connected to relay:', this.relayNode?.endpoint);
        this.reconnectAttempts = 0;
        
        // Subscribe to messages for this address
        this.ws?.send(JSON.stringify({
          type: 'subscribe',
          address: this.config.address,
        }));
        
        resolve();
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event.data as string);
      };

      this.ws.onclose = () => {
        console.log('Disconnected from relay');
        if (this.config.autoReconnect !== false) {
          this.handleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        reject(new MessagingError('Failed to connect to relay', ErrorCodes.NOT_CONNECTED));
      };
    });
  }

  private handleWebSocketMessage(data: string): void {
    const parsed = JSON.parse(data) as {
      type: string;
      data: MessageEnvelope | { messageId: string; readAt?: number };
    };
    
    switch (parsed.type) {
      case 'message':
        this.handleIncomingMessage(parsed.data as MessageEnvelope);
        break;
      case 'delivery_receipt':
        this.emitEvent({
          type: 'message:delivered',
          data: {
            messageId: (parsed.data as { messageId: string }).messageId,
            nodeId: this.relayNode?.nodeId ?? '',
            deliveredAt: Date.now(),
            signature: '',
          },
        });
        break;
      case 'read_receipt':
        this.emitEvent({
          type: 'message:read',
          data: parsed.data as { messageId: string; readAt: number },
        });
        break;
      default:
        console.log('Unknown message type:', parsed.type);
    }
  }

  private handleIncomingMessage(envelope: MessageEnvelope): void {
    if (!this.keyPair) return;

    const encrypted = deserializeEncryptedMessage(envelope.encryptedContent);
    const decrypted = decryptMessage(encrypted, this.keyPair.privateKey);
    const content = new TextDecoder().decode(decrypted);

    const message: Message = {
      id: envelope.id,
      chatId: this.getChatId(envelope.from, envelope.to),
      senderId: envelope.from,
      recipientId: envelope.to,
      content,
      timestamp: envelope.timestamp,
      status: 'delivered',
    };

    this.messageCache.set(message.id, message);
    this.emitEvent({ type: 'message:new', data: message });
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    setTimeout(() => {
      this.connectToRelay().catch(console.error);
    }, delay);
  }

  // ============ Messaging ============

  /**
   * Send a message to a recipient
   */
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    if (!this.keyPair) {
      throw new MessagingError('Client not initialized', ErrorCodes.NO_KEY_BUNDLE);
    }

    // 1. Get recipient's public key
    const recipientKey = await this.getRecipientPublicKey(request.to);
    if (!recipientKey) {
      throw new MessagingError(
        'Recipient has no registered key',
        ErrorCodes.RECIPIENT_NO_KEY
      );
    }

    // 2. Encrypt message
    const encrypted = encryptMessage(
      request.content,
      recipientKey,
      this.keyPair.privateKey
    );

    // 3. Create envelope
    const envelope: MessageEnvelope = {
      id: crypto.randomUUID(),
      from: this.config.address,
      to: request.to,
      encryptedContent: serializeEncryptedMessage(encrypted),
      timestamp: Date.now(),
    };

    // 4. Send to relay
    const response = await this.sendToRelay(envelope);

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
      };
      this.messageCache.set(message.id, message);
    }

    return response;
  }

  /**
   * Get recipient's public key from on-chain registry
   */
  async getRecipientPublicKey(address: string): Promise<Uint8Array | undefined> {
    if (!this.config.keyRegistryAddress) return undefined;

    const bundle = await this.publicClient.readContract({
      address: this.config.keyRegistryAddress as Address,
      abi: KEY_REGISTRY_ABI,
      functionName: 'getKeyBundle',
      args: [address as Address],
    }) as { identityKey: Hex; isActive: boolean };

    if (!bundle.isActive) return undefined;

    return bytes32ToPublicKey(bundle.identityKey);
  }

  /**
   * Send envelope to relay node
   */
  private async sendToRelay(envelope: MessageEnvelope): Promise<SendMessageResponse> {
    if (!this.relayNode) {
      throw new MessagingError('Not connected to relay', ErrorCodes.NOT_CONNECTED);
    }

    const sendUrl = this.relayNode.endpoint.replace(/\/$/, '') + '/send';
    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new MessagingError(
        `Failed to send message: ${error}`,
        ErrorCodes.DELIVERY_FAILED
      );
    }

    const result = await response.json() as SendMessageResponse;
    return result;
  }

  // ============ Event Handling ============

  /**
   * Subscribe to message events
   */
  onMessage(handler: MessageEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emitEvent(event: MessageEvent): void {
    for (const handler of this.eventHandlers) {
      handler(event);
    }
  }

  // ============ Utility Methods ============

  /**
   * Generate deterministic chat ID for DM
   */
  getChatId(address1: string, address2: string): string {
    const sorted = [address1.toLowerCase(), address2.toLowerCase()].sort();
    return `dm-${sorted[0]}-${sorted[1]}`;
  }

  /**
   * Get cached messages for a chat
   */
  getMessages(chatId: string): Message[] {
    return Array.from(this.messageCache.values())
      .filter(m => m.chatId === chatId)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get public key (for sharing)
   */
  getPublicKey(): Uint8Array | undefined {
    return this.keyPair?.publicKey;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from relay
   */
  disconnect(): void {
    this.ws?.close();
    this.ws = undefined;
    this.relayNode = undefined;
  }

  /**
   * Set wallet client for transactions
   */
  setWalletClient(client: WalletClient): void {
    this.walletClient = client;
  }

  /**
   * Create wallet client from private key
   */
  setPrivateKey(privateKey: Hex): void {
    const account = privateKeyToAccount(privateKey);
    this.walletClient = createWalletClient({
      account,
      transport: http(this.config.rpcUrl),
    });
  }
}

// ============ Factory Function ============

/**
 * Create a new messaging client
 */
export function createMessagingClient(config: MessagingClientConfig): MessagingClient {
  return new MessagingClient(config);
}

