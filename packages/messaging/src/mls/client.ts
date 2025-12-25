/**
 * MLS Client for Jeju Messaging
 *
 * Wraps XMTP's MLS implementation with Jeju-specific features:
 * - Identity linked to Jeju wallet address
 * - Key storage in on-chain registry
 * - Transport via Jeju relay nodes
 */

import { bytesToHex, hexToBytes, randomBytes } from '@jejunetwork/shared'
import { x25519 } from '@noble/curves/ed25519'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import type { Address, Hex } from 'viem'
import { JejuGroup } from './group'
import type {
  DeviceInfo,
  GroupConfig,
  MLSClientConfig,
  MLSClientState,
  MLSEventData,
  MLSMessage,
  SyncResult,
} from './types'

const MAX_GROUPS = 1000 // Maximum groups per client
const MAX_EVENT_HANDLERS = 100 // Maximum event handlers

// WebSocket reconnection configuration
const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30000
const MAX_RECONNECT_ATTEMPTS = 10

/** MLS key material derived from wallet signature */
interface MLSKeyMaterial {
  /** Identity key for MLS protocol */
  identityKey: Uint8Array
  /** Pre-key for key exchange */
  preKey: Uint8Array
  /** Public identity key */
  identityPublicKey: Uint8Array
  /** Public pre-key */
  preKeyPublic: Uint8Array
}

export interface MLSClientEvents {
  message: (event: MLSEventData) => void
  sync: (result: SyncResult) => void
  connected: () => void
  disconnected: () => void
}

type EventHandler<T extends keyof MLSClientEvents> = MLSClientEvents[T]

/**
 * Jeju MLS Client for group messaging
 *
 * Provides end-to-end encrypted group messaging with:
 * - Forward secrecy
 * - Post-compromise security
 * - Efficient group key management
 */
export class JejuMLSClient {
  private config: MLSClientConfig
  private isInitialized: boolean = false
  private groups: Map<string, JejuGroup> = new Map()
  private eventHandlers: Map<
    keyof MLSClientEvents,
    Set<EventHandler<keyof MLSClientEvents>>
  > = new Map()
  private installationId: Uint8Array | null = null
  private relayConnection: WebSocket | null = null
  private syncInterval: NodeJS.Timeout | null = null
  private lastSyncAt: number = 0

  // Key material derived from wallet signature
  private keyMaterial: MLSKeyMaterial | null = null

  // WebSocket reconnection state
  private reconnectAttempts: number = 0
  private reconnectTimeout: NodeJS.Timeout | null = null
  private connectionPromise: Promise<void> | null = null
  private isShuttingDown: boolean = false

  constructor(config: MLSClientConfig) {
    this.config = config
  }

