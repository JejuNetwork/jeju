/**
 * KMS-Backed Direct Cast Client
 *
 * Handles sending/receiving encrypted direct messages between Farcaster users
 * using KMS-backed cryptography. Private keys NEVER exist in application memory.
 *
 * SECURITY PROPERTIES:
 * - Signing happens inside KMS (Ed25519)
 * - Encryption/decryption happens inside KMS (X25519 + AES-GCM)
 * - Protected against TEE side-channel attacks
 */

import { createLogger } from '@jejunetwork/shared'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import type { Hex } from 'viem'

const log = createLogger('kms-dc-client')

import type {
  DirectCast,
  DirectCastConversation,
  EncryptedDirectCast,
  GetMessagesParams,
  SendDCParams,
} from './types'

/**
 * KMS Signer Interface for DC operations
 */
export interface DCKMSSigner {
  /** Key ID in the KMS */
  readonly keyId: string
  /** Public key (Ed25519, safe to expose) */
  readonly publicKey: Uint8Array
  /** Sign a message in the KMS */
  sign(message: Uint8Array): Promise<Uint8Array>
}

/**
 * KMS Encryption Provider for DC operations
 */
export interface DCKMSEncryptionProvider {
  /** Key ID for encryption operations */
  readonly keyId: string
  /** Public key (X25519, safe to share) */
  readonly publicKey: Uint8Array

  /**
   * Encrypt a message for a recipient.
   * All cryptographic operations happen inside the KMS.
   */
  encrypt(
    plaintext: Uint8Array,
    recipientPublicKey: Uint8Array,
  ): Promise<{
    ciphertext: Uint8Array
    nonce: Uint8Array
    ephemeralPublicKey: Uint8Array
  }>

  /**
   * Decrypt a message sent to us.
   * All cryptographic operations happen inside the KMS.
   */
  decrypt(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    ephemeralPublicKey: Uint8Array,
  ): Promise<Uint8Array>
}

/**
 * Configuration for KMS-backed DC Client
 */
export interface KMSDCClientConfig {
  /** Farcaster ID */
  fid: number
  /** KMS signer (Ed25519) - for signing DCs */
  kmsSigner: DCKMSSigner
  /** KMS encryption provider (X25519) - for E2E encryption */
  kmsEncryption: DCKMSEncryptionProvider
  /** Hub URL for fetching user data */
  hubUrl: string
  /** Relay URL for message transport */
  relayUrl?: string
  /** Enable persistence */
  persistenceEnabled?: boolean
  /** Persistence file path */
  persistencePath?: string
}

type MessageHandler = (message: DirectCast) => void

/** Maximum messages per conversation */
const MAX_MESSAGES_PER_CONVERSATION = 1000
/** Maximum conversations */
const MAX_CONVERSATIONS = 500
/** Maximum text length */
const MAX_DC_TEXT_LENGTH = 2000
/** Relay timeout */
const RELAY_TIMEOUT_MS = 10000

/**
 * KMS-Backed Direct Cast Client
 *
 * All cryptographic operations are delegated to the KMS.
 * Private keys never exist in application memory.
 */
export class KMSDirectCastClient {
  private readonly config: KMSDCClientConfig
  private isInitialized = false
  private conversations = new Map<string, DirectCastConversation>()
  private messages = new Map<string, DirectCast[]>()
  private messageHandlers = new Set<MessageHandler>()
  private relayConnection: WebSocket | null = null

  constructor(config: KMSDCClientConfig) {
    this.config = config
    log.info('KMS DC Client created - private keys protected in KMS', {
      fid: config.fid,
    })
  }

  /**
   * Initialize the client
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return

    log.info('Initializing KMS DC Client', { fid: this.config.fid })

    // Connect to relay
    if (this.config.relayUrl) {
      await this.connectToRelay()
    }

    // Load persisted conversations
    await this.loadConversations()

    this.isInitialized = true
    log.info('KMS DC Client initialized')
  }

  /**
   * Shutdown the client
   */
  async shutdown(): Promise<void> {
    if (this.relayConnection) {
      this.relayConnection.close(1000, 'Client shutting down')
      this.relayConnection = null
    }

    await this.saveConversations()
    this.isInitialized = false
  }

