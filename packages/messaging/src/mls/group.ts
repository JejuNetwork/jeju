import { bytesToHex, randomBytes } from '@jejunetwork/shared'
import type { Address } from 'viem'
import type { JejuMLSClient } from './client'
import type {
  FetchOptions,
  GroupInvite,
  GroupMember,
  GroupMetadata,
  GroupState,
  MessageContent,
  MLSMessage,
  SendOptions,
} from './types'
import { MLSMessageSchema } from './types'

const MAX_MESSAGES_PER_GROUP = 10000
const MAX_MESSAGE_CONTENT_SIZE = 100000
const MAX_MEMBERS_PER_GROUP = 1000

export interface JejuGroupConfig {
  id: string
  name: string
  description?: string
  imageUrl?: string
  createdBy: Address
  members: Address[]
  admins: Address[]
  relayUrl: string
  client: JejuMLSClient
}

export class JejuGroup {
  private config: JejuGroupConfig
  private state: GroupState
  private messages: Map<string, MLSMessage> = new Map()
  private lastReadAt: number = 0

  constructor(config: JejuGroupConfig) {
    this.config = config

    // Initialize state
    this.state = {
      id: config.id,
      mlsGroupId: new Uint8Array(randomBytes(32)),
      metadata: {
        id: config.id,
        name: config.name,
        description: config.description,
        imageUrl: config.imageUrl,
        createdBy: config.createdBy,
        createdAt: Date.now(),
        memberCount: config.members.length,
      },
      members: config.members.map((address) => ({
        address,
        isAdmin: config.admins.includes(address),
        joinedAt: Date.now(),
        addedBy: config.createdBy,
        installationIds: [],
      })),
      isActive: true,
      unreadCount: 0,
    }
  }

  async initialize(): Promise<void> {
    console.log(`[MLS Group] Initializing group ${this.state.id}`)
    await this.notifyRelay('group_created', {
      groupId: this.state.id,
      metadata: this.state.metadata,
      members: this.state.members.map((m) => m.address),
    })
  }

  async join(_inviteCode: string): Promise<void> {
    console.log(`[MLS Group] Joining group ${this.state.id}`)
    await this.sync()
  }

  async leave(): Promise<void> {
    console.log(`[MLS Group] Leaving group ${this.state.id}`)
    this.removeMemberInternal(this.config.client.getAddress())
    this.state.isActive = false
  }

  async send(content: string, options?: SendOptions): Promise<string> {
    if (content.length > MAX_MESSAGE_CONTENT_SIZE) {
      throw new Error(
        `Message content exceeds maximum size of ${MAX_MESSAGE_CONTENT_SIZE} bytes`,
      )
    }

    const messageId = this.generateMessageId()
    const timestamp = Date.now()

    const message: MLSMessage = {
      id: messageId,
      groupId: this.state.id,
      senderId: Buffer.from(this.config.client.getInstallationId()).toString(
        'hex',
      ),
      senderAddress: this.config.client.getAddress(),
      content,
      contentType:
        (options?.contentType as MLSMessage['contentType']) ?? 'text',
      timestamp,
      replyTo: options?.replyTo,
      metadata: options?.metadata,
    }

    MLSMessageSchema.parse(message)

    if (this.messages.size >= MAX_MESSAGES_PER_GROUP) {
      const oldestKey = this.messages.keys().next().value
      if (oldestKey) {
        this.messages.delete(oldestKey)
      }
    }

    this.messages.set(messageId, message)
    this.state.lastMessageAt = timestamp
    await this.sendToRelay(message)

    console.log(
      `[MLS Group] Sent message ${messageId.slice(0, 12)}... to group ${this.state.id.slice(0, 12)}...`,
    )

    return messageId
  }

  async sendContent(
    content: MessageContent,
    options?: SendOptions,
  ): Promise<string> {
    return this.send(JSON.stringify(content), {
      ...options,
      contentType: content.type,
    })
  }

