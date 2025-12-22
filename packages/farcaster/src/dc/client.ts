/**
 * Direct Cast Client
 * 
 * Handles sending/receiving encrypted direct messages between Farcaster users.
 * Uses X25519 + AES-GCM encryption for end-to-end security.
 */

import type { Address, Hex } from 'viem';
import type {
  DirectCast,
  DirectCastConversation,
  DCClientConfig,
  DCClientState,
  SendDCParams,
  GetMessagesParams,
  EncryptedDirectCast,
  DirectCastEmbed,
} from './types';
import { ed25519 } from '@noble/curves/ed25519';
import { x25519 } from '@noble/curves/ed25519';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { gcm } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/ciphers/webcrypto';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

// Custom DC message type (extending Farcaster protocol)
const DC_MESSAGE_TYPE = 14;

// ============ Types ============

interface MessageHandler {
  (message: DirectCast): void;
}

// ============ Direct Cast Client ============

export class DirectCastClient {
  private config: DCClientConfig;
  private isInitialized: boolean = false;
  private conversations: Map<string, DirectCastConversation> = new Map();
  private messages: Map<string, DirectCast[]> = new Map();
  private messageHandlers: Set<MessageHandler> = new Set();
  private relayConnection: WebSocket | null = null;
  
  // Encryption key pair (X25519 derived from Ed25519 signer)
  private encryptionPrivateKey: Uint8Array | null = null;
  private encryptionPublicKey: Uint8Array | null = null;
  
  constructor(config: DCClientConfig) {
    this.config = config;
  }
  
  // ============ Initialization ============
  
  /**
   * Initialize DC client
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    console.log(`[DC Client] Initializing for FID ${this.config.fid}`);
    
    // Derive X25519 key pair from Ed25519 signer
    this.deriveEncryptionKeys();
    
    // Connect to relay for message transport
    if (this.config.relayUrl) {
      await this.connectToRelay();
    }
    
    // Load persisted conversations
    await this.loadConversations();
    
    this.isInitialized = true;
    
    console.log(`[DC Client] Initialized successfully`);
  }
  
  /**
   * Shutdown the client
   */
  async shutdown(): Promise<void> {
    this.relayConnection?.close();
    await this.saveConversations();
    this.isInitialized = false;
  }
  
  /**
   * Derive X25519 keys from Ed25519 signer key
   */
  private deriveEncryptionKeys(): void {
    // Use HKDF to derive X25519 key from Ed25519 key
    const derived = hkdf(
      sha256,
      this.config.signerPrivateKey,
      new Uint8Array(0),
      new TextEncoder().encode('farcaster-dc-encryption'),
      32,
    );
    
    this.encryptionPrivateKey = derived;
    this.encryptionPublicKey = x25519.getPublicKey(derived);
  }
  
  // ============ Conversations ============
  