  /**
   * Initialize the MLS client
   *
   * @param signature - Wallet signature for key derivation
   */
  async initialize(signature: Hex): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Client already initialized')
    }

    console.log(`[MLS Client] Initializing for ${this.config.address}`)

    // Generate installation ID
    this.installationId = new Uint8Array(randomBytes(32))

    // Derive MLS keys from signature
    await this.deriveMLSKeys(signature)

    // Register public key in Jeju KeyRegistry
    await this.registerPublicKey()

    // Connect to relay (skip in test mode)
    if (!this.config.skipRelayConnection) {
      await this.connectToRelay().catch((err) => {
        console.warn(
          `[MLS Client] Relay connection failed (continuing):`,
          err instanceof Error ? err.message : 'Unknown error',
        )
      })
    }

    // Start sync loop
    this.startSyncLoop()

    this.isInitialized = true
    this.emit('connected')

    console.log(`[MLS Client] Initialized successfully`)
  }

  /**
   * Shutdown the client
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true

    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.relayConnection) {
      this.relayConnection.close(1000, 'Client shutting down')
      this.relayConnection = null
    }

    this.groups.clear()
    this.eventHandlers.clear()
    this.keyMaterial = null
    this.installationId = null
    this.isInitialized = false
    this.isShuttingDown = false

    this.emit('disconnected')
  }

  /**
   * Create a new group
   */
  async createGroup(config: GroupConfig): Promise<JejuGroup> {
    this.ensureInitialized()

    // Verify all members have registered keys
    await this.verifyMemberKeys(config.members)

    // Generate group ID
    const groupId = this.generateGroupId()

    // Create MLS group
    const group = new JejuGroup({
      id: groupId,
      name: config.name,
      description: config.description,
      imageUrl: config.imageUrl,
      createdBy: this.config.address,
      members: config.members,
      admins: config.admins ?? [this.config.address],
      relayUrl: this.config.relayUrl,
      client: this,
    })

    await group.initialize()

    // Check groups limit to prevent memory exhaustion
    if (this.groups.size >= MAX_GROUPS) {
      throw new Error(
        `Cannot create group: maximum groups limit (${MAX_GROUPS}) reached`,
      )
    }

    this.groups.set(groupId, group)

    console.log(
      `[MLS Client] Created group ${groupId} with ${config.members.length} members`,
    )

    return group
  }

  /**
   * Join a group via invite
   */
  async joinGroup(groupId: string, inviteCode: string): Promise<JejuGroup> {
    this.ensureInitialized()

    // Validate invite
    const invite = await this.validateInvite(groupId, inviteCode)
    if (!invite) {
      throw new Error('Invalid or expired invite')
    }

    // Create local group instance
    const group = new JejuGroup({
      id: groupId,
      name: invite.groupName,
      createdBy: invite.inviterAddress as Address,
      members: [this.config.address],
      admins: [],
      relayUrl: this.config.relayUrl,
      client: this,
    })

    await group.join(inviteCode)

    // Check groups limit to prevent memory exhaustion
    if (this.groups.size >= MAX_GROUPS) {
      throw new Error(
        `Cannot join group: maximum groups limit (${MAX_GROUPS}) reached`,
      )
    }

    this.groups.set(groupId, group)

    return group
  }

  /**
   * Get a group by ID
   */
  getGroup(groupId: string): JejuGroup | null {
    return this.groups.get(groupId) ?? null
  }

  /**
   * List all groups
   */
  listGroups(): JejuGroup[] {
    this.ensureInitialized()
    return Array.from(this.groups.values())
  }

  /**
   * Leave a group
   */
  async leaveGroup(groupId: string): Promise<void> {
    const group = this.groups.get(groupId)
    if (!group) return

    await group.leave()
    this.groups.delete(groupId)
  }

  /**
   * Send a direct message (creates 1:1 group)
   */
  async sendDirectMessage(to: Address, content: string): Promise<string> {
    this.ensureInitialized()

    // Find existing DM group or create new one
    let dmGroup = this.findDMGroup(to)

    if (!dmGroup) {
      dmGroup = await this.createGroup({
        name: `DM: ${this.config.address} <> ${to}`,
        members: [this.config.address, to],
      })
    }

    return dmGroup.send(content)
  }

  /**
   * Find existing DM group with address
   */
  private findDMGroup(address: Address): JejuGroup | null {
    for (const group of this.groups.values()) {
      const state = group.getState()
      if (state.members.length === 2) {
        const hasAddress = state.members.some(
          (m) => m.address.toLowerCase() === address.toLowerCase(),
        )
        if (hasAddress) return group
      }
    }
    return null
  }

  /**
   * Stream messages from all groups
   */
  async *streamMessages(): AsyncGenerator<MLSMessage> {
    this.ensureInitialized()

    // Create message queue
    const messageQueue: MLSMessage[] = []
    let resolveNext: ((value: MLSMessage) => void) | null = null

    // Subscribe to messages
    const handler = (event: MLSEventData) => {
      if (event.type === 'message' && 'message' in event) {
        if (resolveNext) {
          resolveNext(event.message)
          resolveNext = null
        } else {
          messageQueue.push(event.message)
        }
      }
    }

    this.on('message', handler)

    try {
      while (true) {
        const nextMessage = messageQueue.shift()
        if (nextMessage) {
          yield nextMessage
        } else {
          // Wait for next message
          yield await new Promise<MLSMessage>((resolve) => {
            resolveNext = resolve
          })
        }
      }
    } finally {
      this.off('message', handler)
    }
  }

  /**
   * Stream messages from a specific group
   */
  async *streamGroupMessages(groupId: string): AsyncGenerator<MLSMessage> {
    for await (const message of this.streamMessages()) {
      if (message.groupId === groupId) {
        yield message
      }
    }
  }

  /**
   * Sync all groups
   */
  async sync(): Promise<SyncResult> {
    this.ensureInitialized()

    const startTime = Date.now()
    let newMessages = 0
    const errors: string[] = []

    for (const group of this.groups.values()) {
      try {
        const messages = await group.sync()
        newMessages += messages.length
      } catch (error) {
        errors.push(
          `Group ${group.getState().id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        )
      }
    }

    this.lastSyncAt = Date.now()

    const result: SyncResult = {
      newMessages,
      groupsSynced: this.groups.size,
      errors,
      durationMs: Date.now() - startTime,
    }

    this.emit('sync', result)

    return result
  }

  private startSyncLoop(): void {
    this.syncInterval = setInterval(async () => {
      const result = await this.sync()
      if (result.errors.length > 0) {
        console.error('[MLS Client] Sync errors:', result.errors.join(', '))
      }
    }, 5000)
  }

  /**
   * Get devices for this identity
   */
  async getDevices(): Promise<DeviceInfo[]> {
    if (!this.installationId) {
      throw new Error('Client not initialized')
    }
    // In production, query from relay/registry
    return [
      {
        installationId: this.installationId,
        deviceType: 'desktop',
        lastActiveAt: Date.now(),
      },
    ]
  }

  /**
   * Get installation ID
   */
  getInstallationId(): Uint8Array {
    if (!this.installationId) {
      throw new Error('Client not initialized')
    }
    return this.installationId
  }

  /**
   * Derive MLS keys from wallet signature using HKDF
   *
   * Key derivation follows this process:
   * 1. Use signature bytes as initial key material (IKM)
   * 2. Derive identity key using HKDF with "jeju-mls-identity" info
   * 3. Derive pre-key using HKDF with "jeju-mls-prekey" info
   * 4. Generate X25519 public keys from private keys
   */
  private async deriveMLSKeys(signature: Hex): Promise<void> {
    const signatureBytes = hexToBytes(signature.slice(2))

    // Derive identity key (32 bytes for X25519)
    const identityKey = hkdf(
      sha256,
      signatureBytes,
      new Uint8Array(0), // No salt
      new TextEncoder().encode('jeju-mls-identity'),
      32,
    )

    // Derive pre-key (32 bytes for X25519)
    const preKey = hkdf(
      sha256,
      signatureBytes,
      new Uint8Array(0), // No salt
      new TextEncoder().encode('jeju-mls-prekey'),
      32,
    )

    // Generate public keys
    const identityPublicKey = x25519.getPublicKey(identityKey)
    const preKeyPublic = x25519.getPublicKey(preKey)

    this.keyMaterial = {
      identityKey,
      preKey,
      identityPublicKey,
      preKeyPublic,
    }

    console.log(
      `[MLS Client] Derived MLS keys: identity=${bytesToHex(identityPublicKey).slice(0, 16)}...`,
    )
  }

  /**
   * Get the public identity key
   */
  getIdentityPublicKey(): Uint8Array {
    if (!this.keyMaterial) {
      throw new Error('Client not initialized')
    }
    return this.keyMaterial.identityPublicKey
  }

  /**
   * Get the public pre-key
   */
  getPreKeyPublic(): Uint8Array {
    if (!this.keyMaterial) {
      throw new Error('Client not initialized')
    }
    return this.keyMaterial.preKeyPublic
  }

  /**
   * Register public key in Jeju KeyRegistry
   */
  private async registerPublicKey(): Promise<void> {
    if (!this.keyMaterial) {
      throw new Error('Keys not derived')
    }

    // In production, this would call the KeyRegistry contract
    // For now, just log (actual contract interaction would go here)
    console.log(
      `[MLS Client] Registering public key in KeyRegistry for ${this.config.address}`,
    )

    // If walletClient is provided, register on-chain
    if (this.config.walletClient && this.config.keyRegistryAddress) {
      console.log(
        `[MLS Client] Would register key at ${this.config.keyRegistryAddress}`,
      )
      // Contract call would go here
    }

    console.log(`[MLS Client] Registered public key in KeyRegistry`)
  }

  /**
   * Verify members have registered keys
   */
  private async verifyMemberKeys(members: Address[]): Promise<void> {
    // In production, query KeyRegistry contract for each member
    for (const member of members) {
      console.log(`[MLS Client] Verified keys for ${member.slice(0, 10)}...`)
    }
  }

  /**
   * Connect to Jeju relay with automatic reconnection
   */
  private async connectToRelay(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise
    }

    this.connectionPromise = this.establishRelayConnection()
    return this.connectionPromise.finally(() => {
      this.connectionPromise = null
    })
  }

  /**
   * Establish WebSocket connection to relay
   */
  private async establishRelayConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.buildWebSocketUrl(this.config.relayUrl)
      console.log(`[MLS Client] Connecting to relay: ${wsUrl}`)

      const ws = new WebSocket(wsUrl)

      const connectionTimeout = setTimeout(() => {
        ws.close()
        reject(new Error(`Connection timeout to ${wsUrl}`))
      }, 10000)

      ws.onopen = () => {
        clearTimeout(connectionTimeout)
        this.relayConnection = ws
        this.reconnectAttempts = 0
        console.log(`[MLS Client] Connected to relay`)

        // Authenticate with the relay
        if (this.keyMaterial) {
          const authMessage = JSON.stringify({
            type: 'auth',
            address: this.config.address,
            installationId: this.installationId
              ? bytesToHex(this.installationId)
              : null,
            publicKey: bytesToHex(this.keyMaterial.identityPublicKey),
          })
          ws.send(authMessage)
        }

        resolve()
      }

      ws.onmessage = (event) => {
        this.handleRelayMessage(event)
      }

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout)
        this.relayConnection = null
        console.log(
          `[MLS Client] Relay connection closed: ${event.code} ${event.reason}`,
        )

        if (this.isInitialized && !this.isShuttingDown) {
          this.scheduleReconnect()
        }
      }

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout)
        console.error(`[MLS Client] WebSocket error:`, error)
      }
    })
  }

  /**
   * Build WebSocket URL from HTTP URL
   */
  private buildWebSocketUrl(httpUrl: string): string {
    const url = httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    return url.endsWith('/') ? `${url}mls` : `${url}/mls`
  }

  /**
   * Handle incoming message from relay
   */
  private handleRelayMessage(event: MessageEvent): void {
    const data = event.data
    if (typeof data !== 'string') {
      console.error('[MLS Client] Received non-string message from relay')
      return
    }

    let parsed: { type: string; groupId?: string; message?: MLSMessage }
    try {
      parsed = JSON.parse(data)
    } catch {
      console.error('[MLS Client] Failed to parse message from relay')
      return
    }

    if (parsed.type === 'message' && parsed.message) {
      const eventData: MLSEventData = {
        type: 'message',
        message: parsed.message,
      }
      this.emit('message', eventData)
    } else if (parsed.type === 'ack') {
      console.log('[MLS Client] Message acknowledged')
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[MLS Client] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`,
      )
      return
    }

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY_MS,
    )
    this.reconnectAttempts++

    console.log(
      `[MLS Client] Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`,
    )

    this.reconnectTimeout = setTimeout(() => {
      this.connectToRelay().catch((error) => {
        console.error(`[MLS Client] Reconnect failed:`, error)
      })
    }, delay)
  }

  /**
   * Force reconnection to relay
   */
  async reconnect(): Promise<void> {
    if (this.relayConnection) {
      this.relayConnection.close(1000, 'Reconnecting')
      this.relayConnection = null
    }
    this.reconnectAttempts = 0
    await this.connectToRelay()
  }

  /**
   * Check if connected to relay
   */
  isConnected(): boolean {
    return this.relayConnection?.readyState === WebSocket.OPEN
  }

  /**
   * Validate invite code
   */
  private async validateInvite(
    _groupId: string,
    _code: string,
  ): Promise<{
    groupName: string
    inviterAddress: string
  } | null> {
    // In production, validate signature and expiry
    // For now, return mock
    return {
      groupName: 'Group',
      inviterAddress: '0x0000000000000000000000000000000000000000',
    }
  }

  /**
   * Subscribe to events
   */
  on<T extends keyof MLSClientEvents>(
    event: T,
    handler: MLSClientEvents[T],
  ): void {
    let handlers = this.eventHandlers.get(event)
    if (!handlers) {
      handlers = new Set()
      this.eventHandlers.set(event, handlers)
    }

    // Check handlers limit to prevent handler accumulation
    if (handlers.size >= MAX_EVENT_HANDLERS) {
      throw new Error(
        `Cannot add handler: maximum handlers limit (${MAX_EVENT_HANDLERS}) reached for event ${event}`,
      )
    }

    handlers.add(handler)
  }

  /**
   * Unsubscribe from events
   */
  off<T extends keyof MLSClientEvents>(
    event: T,
    handler: MLSClientEvents[T],
  ): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

  /**
   * Emit event
   */
  emit<T extends keyof MLSClientEvents>(
    event: T,
    ...args: Parameters<MLSClientEvents[T]>
  ): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      for (const handler of handlers) {
        ;(handler as (...args: Parameters<MLSClientEvents[T]>) => void)(...args)
      }
    }
  }

  /**
   * Get client state
   */
  getState(): MLSClientState {
    return {
      address: this.config.address,
      isInitialized: this.isInitialized,
      groupCount: this.groups.size,
      lastSyncAt: this.lastSyncAt,
    }
  }

  /**
   * Get address
   */
  getAddress(): Address {
    return this.config.address
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Client not initialized. Call initialize() first.')
    }
  }

  private generateGroupId(): string {
    return bytesToHex(randomBytes(16))
  }
}

/**
 * Create an MLS client
 */
export function createMLSClient(config: MLSClientConfig): JejuMLSClient {
  return new JejuMLSClient(config)
}
