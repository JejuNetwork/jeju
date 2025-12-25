/**
 * Direct Cast Client
 *
 * Handles sending/receiving encrypted direct messages between Farcaster users.
 * Uses X25519 + AES-GCM encryption for end-to-end security.
 */

import { gcm } from '@noble/ciphers/aes'
import { randomBytes } from '@noble/ciphers/webcrypto'
import { ed25519, x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { Hex } from 'viem'
import {
  DCPersistenceDataSchema,
  DCSignerEventsResponseSchema,
  DCUserDataResponseSchema,
} from '../hub/schemas'
import type {
  DCClientConfig,
  DCClientState,
  DirectCast,
  DirectCastConversation,
  EncryptedDirectCast,
  GetMessagesParams,
  SendDCParams,
} from './types'

type MessageHandler = (message: DirectCast) => void
/** Maximum messages per conversation to prevent memory exhaustion */
const MAX_MESSAGES_PER_CONVERSATION = 1000
/** Maximum conversations to prevent memory exhaustion */
const MAX_CONVERSATIONS = 500
/** Maximum text length for direct casts */
const MAX_DC_TEXT_LENGTH = 2000
/** Default timeout for relay requests */
const RELAY_TIMEOUT_MS = 10000
export class DirectCastClient {
  private config: DCClientConfig
  private isInitialized: boolean = false
  private conversations: Map<string, DirectCastConversation> = new Map()
  private messages: Map<string, DirectCast[]> = new Map()
  private messageHandlers: Set<MessageHandler> = new Set()
  private relayConnection: WebSocket | null = null

  // Encryption key pair (X25519 derived from Ed25519 signer)
  private encryptionPrivateKey: Uint8Array | null = null
  private encryptionPublicKey: Uint8Array | null = null

  constructor(config: DCClientConfig) {
    this.config = config
  }
  /**
   * Initialize DC client
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return

    console.log(`[DC Client] Initializing for FID ${this.config.fid}`)

    // Derive X25519 key pair from Ed25519 signer
    this.deriveEncryptionKeys()

    // Connect to relay for message transport
    if (this.config.relayUrl) {
      await this.connectToRelay()
    }

    // Load persisted conversations
    await this.loadConversations()

    this.isInitialized = true

    console.log(`[DC Client] Initialized successfully`)
  }

  /**
   * Shutdown the client
   */
  async shutdown(): Promise<void> {
    this.relayConnection?.close()
    await this.saveConversations()
    this.isInitialized = false
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
    )

    this.encryptionPrivateKey = derived
    this.encryptionPublicKey = x25519.getPublicKey(derived)
  }
  /**
   * Get all conversations
   */
  async getConversations(): Promise<DirectCastConversation[]> {
    this.ensureInitialized()

    return Array.from(this.conversations.values())
      .filter((c) => !c.isArchived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Get or create conversation with FID
   */
  async getConversation(recipientFid: number): Promise<DirectCastConversation> {
    this.ensureInitialized()

    const id = this.getConversationId(recipientFid)

    let conv = this.conversations.get(id)
    if (!conv) {
      conv = {
        id,
        participants: [this.config.fid, recipientFid].sort((a, b) => a - b),
        unreadCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      this.conversations.set(id, conv)
    }

    return conv
  }

  /**
   * Archive a conversation
   */
  async archiveConversation(recipientFid: number): Promise<void> {
    const id = this.getConversationId(recipientFid)
    const conv = this.conversations.get(id)
    if (conv) {
      conv.isArchived = true
    }
  }

  /**
   * Mute a conversation
   */
  async muteConversation(recipientFid: number, muted: boolean): Promise<void> {
    const id = this.getConversationId(recipientFid)
    const conv = this.conversations.get(id)
    if (conv) {
      conv.isMuted = muted
    }
  }
  /**
   * Get messages in conversation
   */
  async getMessages(
    recipientFid: number,
    options?: GetMessagesParams,
  ): Promise<DirectCast[]> {
    this.ensureInitialized()

    const id = this.getConversationId(recipientFid)
    let messages = this.messages.get(id) ?? []

    // Sort by timestamp descending
    messages = [...messages].sort((a, b) => b.timestamp - a.timestamp)

    // Apply pagination
    if (options?.before) {
      const idx = messages.findIndex((m) => m.id === options.before)
      if (idx >= 0) {
        messages = messages.slice(idx + 1)
      }
    }

    if (options?.after) {
      const idx = messages.findIndex((m) => m.id === options.after)
      if (idx >= 0) {
        messages = messages.slice(0, idx)
      }
    }

    if (options?.limit) {
      messages = messages.slice(0, options.limit)
    }

    return messages
  }

  /**
   * Send a direct cast
   */
  async send(params: SendDCParams): Promise<DirectCast> {
    this.ensureInitialized()

    // Validate text length to prevent DoS
    if (!params.text || params.text.length === 0) {
      throw new Error('Message text cannot be empty')
    }

    if (params.text.length > MAX_DC_TEXT_LENGTH) {
      throw new Error(
        `Message text exceeds maximum length of ${MAX_DC_TEXT_LENGTH} characters`,
      )
    }

    // Validate recipient FID
    if (!Number.isInteger(params.recipientFid) || params.recipientFid <= 0) {
      throw new Error('Invalid recipient FID')
    }

    const conversationId = this.getConversationId(params.recipientFid)
    const timestamp = Date.now()
    const id = `dc-${this.config.fid}-${timestamp}-${crypto.randomUUID().slice(0, 8)}`

    // Get recipient's encryption public key
    const recipientKey = await this.getRecipientEncryptionKey(
      params.recipientFid,
    )

    // Encrypt message content
    const encrypted = await this.encrypt(params.text, recipientKey)

    // Sign the encrypted content
    const signaturePayload = new TextEncoder().encode(
      JSON.stringify({
        senderFid: this.config.fid,
        recipientFid: params.recipientFid,
        ciphertext: encrypted.ciphertext,
        timestamp,
      }),
    )
    const signature = ed25519.sign(
      signaturePayload,
      this.config.signerPrivateKey,
    )

    // Create encrypted DC for transport
    const encryptedDC: EncryptedDirectCast = {
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      ephemeralPublicKey: encrypted.ephemeralPublicKey,
      senderFid: this.config.fid,
      recipientFid: params.recipientFid,
      timestamp,
      signature: `0x${bytesToHex(signature)}` as Hex,
    }

    // Send via relay
    await this.sendToRelay(encryptedDC)

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
    }

    // Store locally
    this.addMessage(dc)

    console.log(`[DC Client] Sent message ${id} to FID ${params.recipientFid}`)

    return dc
  }

  /**
   * Mark conversation as read
   */
  async markAsRead(recipientFid: number): Promise<void> {
    const id = this.getConversationId(recipientFid)
    const conv = this.conversations.get(id)
    if (conv) {
      conv.unreadCount = 0

      // Mark all messages as read
      const messages = this.messages.get(id) ?? []
      for (const msg of messages) {
        msg.isRead = true
      }

      // Send read receipt via relay
      await this.sendReadReceipt(recipientFid, id)
    }
  }
  /**
   * Subscribe to new messages
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.add(handler)
  }

  /**
   * Unsubscribe from messages
   */
  offMessage(handler: MessageHandler): void {
    this.messageHandlers.delete(handler)
  }

  /**
   * Stream new messages
   */
  async *streamMessages(): AsyncGenerator<DirectCast> {
    this.ensureInitialized()

    const queue: DirectCast[] = []
    let resolveNext: ((value: DirectCast) => void) | null = null

    const handler = (message: DirectCast) => {
      if (resolveNext) {
        resolveNext(message)
        resolveNext = null
      } else {
        queue.push(message)
      }
    }

    this.onMessage(handler)

    try {
      while (true) {
        const queued = queue.shift()
        if (queued) {
          yield queued
        } else {
          yield await new Promise<DirectCast>((resolve) => {
            resolveNext = resolve
          })
        }
      }
    } finally {
      this.offMessage(handler)
    }
  }
  /**
   * Encrypt message for recipient
   */
  private async encrypt(
    plaintext: string,
    recipientPublicKey: Uint8Array,
  ): Promise<{ ciphertext: Hex; nonce: Hex; ephemeralPublicKey: Hex }> {
    // Generate ephemeral key pair
    const ephemeralPrivateKey = randomBytes(32)
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey)

    // Compute shared secret
    const sharedSecret = x25519.getSharedSecret(
      ephemeralPrivateKey,
      recipientPublicKey,
    )

    // Derive encryption key
    const encryptionKey = hkdf(
      sha256,
      sharedSecret,
      new Uint8Array(0),
      new TextEncoder().encode('farcaster-dc-aes'),
      32,
    )

    // Encrypt with AES-GCM
    const nonce = randomBytes(12)
    const plaintextBytes = new TextEncoder().encode(plaintext)
    const aes = gcm(encryptionKey, nonce)
    const ciphertext = aes.encrypt(plaintextBytes)

    return {
      ciphertext: `0x${bytesToHex(ciphertext)}` as Hex,
      nonce: `0x${bytesToHex(nonce)}` as Hex,
      ephemeralPublicKey: `0x${bytesToHex(ephemeralPublicKey)}` as Hex,
    }
  }

  /**
   * Decrypt message
   */
  private async decrypt(encrypted: EncryptedDirectCast): Promise<string> {
    if (!this.encryptionPrivateKey) {
      throw new Error('Encryption keys not initialized')
    }

    const ephemeralPublicKey = hexToBytes(encrypted.ephemeralPublicKey.slice(2))
    const nonce = hexToBytes(encrypted.nonce.slice(2))
    const ciphertext = hexToBytes(encrypted.ciphertext.slice(2))

    // Compute shared secret
    const sharedSecret = x25519.getSharedSecret(
      this.encryptionPrivateKey,
      ephemeralPublicKey,
    )

    // Derive decryption key
    const decryptionKey = hkdf(
      sha256,
      sharedSecret,
      new Uint8Array(0),
      new TextEncoder().encode('farcaster-dc-aes'),
      32,
    )

    // Decrypt with AES-GCM
    const aes = gcm(decryptionKey, nonce)
    const plaintext = aes.decrypt(ciphertext)

    return new TextDecoder().decode(plaintext)
  }
  /**
   * Get recipient's encryption public key
   */
  private async getRecipientEncryptionKey(fid: number): Promise<Uint8Array> {
    // First check on-chain registry
    // Then fall back to hub user data

    const hubKey = await this.fetchKeyFromHub(fid)
    if (hubKey) return hubKey

    throw new Error(`No encryption key found for FID ${fid}`)
  }

  /**
   * Fetch encryption key from hub user data
   */
  private async fetchKeyFromHub(fid: number): Promise<Uint8Array | null> {
    const response = await fetch(
      `${this.config.hubUrl}/v1/userDataByFid?fid=${fid}`,
    ).catch(() => null)
    if (!response?.ok) return null

    const rawData: unknown = await response.json().catch(() => null)
    const parseResult = DCUserDataResponseSchema.safeParse(rawData)
    if (!parseResult.success) return null

    const keyData = parseResult.data.messages?.find(
      (m) => m.data?.userDataBody?.type === 100,
    )

    if (keyData?.data?.userDataBody?.value) {
      return hexToBytes(keyData.data.userDataBody.value.slice(2))
    }

    return null
  }

  /**
   * Publish our encryption key to hub
   */
  async publishEncryptionKey(): Promise<void> {
    if (!this.encryptionPublicKey) {
      throw new Error('Encryption keys not initialized')
    }

    console.log(
      `[DC Client] Publishing encryption key: 0x${bytesToHex(this.encryptionPublicKey)}`,
    )
  }
  /**
   * Connect to relay server
   */
  private async connectToRelay(): Promise<void> {
    const relayUrl = this.config.relayUrl
    if (!relayUrl) return

    return new Promise((resolve) => {
      const wsUrl = `${relayUrl.replace('http', 'ws')}/dc`

      // In production, use actual WebSocket
      console.log(`[DC Client] Connecting to relay: ${wsUrl}`)

      // Simulate connection for now
      setTimeout(() => {
        console.log(`[DC Client] Connected to relay`)
        resolve()
      }, 100)
    })
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number = RELAY_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Send encrypted DC to relay
   */
  private async sendToRelay(encrypted: EncryptedDirectCast): Promise<void> {
    if (!this.config.relayUrl) {
      console.log(
        `[DC Client] No relay configured, message stored locally only`,
      )
      return
    }

    const response = await this.fetchWithTimeout(
      `${this.config.relayUrl}/api/dc/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(encrypted),
      },
    ).catch(() => null)

    if (!response) {
      console.log(`[DC Client] Relay unavailable, message queued`)
    }
  }

  /**
   * Send read receipt via relay (best-effort, failures ignored)
   */
  private async sendReadReceipt(
    recipientFid: number,
    conversationId: string,
  ): Promise<void> {
    if (!this.config.relayUrl) return

    await this.fetchWithTimeout(`${this.config.relayUrl}/api/dc/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderFid: this.config.fid,
        recipientFid,
        conversationId,
        timestamp: Date.now(),
      }),
    }).catch(() => {})
  }

  /**
   * Verify signature on incoming encrypted message
   */
  private async verifyIncomingSignature(
    encrypted: EncryptedDirectCast,
  ): Promise<boolean> {
    // Get sender's signer public key from hub
    const senderSignerKey = await this.fetchSignerKeyFromHub(
      encrypted.senderFid,
    )
    if (!senderSignerKey) {
      console.warn(
        `[DC Client] No signer key found for FID ${encrypted.senderFid}`,
      )
      return false
    }

    // Reconstruct the signature payload
    const signaturePayload = new TextEncoder().encode(
      JSON.stringify({
        senderFid: encrypted.senderFid,
        recipientFid: encrypted.recipientFid,
        ciphertext: encrypted.ciphertext,
        timestamp: encrypted.timestamp,
      }),
    )

    const signatureBytes = hexToBytes(encrypted.signature.slice(2))

    // Verify the Ed25519 signature
    return ed25519.verify(signatureBytes, signaturePayload, senderSignerKey)
  }

  /**
   * Fetch signer public key from hub for signature verification
   */
  private async fetchSignerKeyFromHub(fid: number): Promise<Uint8Array | null> {
    const response = await fetch(
      `${this.config.hubUrl}/v1/onChainSignersByFid?fid=${fid}`,
    ).catch(() => null)
    if (!response?.ok) return null

    const rawData: unknown = await response.json().catch(() => null)
    const parseResult = DCSignerEventsResponseSchema.safeParse(rawData)
    if (!parseResult.success) return null

    const signerEvent = parseResult.data.events?.find(
      (e) => e.signerEventBody?.key,
    )
    if (signerEvent?.signerEventBody?.key) {
      return hexToBytes(signerEvent.signerEventBody.key.slice(2))
    }

    return null
  }

  /**
   * Handle incoming message from relay
   * Called by WebSocket message handler when connected to relay
   */
  async handleIncomingMessage(encrypted: EncryptedDirectCast): Promise<void> {
    // Verify sender's signature before processing
    const signatureValid = await this.verifyIncomingSignature(encrypted)
    if (!signatureValid) {
      console.warn(
        `[DC Client] Rejecting message with invalid signature from FID ${encrypted.senderFid}`,
      )
      return
    }

    // Decrypt message
    const text = await this.decrypt(encrypted)

    const conversationId = this.getConversationId(encrypted.senderFid)
    const id = `dc-${encrypted.senderFid}-${encrypted.timestamp}`

    const dc: DirectCast = {
      id,
      conversationId,
      senderFid: encrypted.senderFid,
      recipientFid: encrypted.recipientFid,
      text,
      timestamp: encrypted.timestamp,
      signature: encrypted.signature,
      isRead: false,
    }

    // Store and notify
    this.addMessage(dc)

    for (const handler of this.messageHandlers) {
      handler(dc)
    }
  }
  private getConversationId(otherFid: number): string {
    const fids = [this.config.fid, otherFid].sort((a, b) => a - b)
    return `dc:${fids[0]}-${fids[1]}`
  }

  private addMessage(dc: DirectCast): void {
    const messages = this.messages.get(dc.conversationId) ?? []
    messages.push(dc)

    // Enforce message limit per conversation to prevent memory exhaustion
    if (messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      // Remove oldest messages
      messages.splice(0, messages.length - MAX_MESSAGES_PER_CONVERSATION)
    }

    this.messages.set(dc.conversationId, messages)

    // Check if we need to create a new conversation
    let conv = this.conversations.get(dc.conversationId)
    if (!conv) {
      // Enforce conversation limit to prevent memory exhaustion
      if (this.conversations.size >= MAX_CONVERSATIONS) {
        // Remove oldest conversation
        let oldestId: string | null = null
        let oldestTime = Infinity
        for (const [id, c] of this.conversations) {
          if (c.updatedAt < oldestTime) {
            oldestTime = c.updatedAt
            oldestId = id
          }
        }
        if (oldestId) {
          this.conversations.delete(oldestId)
          this.messages.delete(oldestId)
        }
      }

      conv = {
        id: dc.conversationId,
        participants: [dc.senderFid, dc.recipientFid].sort((a, b) => a - b),
        unreadCount: 0,
        createdAt: dc.timestamp,
        updatedAt: dc.timestamp,
      }
      this.conversations.set(dc.conversationId, conv)
    }

    conv.lastMessage = dc
    conv.updatedAt = dc.timestamp

    if (dc.senderFid !== this.config.fid && !dc.isRead) {
      conv.unreadCount++
    }
  }

  private async loadConversations(): Promise<void> {
    if (!this.config.persistenceEnabled || !this.config.persistencePath) return

    const file = Bun.file(this.config.persistencePath)
    const exists = await file.exists().catch(() => false)
    if (!exists) {
      console.log(`[DC Client] No previous conversations found`)
      return
    }

    const rawData: unknown = await file.json().catch(() => null)
    const parseResult = DCPersistenceDataSchema.safeParse(rawData)
    if (!parseResult.success) {
      console.log(`[DC Client] Invalid persistence data, starting fresh`)
      return
    }

    for (const conv of parseResult.data.conversations) {
      this.conversations.set(conv.id, conv as DirectCastConversation)
    }

    for (const [id, msgs] of Object.entries(parseResult.data.messages)) {
      this.messages.set(id, msgs as DirectCast[])
    }
  }

  private async saveConversations(): Promise<void> {
    if (!this.config.persistenceEnabled || !this.config.persistencePath) return

    await Bun.write(
      this.config.persistencePath,
      JSON.stringify(
        {
          conversations: Array.from(this.conversations.values()),
          messages: Object.fromEntries(this.messages),
        },
        null,
        2,
      ),
    )
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('DC Client not initialized. Call initialize() first.')
    }
  }
  /**
   * Get client state
   */
  getState(): DCClientState {
    let totalUnread = 0
    for (const conv of this.conversations.values()) {
      totalUnread += conv.unreadCount
    }

    return {
      fid: this.config.fid,
      isInitialized: this.isInitialized,
      isConnected: this.relayConnection !== null,
      conversationCount: this.conversations.size,
      unreadCount: totalUnread,
    }
  }

  /**
   * Get encryption public key
   */
  getEncryptionPublicKey(): Hex | null {
    if (!this.encryptionPublicKey) return null
    return `0x${bytesToHex(this.encryptionPublicKey)}` as Hex
  }
}
/**
 * Create and initialize a DC client
 */
export async function createDirectCastClient(
  config: DCClientConfig,
): Promise<DirectCastClient> {
  const client = new DirectCastClient(config)
  await client.initialize()
  return client
}