  async getMessages(options?: FetchOptions): Promise<MLSMessage[]> {
    let messages = Array.from(this.messages.values())
    messages.sort((a, b) => {
      const order = options?.direction === 'desc' ? -1 : 1
      return (a.timestamp - b.timestamp) * order
    })

    if (options?.after) {
      const afterIndex = messages.findIndex((m) => m.id === options.after)
      if (afterIndex >= 0) {
        messages = messages.slice(afterIndex + 1)
      }
    }

    if (options?.before) {
      const beforeIndex = messages.findIndex((m) => m.id === options.before)
      if (beforeIndex >= 0) {
        messages = messages.slice(0, beforeIndex)
      }
    }

    if (options?.limit) {
      messages = messages.slice(0, options.limit)
    }

    return messages
  }

  markAsRead(): void {
    this.lastReadAt = Date.now()
    this.state.unreadCount = 0
  }

  async addMembers(addresses: Address[]): Promise<void> {
    this.ensureAdmin()
    const newMemberCount = addresses.filter((a) => !this.isMember(a)).length
    if (this.state.members.length + newMemberCount > MAX_MEMBERS_PER_GROUP) {
      throw new Error(
        `Cannot add members: would exceed maximum of ${MAX_MEMBERS_PER_GROUP} members`,
      )
    }

    const actor = this.config.client.getAddress()

    for (const address of addresses) {
      if (this.isMember(address)) continue
      this.state.members.push({
        address,
        isAdmin: false,
        joinedAt: Date.now(),
        addedBy: actor,
        installationIds: [],
      })

      console.log(
        `[MLS Group] Added member ${address.slice(0, 10)}... to group ${this.state.id.slice(0, 12)}...`,
      )
    }

    this.state.metadata.memberCount = this.state.members.length
    await this.notifyRelay('members_added', {
      groupId: this.state.id,
      members: addresses,
      actor,
    })
  }

  async removeMembers(addresses: Address[]): Promise<void> {
    this.ensureAdmin()
    for (const address of addresses) {
      this.removeMemberInternal(address)
    }
    await this.notifyRelay('members_removed', {
      groupId: this.state.id,
      members: addresses,
      actor: this.config.client.getAddress(),
    })
  }

  async promoteToAdmin(address: Address): Promise<void> {
    this.ensureAdmin()

    const member = this.state.members.find(
      (m) => m.address.toLowerCase() === address.toLowerCase(),
    )
    if (!member) {
      throw new Error(`${address} is not a member of this group`)
    }

    member.isAdmin = true

    await this.notifyRelay('admin_promoted', {
      groupId: this.state.id,
      member: address,
      actor: this.config.client.getAddress(),
    })
  }

  isMember(address: Address): boolean {
    return this.state.members.some(
      (m) => m.address.toLowerCase() === address.toLowerCase(),
    )
  }

  isAdmin(address: Address): boolean {
    const member = this.state.members.find(
      (m) => m.address.toLowerCase() === address.toLowerCase(),
    )
    return member?.isAdmin ?? false
  }

  getMembers(): GroupMember[] {
    return [...this.state.members]
  }

  async createInvite(expiresInHours: number = 24): Promise<GroupInvite> {
    this.ensureAdmin()

    const code = bytesToHex(randomBytes(16))
    const expiresAt = Date.now() + expiresInHours * 60 * 60 * 1000

    const invite: GroupInvite = {
      groupId: this.state.id,
      inviterAddress: this.config.client.getAddress(),
      groupName: this.state.metadata.name,
      memberCount: this.state.members.length,
      expiresAt,
      code,
    }

    await this.notifyRelay('invite_created', invite)

    return invite
  }

  getInviteLink(invite: GroupInvite): string {
    return `https://jeju.network/group/join?id=${invite.groupId}&code=${invite.code}`
  }

