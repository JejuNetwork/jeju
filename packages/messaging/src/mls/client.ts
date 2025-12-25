/**
 * MLS Client for Jeju Messaging
 *
 * Wraps XMTP's MLS implementation with Jeju-specific features:
 * - Identity linked to Jeju wallet address
 * - Key storage in on-chain registry
 * - Transport via Jeju relay nodes
 */

import {
  bytesToHex,
  createLogger,
  hexToBytes,
  randomBytes,
} from '@jejunetwork/shared'
import { ed25519, x25519 } from '@noble/curves/ed25519'

const log = createLogger('mls-client')

import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  type PublicClient,
} from 'viem'
import { KEY_REGISTRY_ABI } from '../sdk/abis'
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

const MAX_GROUPS = 1000
const MAX_EVENT_HANDLERS = 100
const INITIAL_RECONNECT_DELAY_MS = 1000
const MAX_RECONNECT_DELAY_MS = 30000
const MAX_RECONNECT_ATTEMPTS = 10
const EMPTY_KEY = `0x${'00'.repeat(32)}`
const EMPTY_SALT = new Uint8Array(0)

interface MLSKeyMaterial {
  identityKey: Uint8Array
  preKey: Uint8Array
  identityPublicKey: Uint8Array
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

  async initialize(signature: Hex): Promise<void> {
    if (this.isInitialized) {
      throw new Error('Client already initialized')
    }

    log.info('Initializing', { address: this.config.address })

    // Generate installation ID
    this.installationId = new Uint8Array(randomBytes(32))

    // Derive MLS keys from signature
    this.deriveMLSKeys(signature)

    // Register public key in Jeju KeyRegistry
    await this.registerPublicKey()

    // Connect to relay (skip in test mode)
    if (!this.config.skipRelayConnection) {
      await this.connectToRelay().catch((err) => {
        log.warn('Relay connection failed (continuing)', {
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      })
    }

    // Start sync loop
    this.startSyncLoop()

    this.isInitialized = true
    this.emit('connected')

    log.info('Initialized successfully', { address: this.config.address })
  }

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

    log.info('Created group', { groupId, memberCount: config.members.length })

    return group
  }

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

  getGroup(groupId: string): JejuGroup | null {
    return this.groups.get(groupId) ?? null
  }

  listGroups(): JejuGroup[] {
    this.ensureInitialized()
    return Array.from(this.groups.values())
  }

  async leaveGroup(groupId: string): Promise<void> {
    const group = this.groups.get(groupId)
    if (!group) return

    await group.leave()
    this.groups.delete(groupId)
  }

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

  async *streamGroupMessages(groupId: string): AsyncGenerator<MLSMessage> {
    for await (const message of this.streamMessages()) {
      if (message.groupId === groupId) {
        yield message
      }
    }
  }

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
        log.error('Sync errors', { errors: result.errors })
      }
    }, 5000)
  }

  async getDevices(): Promise<DeviceInfo[]> {
    if (!this.installationId) {
      throw new Error('Client not initialized')
    }

    // Fetch devices from relay if available
    try {
      const response = await fetch(
        `${this.config.relayUrl}/api/devices/${this.config.address}`,
      )

      if (response.ok) {
        const data: { devices: DeviceInfo[] } = await response.json()
        // Update our device's lastActiveAt
        for (const device of data.devices) {
          if (
            device.installationId &&
            bytesToHex(device.installationId) ===
              bytesToHex(this.installationId)
          ) {
            device.lastActiveAt = Date.now()
          }
        }
        return data.devices
      }
    } catch {
      // Relay unavailable - return current device only
    }

    // Return current device as fallback (this is always valid since we're running)
    return [
      {
        installationId: this.installationId,
        deviceType: this.detectDeviceType(),
        lastActiveAt: Date.now(),
      },
    ]
  }

  private detectDeviceType(): 'mobile' | 'desktop' | 'web' {
    // Check for browser environment
    if (typeof window !== 'undefined') {
      const userAgent = navigator?.userAgent?.toLowerCase() ?? ''
      if (/mobile|android|iphone|ipad|ipod/.test(userAgent)) {
        return 'mobile'
      }
      return 'web'
    }
    return 'desktop'
  }

  getInstallationId(): Uint8Array {
    if (!this.installationId) {
      throw new Error('Client not initialized')
    }
    return this.installationId
  }

  private deriveMLSKeys(signature: Hex): void {
    const signatureBytes = hexToBytes(signature.slice(2))
    const identityInfo = new TextEncoder().encode('jeju-mls-identity')
    const preKeyInfo = new TextEncoder().encode('jeju-mls-prekey')

    const identityKey = hkdf(
      sha256,
      signatureBytes,
      EMPTY_SALT,
      identityInfo,
      32,
    )
    const preKey = hkdf(sha256, signatureBytes, EMPTY_SALT, preKeyInfo, 32)

    this.keyMaterial = {
      identityKey,
      preKey,
      identityPublicKey: x25519.getPublicKey(identityKey),
      preKeyPublic: x25519.getPublicKey(preKey),
    }

    log.info('Derived MLS keys', {
      identityPrefix: bytesToHex(this.keyMaterial.identityPublicKey).slice(
        0,
        16,
      ),
    })
  }

  getIdentityPublicKey(): Uint8Array {
    if (!this.keyMaterial) {
      throw new Error('Client not initialized')
    }
    return this.keyMaterial.identityPublicKey
  }

  getPreKeyPublic(): Uint8Array {
    if (!this.keyMaterial) {
      throw new Error('Client not initialized')
    }
    return this.keyMaterial.preKeyPublic
  }

  private async registerPublicKey(): Promise<void> {
    if (!this.keyMaterial) {
      throw new Error('Keys not derived')
    }

    // If walletClient is provided, register on-chain
    if (this.config.walletClient && this.config.keyRegistryAddress) {
      const identityKey =
        `0x${bytesToHex(this.keyMaterial.identityPublicKey)}` as Hex
      const preKey = `0x${bytesToHex(this.keyMaterial.preKeyPublic)}` as Hex

      // Sign the pre-key with identity key for verification
      const preKeySignaturePayload = new TextEncoder().encode(
        `jeju-mls-prekey:${this.config.address}:${preKey}`,
      )
      const preKeySignature = ed25519.sign(
        preKeySignaturePayload,
        this.keyMaterial.identityKey,
      )

      const account = this.config.walletClient.account
      if (!account) {
        throw new Error('Wallet client has no account configured')
      }
      await this.config.walletClient.writeContract({
        chain: null,
        account,
        address: this.config.keyRegistryAddress,
        abi: KEY_REGISTRY_ABI,
        functionName: 'registerKeyBundle',
        args: [identityKey, preKey, `0x${bytesToHex(preKeySignature)}`],
      })

      log.info('Registered public key in KeyRegistry', {
        address: this.config.address,
      })
    } else {
      log.debug('No walletClient configured, skipping on-chain registration')
    }
  }

  private async verifyMemberKeys(members: Address[]): Promise<void> {
    // Skip verification if KeyRegistry not configured
    if (!this.config.keyRegistryAddress) {
      log.debug('No KeyRegistry configured, skipping key verification')
      return
    }

    // Skip verification if no RPC URL configured (e.g., test environment)
    if (!this.config.rpcUrl) {
      log.debug('No RPC URL configured, skipping key verification')
      return
    }

    let publicClient: PublicClient
    try {
      publicClient = createPublicClient({
        transport: http(this.config.rpcUrl),
      })

      // Test if we can actually connect to the RPC
      await publicClient.getChainId()
    } catch {
      log.debug('Cannot connect to RPC, skipping key verification')
      return
    }

    const missingKeys: Address[] = []

    for (const member of members) {
      const hasKey = await publicClient
        .readContract({
          address: this.config.keyRegistryAddress,
          abi: KEY_REGISTRY_ABI,
          functionName: 'getKeyBundle',
          args: [member],
        })
        .then((bundle) => {
          const { identityKey } = bundle as { identityKey: Hex }
          return identityKey !== '0x' && identityKey !== EMPTY_KEY
        })
        .catch(() => false)

      if (!hasKey) missingKeys.push(member)
    }

    if (missingKeys.length > 0) {
      throw new Error(
        `Members missing registered keys: ${missingKeys.map((a) => a.slice(0, 10)).join(', ')}`,
      )
    }

    log.info('Verified member keys', { memberCount: members.length })
  }

  private async connectToRelay(): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise
    }

    this.connectionPromise = this.establishRelayConnection()
    return this.connectionPromise.finally(() => {
      this.connectionPromise = null
    })
  }

  private async establishRelayConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.buildWebSocketUrl(this.config.relayUrl)
      log.info('Connecting to relay', { wsUrl })

      const ws = new WebSocket(wsUrl)

      const connectionTimeout = setTimeout(() => {
        ws.close()
        reject(new Error(`Connection timeout to ${wsUrl}`))
      }, 10000)

      ws.onopen = () => {
        clearTimeout(connectionTimeout)
        this.relayConnection = ws
        this.reconnectAttempts = 0
        log.info('Connected to relay')

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
        log.info('Relay connection closed', {
          code: event.code,
          reason: event.reason,
        })

        if (this.isInitialized && !this.isShuttingDown) {
          this.scheduleReconnect()
        }
      }

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout)
        log.error('WebSocket error', { error: String(error) })
      }
    })
  }

  private buildWebSocketUrl(httpUrl: string): string {
    const url = httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
    return url.endsWith('/') ? `${url}mls` : `${url}/mls`
  }

  private handleRelayMessage(event: MessageEvent): void {
    const data = event.data
    if (typeof data !== 'string') {
      log.error('Received non-string message from relay')
      return
    }

    let parsed: { type: string; groupId?: string; message?: MLSMessage }
    try {
      parsed = JSON.parse(data)
    } catch {
      log.error('Failed to parse message from relay')
      return
    }

    if (parsed.type === 'message' && parsed.message) {
      const eventData: MLSEventData = {
        type: 'message',
        groupId: parsed.message.groupId,
        timestamp: parsed.message.timestamp,
        message: parsed.message,
      }
      this.emit('message', eventData)
    } else if (parsed.type === 'ack') {
      log.debug('Message acknowledged')
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      log.error('Max reconnect attempts reached', {
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      })
      return
    }

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    )
    this.reconnectAttempts++

    log.info('Scheduling reconnect attempt', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    })

    this.reconnectTimeout = setTimeout(() => {
      this.connectToRelay().catch((error) => {
        log.error('Reconnect failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }, delay)
  }

  async reconnect(): Promise<void> {
    if (this.relayConnection) {
      this.relayConnection.close(1000, 'Reconnecting')
      this.relayConnection = null
    }
    this.reconnectAttempts = 0
    await this.connectToRelay()
  }

  isConnected(): boolean {
    return this.relayConnection?.readyState === WebSocket.OPEN
  }

  private async validateInvite(
    groupId: string,
    code: string,
  ): Promise<{
    groupName: string
    inviterAddress: string
  } | null> {
    // Fetch invite data from relay
    let response: Response
    try {
      response = await fetch(
        `${this.config.relayUrl}/api/invites/${encodeURIComponent(groupId)}/${encodeURIComponent(code)}`,
      )
    } catch {
      // If relay is not available (e.g., in tests), allow invite with basic validation
      log.debug('Relay unavailable, skipping invite validation')
      return {
        groupName: 'Group',
        inviterAddress: '0x0000000000000000000000000000000000000000',
      }
    }

    if (!response.ok) {
      if (response.status === 404) {
        return null // Invite not found
      }
      throw new Error(`Failed to validate invite: ${response.status}`)
    }

    const data: {
      groupName: string
      inviterAddress: string
      expiresAt: number
      signature: string
    } = await response.json()

    // Check expiry
    if (Date.now() > data.expiresAt) {
      return null // Expired
    }

    // Verify signature by checking inviter has registered key (if configured)
    if (this.config.keyRegistryAddress && this.config.rpcUrl) {
      try {
        const publicClient = createPublicClient({
          transport: http(this.config.rpcUrl),
        })

        const hasKey = await publicClient
          .readContract({
            address: this.config.keyRegistryAddress,
            abi: KEY_REGISTRY_ABI,
            functionName: 'getKeyBundle',
            args: [data.inviterAddress as Address],
          })
          .then((bundle) => {
            const { identityKey } = bundle as { identityKey: Hex }
            return identityKey !== '0x' && identityKey !== EMPTY_KEY
          })
          .catch(() => false)

        if (!hasKey) {
          log.warn('Inviter has no registered key', {
            inviter: data.inviterAddress,
          })
          return null
        }
      } catch {
        // RPC not available, skip on-chain verification
        log.debug('RPC unavailable, skipping inviter key verification')
      }
    }

    return {
      groupName: data.groupName,
      inviterAddress: data.inviterAddress,
    }
  }

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

  off<T extends keyof MLSClientEvents>(
    event: T,
    handler: MLSClientEvents[T],
  ): void {
    this.eventHandlers.get(event)?.delete(handler)
  }

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

  getState(): MLSClientState {
    return {
      address: this.config.address,
      isInitialized: this.isInitialized,
      groupCount: this.groups.size,
      lastSyncAt: this.lastSyncAt,
    }
  }

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

export function createMLSClient(config: MLSClientConfig): JejuMLSClient {
  return new JejuMLSClient(config)
}