  /**
   * Send a direct cast
   *
   * Encryption and signing happen inside the KMS.
   */
  async send(params: SendDCParams): Promise<DirectCast> {
    this.ensureInitialized()

    // Validate
    if (!params.text || params.text.length === 0) {
      throw new Error('Message text cannot be empty')
    }
    if (params.text.length > MAX_DC_TEXT_LENGTH) {
      throw new Error(
        `Message text exceeds maximum length of ${MAX_DC_TEXT_LENGTH}`,
      )
    }
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

    // Encrypt message in KMS - private key never exposed
    const plaintext = new TextEncoder().encode(params.text)
    const encrypted = await this.config.kmsEncryption.encrypt(
      plaintext,
      recipientKey,
    )

    // Create signature payload
    const signaturePayload = new TextEncoder().encode(
      JSON.stringify({
        senderFid: this.config.fid,
        recipientFid: params.recipientFid,
        ciphertext: `0x${bytesToHex(encrypted.ciphertext)}`,
        timestamp,
      }),
    )

    // Sign in KMS - private key never exposed
    const signature = await this.config.kmsSigner.sign(signaturePayload)

    // Create encrypted DC for transport
    const encryptedDC: EncryptedDirectCast = {
      ciphertext: `0x${bytesToHex(encrypted.ciphertext)}` as Hex,
      nonce: `0x${bytesToHex(encrypted.nonce)}` as Hex,
      ephemeralPublicKey:
        `0x${bytesToHex(encrypted.ephemeralPublicKey)}` as Hex,
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
      isRead: true,
    }

    // Store locally
    this.addMessage(dc)

    log.info('Sent DC via KMS', { id, recipientFid: params.recipientFid })

    return dc
  }

  /**
   * Handle incoming encrypted message
   *
   * Decryption happens inside the KMS.
   */
  async handleIncomingMessage(encrypted: EncryptedDirectCast): Promise<void> {
    // Verify signature first
    const signatureValid = await this.verifyIncomingSignature(encrypted)
    if (!signatureValid) {
      log.warn('Rejecting message with invalid signature', {
        senderFid: encrypted.senderFid,
      })
      return
    }

    // Decrypt in KMS - private key never exposed
    const ciphertext = hexToBytes(encrypted.ciphertext.slice(2))
    const nonce = hexToBytes(encrypted.nonce.slice(2))
    const ephemeralPublicKey = hexToBytes(encrypted.ephemeralPublicKey.slice(2))

    const plaintext = await this.config.kmsEncryption.decrypt(
      ciphertext,
      nonce,
      ephemeralPublicKey,
    )

    const text = new TextDecoder().decode(plaintext)
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

    this.addMessage(dc)

    for (const handler of this.messageHandlers) {
      handler(dc)
    }
  }

