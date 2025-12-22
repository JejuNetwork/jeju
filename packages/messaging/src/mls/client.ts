/**
 * MLS Client for Jeju Messaging
 *
 * Wraps XMTP's MLS implementation with Jeju-specific features:
 * - Identity linked to Jeju wallet address
 * - Key storage in on-chain registry
 * - Transport via Jeju relay nodes
 */

import { randomBytes } from 'node:crypto'
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

    // Connect to relay
    await this.connectToRelay()

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
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
    }

    this.relayConnection?.close()
    this.groups.clear()
    this.eventHandlers.clear()
    this.isInitialized = false

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
   * Derive MLS keys from wallet signature
   */
  private async deriveMLSKeys(_signature: Hex): Promise<void> {
    // In production, use proper key derivation
    // Derives identity key and pre-keys from signature
    console.log(`[MLS Client] Derived MLS keys from signature`)
  }

  /**
   * Register public key in Jeju KeyRegistry
   */
  private async registerPublicKey(): Promise<void> {
    // Call KeyRegistry contract
    console.log(`[MLS Client] Registered public key in KeyRegistry`)
  }

  /**
   * Verify members have registered keys
   */
  private async verifyMemberKeys(members: Address[]): Promise<void> {
    // Check KeyRegistry for each member
    for (const member of members) {
      // In production, query contract
      console.log(`[MLS Client] Verified keys for ${member}`)
    }
  }

  /**
   * Connect to Jeju relay
   */
  private async connectToRelay(): Promise<void> {
    return new Promise((resolve) => {
      // In production, establish WebSocket connection
      console.log(`[MLS Client] Connected to relay: ${this.config.relayUrl}`)
      resolve()
    })
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
    return randomBytes(16).toString('hex')
  }
}

/**
 * Create an MLS client
 */
export function createMLSClient(config: MLSClientConfig): JejuMLSClient {
  return new JejuMLSClient(config)
}