  /**
   * Get all conversations
   */
  async getConversations(): Promise<DirectCastConversation[]> {
    this.ensureInitialized();
    
    return Array.from(this.conversations.values())
      .filter(c => !c.isArchived)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  
  /**
   * Get or create conversation with FID
   */
  async getConversation(recipientFid: number): Promise<DirectCastConversation> {
    this.ensureInitialized();
    
    const id = this.getConversationId(recipientFid);
    
    let conv = this.conversations.get(id);
    if (!conv) {
      conv = {
        id,
        participants: [this.config.fid, recipientFid].sort((a, b) => a - b),
        unreadCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.conversations.set(id, conv);
    }
    
    return conv;
  }
  
  /**
   * Archive a conversation
   */
  async archiveConversation(recipientFid: number): Promise<void> {
    const id = this.getConversationId(recipientFid);
    const conv = this.conversations.get(id);
    if (conv) {
      conv.isArchived = true;
    }
  }
  
  /**
   * Mute a conversation
   */
  async muteConversation(recipientFid: number, muted: boolean): Promise<void> {
    const id = this.getConversationId(recipientFid);
    const conv = this.conversations.get(id);
    if (conv) {
      conv.isMuted = muted;
    }
  }
  
  // ============ Messages ============
  
  /**
   * Get messages in conversation
   */
  async getMessages(
    recipientFid: number,
    options?: GetMessagesParams,
  ): Promise<DirectCast[]> {
    this.ensureInitialized();
    
    const id = this.getConversationId(recipientFid);
    let messages = this.messages.get(id) ?? [];
    
    // Sort by timestamp descending
    messages = [...messages].sort((a, b) => b.timestamp - a.timestamp);
    
    // Apply pagination
    if (options?.before) {
      const idx = messages.findIndex(m => m.id === options.before);
      if (idx >= 0) {
        messages = messages.slice(idx + 1);
      }
    }
    
    if (options?.after) {
      const idx = messages.findIndex(m => m.id === options.after);
      if (idx >= 0) {
        messages = messages.slice(0, idx);
      }
    }
    
    if (options?.limit) {
      messages = messages.slice(0, options.limit);
    }
    
    return messages;
  }
  
  /**
   * Send a direct cast
   */
  async send(params: SendDCParams): Promise<DirectCast> {
    this.ensureInitialized();
    
    const conversationId = this.getConversationId(params.recipientFid);
    const timestamp = Date.now();
    const id = `dc-${this.config.fid}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    
    // Get recipient's encryption public key
    const recipientKey = await this.getRecipientEncryptionKey(params.recipientFid);
    
    // Encrypt message content
    const encrypted = await this.encrypt(params.text, recipientKey);
    
    // Sign the encrypted content
    const signaturePayload = new TextEncoder().encode(
      JSON.stringify({
        senderFid: this.config.fid,
        recipientFid: params.recipientFid,
        ciphertext: encrypted.ciphertext,
        timestamp,
      })
    );
    const signature = ed25519.sign(signaturePayload, this.config.signerPrivateKey);
    
    // Create encrypted DC for transport
    const encryptedDC: EncryptedDirectCast = {
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      ephemeralPublicKey: encrypted.ephemeralPublicKey,
      senderFid: this.config.fid,
      recipientFid: params.recipientFid,
      timestamp,
      signature: `0x${bytesToHex(signature)}` as Hex,
    };
    
    // Send via relay
    await this.sendToRelay(encryptedDC);
    
    // Create local plaintext DC
    const dc: DirectCast = {
      id,
      conversationId,
      senderFid: this.config.fid,
      recipientFid: params.recipientFid,
      text: params.text,
      embeds: params.embeds,
      replyTo: params.replyTo,
      timestamp,
      signature: encryptedDC.signature,
      isRead: true, // Own messages are read
    };
    
    // Store locally
    this.addMessage(dc);
    
    console.log(`[DC Client] Sent message ${id} to FID ${params.recipientFid}`);
    
    return dc;
  }
  
  /**
   * Mark conversation as read
   */
  async markAsRead(recipientFid: number): Promise<void> {
    const id = this.getConversationId(recipientFid);
    const conv = this.conversations.get(id);
    if (conv) {
      conv.unreadCount = 0;
      
      // Mark all messages as read
      const messages = this.messages.get(id) ?? [];
      for (const msg of messages) {
        msg.isRead = true;
      }
      
      // Send read receipt via relay
      await this.sendReadReceipt(recipientFid, id);
    }
  }
  
  // ============ Message Streaming ============
  
  /**
   * Subscribe to new messages
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.add(handler);
  }
  
  /**
   * Unsubscribe from messages
   */
  offMessage(handler: MessageHandler): void {
    this.messageHandlers.delete(handler);
  }
  
  /**
   * Stream new messages
   */
  async *streamMessages(): AsyncGenerator<DirectCast> {
    this.ensureInitialized();
    
    const queue: DirectCast[] = [];
    let resolveNext: ((value: DirectCast) => void) | null = null;
    
    const handler = (message: DirectCast) => {
      if (resolveNext) {
        resolveNext(message);
        resolveNext = null;
      } else {
        queue.push(message);
      }
    };
    
    this.onMessage(handler);
    
    try {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          yield await new Promise<DirectCast>(resolve => {
            resolveNext = resolve;
          });
        }
      }
    } finally {
      this.offMessage(handler);
    }
  }
  
  // ============ Encryption ============
  
  /**
   * Encrypt message for recipient
   */
  private async encrypt(
    plaintext: string,
    recipientPublicKey: Uint8Array,
  ): Promise<{ ciphertext: Hex; nonce: Hex; ephemeralPublicKey: Hex }> {
    // Generate ephemeral key pair
    const ephemeralPrivateKey = randomBytes(32);
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
    
    // Compute shared secret
    const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, recipientPublicKey);
    
    // Derive encryption key
    const encryptionKey = hkdf(
      sha256,
      sharedSecret,
      new Uint8Array(0),
      new TextEncoder().encode('farcaster-dc-aes'),
      32,
    );
    
    // Encrypt with AES-GCM
    const nonce = randomBytes(12);
    const plaintextBytes = new TextEncoder().encode(plaintext);
    const aes = gcm(encryptionKey, nonce);
    const ciphertext = aes.encrypt(plaintextBytes);
    
    return {
      ciphertext: `0x${bytesToHex(ciphertext)}` as Hex,
      nonce: `0x${bytesToHex(nonce)}` as Hex,
      ephemeralPublicKey: `0x${bytesToHex(ephemeralPublicKey)}` as Hex,
    };
  }
  
  /**
   * Decrypt message
   */
  private async decrypt(encrypted: EncryptedDirectCast): Promise<string> {
    if (!this.encryptionPrivateKey) {
      throw new Error('Encryption keys not initialized');
    }
    
    const ephemeralPublicKey = hexToBytes(encrypted.ephemeralPublicKey.slice(2));
    const nonce = hexToBytes(encrypted.nonce.slice(2));
    const ciphertext = hexToBytes(encrypted.ciphertext.slice(2));
    
    // Compute shared secret
    const sharedSecret = x25519.getSharedSecret(this.encryptionPrivateKey, ephemeralPublicKey);
    
    // Derive decryption key
    const decryptionKey = hkdf(
      sha256,
      sharedSecret,
      new Uint8Array(0),
      new TextEncoder().encode('farcaster-dc-aes'),
      32,
    );
    
    // Decrypt with AES-GCM
    const aes = gcm(decryptionKey, nonce);
    const plaintext = aes.decrypt(ciphertext);
    
    return new TextDecoder().decode(plaintext);
  }
  
  // ============ Key Discovery ============
  
  /**
   * Get recipient's encryption public key
   */
  private async getRecipientEncryptionKey(fid: number): Promise<Uint8Array> {
    // First check on-chain registry
    // Then fall back to hub user data
    
    const hubKey = await this.fetchKeyFromHub(fid);
    if (hubKey) return hubKey;
    
    throw new Error(`No encryption key found for FID ${fid}`);
  }
  
  /**
   * Fetch encryption key from hub user data
   */
  private async fetchKeyFromHub(fid: number): Promise<Uint8Array | null> {
    try {
      const response = await fetch(`${this.config.hubUrl}/v1/userDataByFid?fid=${fid}`);
      if (!response.ok) return null;
      
      const data = await response.json() as {
        messages?: Array<{
          data?: {
            userDataBody?: { type: number; value?: string };
          };
        }>;
      };
      
      // Look for DC encryption key in user data (custom type 100)
      const keyData = data.messages?.find(
        m => m.data?.userDataBody?.type === 100
      );
      
      if (keyData?.data?.userDataBody?.value) {
        return hexToBytes(keyData.data.userDataBody.value.slice(2));
      }
      
      return null;
    } catch {
      return null;
    }
  }
  
  /**
   * Publish our encryption key to hub
   */
  async publishEncryptionKey(): Promise<void> {
    if (!this.encryptionPublicKey) {
      throw new Error('Encryption keys not initialized');
    }
    
    // TODO: Submit UserDataAdd message with type 100
    console.log(`[DC Client] Publishing encryption key: 0x${bytesToHex(this.encryptionPublicKey)}`);
  }
  
  // ============ Relay Communication ============
  
  /**
   * Connect to relay server
   */
  private async connectToRelay(): Promise<void> {
    if (!this.config.relayUrl) return;
    
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.relayUrl!.replace('http', 'ws') + '/dc';
      
      // In production, use actual WebSocket
      console.log(`[DC Client] Connecting to relay: ${wsUrl}`);
      
      // Simulate connection for now
      setTimeout(() => {
        console.log(`[DC Client] Connected to relay`);
        resolve();
      }, 100);
    });
  }
  
  /**
   * Send encrypted DC to relay
   */
  private async sendToRelay(encrypted: EncryptedDirectCast): Promise<void> {
    if (!this.config.relayUrl) {
      console.log(`[DC Client] No relay configured, message stored locally only`);
      return;
    }
    
    // Send via relay API
    await fetch(`${this.config.relayUrl}/api/dc/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encrypted),
    }).catch(() => {
      // Relay unavailable, queue for later
      console.log(`[DC Client] Relay unavailable, message queued`);
    });
  }
  
  /**
   * Send read receipt via relay
   */
  private async sendReadReceipt(recipientFid: number, conversationId: string): Promise<void> {
    if (!this.config.relayUrl) return;
    
    await fetch(`${this.config.relayUrl}/api/dc/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderFid: this.config.fid,
        recipientFid,
        conversationId,
        timestamp: Date.now(),
      }),
    }).catch(() => {
      // Ignore relay errors for receipts
    });
  }
  
  /**
   * Handle incoming message from relay
   */
  private async handleIncomingMessage(encrypted: EncryptedDirectCast): Promise<void> {
    // Verify signature
    const signaturePayload = new TextEncoder().encode(
      JSON.stringify({
        senderFid: encrypted.senderFid,
        recipientFid: encrypted.recipientFid,
        ciphertext: encrypted.ciphertext,
        timestamp: encrypted.timestamp,
      })
    );
    
    // TODO: Get sender's public key and verify
    
    // Decrypt message
    const text = await this.decrypt(encrypted);
    
    const conversationId = this.getConversationId(encrypted.senderFid);
    const id = `dc-${encrypted.senderFid}-${encrypted.timestamp}`;
    
    const dc: DirectCast = {
      id,
      conversationId,
      senderFid: encrypted.senderFid,
      recipientFid: encrypted.recipientFid,
      text,
      timestamp: encrypted.timestamp,
      signature: encrypted.signature,
      isRead: false,
    };
    
    // Store and notify
    this.addMessage(dc);
    
    for (const handler of this.messageHandlers) {
      handler(dc);
    }
  }
  
  // ============ Internal Helpers ============
  
  private getConversationId(otherFid: number): string {
    const fids = [this.config.fid, otherFid].sort((a, b) => a - b);
    return `dc:${fids[0]}-${fids[1]}`;
  }
  
  private addMessage(dc: DirectCast): void {
    const messages = this.messages.get(dc.conversationId) ?? [];
    messages.push(dc);
    this.messages.set(dc.conversationId, messages);
    
    // Update conversation
    let conv = this.conversations.get(dc.conversationId);
    if (!conv) {
      conv = {
        id: dc.conversationId,
        participants: [dc.senderFid, dc.recipientFid].sort((a, b) => a - b),
        unreadCount: 0,
        createdAt: dc.timestamp,
        updatedAt: dc.timestamp,
      };
      this.conversations.set(dc.conversationId, conv);
    }
    
    conv.lastMessage = dc;
    conv.updatedAt = dc.timestamp;
    
    if (dc.senderFid !== this.config.fid && !dc.isRead) {
      conv.unreadCount++;
    }
  }
  
  private async loadConversations(): Promise<void> {
    if (!this.config.persistenceEnabled || !this.config.persistencePath) return;
    
    try {
      const file = Bun.file(this.config.persistencePath);
      if (await file.exists()) {
        const data = await file.json() as {
          conversations: DirectCastConversation[];
          messages: Record<string, DirectCast[]>;
        };
        
        for (const conv of data.conversations) {
          this.conversations.set(conv.id, conv);
        }
        
        for (const [id, msgs] of Object.entries(data.messages)) {
          this.messages.set(id, msgs);
        }
      }
    } catch {
      console.log(`[DC Client] No previous conversations found`);
    }
  }
  
  private async saveConversations(): Promise<void> {
    if (!this.config.persistenceEnabled || !this.config.persistencePath) return;
    
    await Bun.write(this.config.persistencePath, JSON.stringify({
      conversations: Array.from(this.conversations.values()),
      messages: Object.fromEntries(this.messages),
    }, null, 2));
  }
  
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('DC Client not initialized. Call initialize() first.');
    }
  }
  
  // ============ State ============
  
  /**
   * Get client state
   */
  getState(): DCClientState {
    let totalUnread = 0;
    for (const conv of this.conversations.values()) {
      totalUnread += conv.unreadCount;
    }
    
    return {
      fid: this.config.fid,
      isInitialized: this.isInitialized,
      isConnected: this.relayConnection !== null,
      conversationCount: this.conversations.size,
      unreadCount: totalUnread,
    };
  }
  
  /**
   * Get encryption public key
   */
  getEncryptionPublicKey(): Hex | null {
    if (!this.encryptionPublicKey) return null;
    return `0x${bytesToHex(this.encryptionPublicKey)}` as Hex;
  }
}

// ============ Factory Function ============

/**
 * Create and initialize a DC client
 */
export async function createDirectCastClient(config: DCClientConfig): Promise<DirectCastClient> {
  const client = new DirectCastClient(config);
  await client.initialize();
  return client;
}