  /**
   * Get conversations
   */
  async getConversations(): Promise<DirectCastConversation[]> {
    this.ensureInitialized()
    return Array.from(this.conversations.values())
      .filter((c) => !c.isArchived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
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

    messages = [...messages].sort((a, b) => b.timestamp - a.timestamp)

    if (options?.before) {
      const idx = messages.findIndex((m) => m.id === options.before)
      if (idx >= 0) messages = messages.slice(idx + 1)
    }

    if (options?.after) {
      const idx = messages.findIndex((m) => m.id === options.after)
      if (idx >= 0) messages = messages.slice(0, idx)
    }

    if (options?.limit) {
      messages = messages.slice(0, options.limit)
    }

    return messages
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
   * Get encryption public key (safe to share)
   */
  getEncryptionPublicKey(): Hex {
    return `0x${bytesToHex(this.config.kmsEncryption.publicKey)}` as Hex
  }

  /**
   * Get signing public key (safe to share)
   */
  getSigningPublicKey(): Hex {
    return `0x${bytesToHex(this.config.kmsSigner.publicKey)}` as Hex
  }

  // ============ Private Methods ============

  private getConversationId(otherFid: number): string {
    const fids = [this.config.fid, otherFid].sort((a, b) => a - b)
    return `dc:${fids[0]}-${fids[1]}`
  }

  private addMessage(dc: DirectCast): void {
    const messages = this.messages.get(dc.conversationId) ?? []
    messages.push(dc)

    if (messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      messages.splice(0, messages.length - MAX_MESSAGES_PER_CONVERSATION)
    }

    this.messages.set(dc.conversationId, messages)

    // Update or create conversation
    let conv = this.conversations.get(dc.conversationId)
    if (!conv) {
      if (this.conversations.size >= MAX_CONVERSATIONS) {
        // Remove oldest
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

  private async getRecipientEncryptionKey(fid: number): Promise<Uint8Array> {
    // Fetch from hub
    const response = await fetch(
      `${this.config.hubUrl}/v1/userDataByFid?fid=${fid}`,
    ).catch(() => null)

    if (!response?.ok) {
      throw new Error(`Failed to fetch encryption key for FID ${fid}`)
    }

    const data = (await response.json()) as {
      messages?: Array<{
        data?: {
          userDataBody?: { type: number; value: string }
        }
      }>
    }

    const keyData = data.messages?.find(
      (m) => m.data?.userDataBody?.type === 100,
    )

    if (!keyData?.data?.userDataBody?.value) {
      throw new Error(`No encryption key found for FID ${fid}`)
    }

    return hexToBytes(keyData.data.userDataBody.value.slice(2))
  }

  private async verifyIncomingSignature(
    encrypted: EncryptedDirectCast,
  ): Promise<boolean> {
    // Get sender's signer public key from hub
    const response = await fetch(
      `${this.config.hubUrl}/v1/onChainSignersByFid?fid=${encrypted.senderFid}`,
    ).catch(() => null)

    if (!response?.ok) return false

    const data = (await response.json()) as {
      events?: Array<{
        signerEventBody?: { key: string }
      }>
    }

    const signerEvent = data.events?.find((e) => e.signerEventBody?.key)
    if (!signerEvent?.signerEventBody?.key) return false

    const signerPublicKey = hexToBytes(signerEvent.signerEventBody.key.slice(2))

    // Verify signature
    const signaturePayload = new TextEncoder().encode(
      JSON.stringify({
        senderFid: encrypted.senderFid,
        recipientFid: encrypted.recipientFid,
        ciphertext: encrypted.ciphertext,
        timestamp: encrypted.timestamp,
      }),
    )

    const signatureBytes = hexToBytes(encrypted.signature.slice(2))

    // Use ed25519 verification
    const { ed25519 } = await import('@noble/curves/ed25519')
    return ed25519.verify(signatureBytes, signaturePayload, signerPublicKey)
  }

  private async connectToRelay(): Promise<void> {
    if (!this.config.relayUrl) return

    return new Promise((resolve, reject) => {
      const wsUrl = `${this.config.relayUrl
        ?.replace(/^http:/, 'ws:')
        .replace(/^https:/, 'wss:')
        .replace(/\/$/, '')}/dc`

      log.info('Connecting to relay', { wsUrl })

      const ws = new WebSocket(wsUrl)

      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error('Connection timeout'))
      }, 10000)

      ws.onopen = () => {
        clearTimeout(timeout)
        this.relayConnection = ws
        log.info('Connected to relay')

        // Authenticate
        ws.send(
          JSON.stringify({
            type: 'auth',
            fid: this.config.fid,
            publicKey: bytesToHex(this.config.kmsEncryption.publicKey),
          }),
        )

        resolve()
      }

      ws.onmessage = (event) => {
        this.handleWebSocketMessage(event)
      }

      ws.onclose = () => {
        clearTimeout(timeout)
        this.relayConnection = null
        log.info('Relay connection closed')
      }

      ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('WebSocket error'))
      }
    })
  }

  private handleWebSocketMessage(event: MessageEvent): void {
    if (typeof event.data !== 'string') {
      log.error('Received non-string message from relay')
      return
    }

    let parsed: { type: string; payload: EncryptedDirectCast }
    try {
      parsed = JSON.parse(event.data)
    } catch {
      log.error('Failed to parse message from relay')
      return
    }

    if (parsed.type === 'message' && parsed.payload) {
      this.handleIncomingMessage(parsed.payload).catch((error) => {
        log.error('Failed to handle incoming message', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }
  }

  private async sendToRelay(encrypted: EncryptedDirectCast): Promise<void> {
    if (!this.config.relayUrl) {
      log.debug('No relay configured')
      return
    }

    // Try WebSocket first
    if (this.relayConnection?.readyState === WebSocket.OPEN) {
      this.relayConnection.send(
        JSON.stringify({
          type: 'send',
          payload: encrypted,
        }),
      )
      return
    }

    // Fall back to HTTP
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS)

    try {
      await fetch(`${this.config.relayUrl}/api/dc/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(encrypted),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  private async loadConversations(): Promise<void> {
    if (!this.config.persistenceEnabled || !this.config.persistencePath) return

    const file = Bun.file(this.config.persistencePath)
    const exists = await file.exists().catch(() => false)
    if (!exists) return

    try {
      const data = (await file.json()) as {
        conversations: DirectCastConversation[]
        messages: Record<string, DirectCast[]>
      }

      for (const conv of data.conversations) {
        this.conversations.set(conv.id, conv)
      }

      for (const [id, msgs] of Object.entries(data.messages)) {
        this.messages.set(id, msgs)
      }
    } catch {
      log.debug('Failed to load conversations')
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
      throw new Error('KMS DC Client not initialized. Call initialize() first.')
    }
  }
}

/**
 * Create a KMS-backed DC client
 */
export async function createKMSDirectCastClient(
  config: KMSDCClientConfig,
): Promise<KMSDirectCastClient> {
  const client = new KMSDirectCastClient(config)
  await client.initialize()
  return client
}