  async updateMetadata(updates: Partial<GroupMetadata>): Promise<void> {
    this.ensureAdmin()

    if (updates.name) this.state.metadata.name = updates.name
    if (updates.description !== undefined)
      this.state.metadata.description = updates.description
    if (updates.imageUrl !== undefined)
      this.state.metadata.imageUrl = updates.imageUrl

    await this.notifyRelay('metadata_updated', {
      groupId: this.state.id,
      metadata: this.state.metadata,
      actor: this.config.client.getAddress(),
    })
  }

  async sync(): Promise<MLSMessage[]> {
    let response: Response
    try {
      response = await fetch(
        `${this.config.relayUrl}/api/messages?groupId=${encodeURIComponent(this.state.id)}&since=${this.state.lastMessageAt ?? 0}`,
      )
    } catch {
      console.log(`[MLS Group] Relay unavailable for sync`)
      return []
    }

    if (!response.ok) {
      if (response.status === 404) return []
      throw new Error(`Sync failed: ${response.status} ${response.statusText}`)
    }

    const data: { messages: unknown[] } = await response.json()
    const newMessages: MLSMessage[] = []

    for (const raw of data.messages) {
      const parseResult = MLSMessageSchema.safeParse(raw)
      if (!parseResult.success) {
        console.warn(
          `[MLS Group] Skipping invalid message: ${parseResult.error.message}`,
        )
        continue
      }

      const message = parseResult.data

      if (this.messages.has(message.id)) continue

      if (this.messages.size >= MAX_MESSAGES_PER_GROUP) {
        const oldestKey = this.messages.keys().next().value
        if (oldestKey) this.messages.delete(oldestKey)
      }

      this.messages.set(message.id, message)
      newMessages.push(message)

      if (!this.state.lastMessageAt || message.timestamp > this.state.lastMessageAt) {
        this.state.lastMessageAt = message.timestamp
      }
      if (message.senderAddress !== this.config.client.getAddress()) {
        this.state.unreadCount++
      }
    }

    return newMessages
  }

  getState(): GroupState {
    return {
      ...this.state,
      members: [...this.state.members],
    }
  }

  getMetadata(): GroupMetadata {
    return { ...this.state.metadata }
  }

  getUnreadCount(): number {
    return Array.from(this.messages.values()).filter(
      (m) => m.timestamp > this.lastReadAt,
    ).length
  }

  private removeMemberInternal(address: Address): void {
    const normalized = address.toLowerCase()
    const index = this.state.members.findIndex(
      (m) => m.address.toLowerCase() === normalized,
    )
    if (index < 0) return

    this.state.members.splice(index, 1)
    this.state.metadata.memberCount = this.state.members.length
    console.log(`[MLS Group] Removed member ${address.slice(0, 10)}...`)
  }

  private ensureAdmin(): void {
    const selfAddress = this.config.client.getAddress()
    if (!this.isAdmin(selfAddress)) {
      throw new Error('Only admins can perform this action')
    }
  }

  private async sendToRelay(message: MLSMessage): Promise<void> {
    let response: Response
    try {
      response = await fetch(`${this.config.relayUrl}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: this.state.id,
          message,
        }),
      })
    } catch {
      console.log(`[MLS Group] Relay unavailable, message stored locally only`)
      return
    }

    if (!response.ok) {
      throw new Error(
        `Failed to send message to relay: ${response.status} ${response.statusText}`,
      )
    }
  }

  private async notifyRelay(
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    let response: Response
    try {
      response = await fetch(`${this.config.relayUrl}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, data }),
      })
    } catch {
      console.log(`[MLS Group] Relay unavailable, event ${event} not sent`)
      return
    }

    if (!response.ok) {
      throw new Error(
        `Failed to notify relay of ${event}: ${response.status} ${response.statusText}`,
      )
    }
  }

  private generateMessageId(): string {
    return `${this.state.id}-${Date.now()}-${bytesToHex(randomBytes(4))}`
  }
}
