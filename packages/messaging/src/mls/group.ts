/**
 * MLS Group Management
 * 
 * Handles group creation, membership, and key rotation.
 */

import type { Address, Hex } from 'viem';
import type {
  GroupState,
  GroupMember,
  GroupMetadata,
  MLSMessage,
  SendOptions,
  FetchOptions,
  GroupInvite,
  MessageContent,
} from './types';
import type { JejuMLSClient } from './client';
import { MLSMessageSchema } from './types';
import { randomBytes } from 'node:crypto';

// ============ Types ============

export interface GroupConfig {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  createdBy: Address;
  members: Address[];
  admins: Address[];
  relayUrl: string;
  client: JejuMLSClient;
}

// ============ Group Class ============

/**
 * Represents an MLS group conversation
 */
export class JejuGroup {
  private config: GroupConfig;
  private state: GroupState;
  private messages: Map<string, MLSMessage> = new Map();
  private lastReadAt: number = 0;
  
  constructor(config: GroupConfig) {
    this.config = config;
    
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
      members: config.members.map(address => ({
        address,
        isAdmin: config.admins.includes(address),
        joinedAt: Date.now(),
        addedBy: config.createdBy,
        installationIds: [],
      })),
      isActive: true,
      unreadCount: 0,
    };
  }
  
  // ============ Lifecycle ============
  
  /**
   * Initialize the group (create MLS session)
   */
  async initialize(): Promise<void> {
    console.log(`[MLS Group] Initializing group ${this.state.id}`);
    
    // In production:
    // 1. Create MLS group with members
    // 2. Distribute welcome messages
    // 3. Store group state
    
    // Notify relay about group creation
    await this.notifyRelay('group_created', {
      groupId: this.state.id,
      metadata: this.state.metadata,
      members: this.state.members.map(m => m.address),
    });
  }
  
  /**
   * Join an existing group
   */
  async join(inviteCode: string): Promise<void> {
    console.log(`[MLS Group] Joining group ${this.state.id}`);
    
    // In production:
    // 1. Validate invite
    // 2. Process MLS welcome message
    // 3. Sync group state
    
    await this.sync();
  }
  
  /**
   * Leave the group
   */
  async leave(): Promise<void> {
    console.log(`[MLS Group] Leaving group ${this.state.id}`);
    
    // Remove self from group (triggers key rotation for remaining members)
    const selfAddress = this.config.client.getAddress();
    await this.removeMemberInternal(selfAddress, selfAddress);
    
    this.state.isActive = false;
  }
  
  // ============ Messaging ============
  
  /**
   * Send a message to the group
   */
  async send(content: string, options?: SendOptions): Promise<string> {
    const messageId = this.generateMessageId();
    const timestamp = Date.now();
    
    const message: MLSMessage = {
      id: messageId,
      groupId: this.state.id,
      senderId: Buffer.from(this.config.client.getInstallationId()).toString('hex'),
      senderAddress: this.config.client.getAddress(),
      content,
      contentType: options?.contentType as MLSMessage['contentType'] ?? 'text',
      timestamp,
      replyTo: options?.replyTo,
      metadata: options?.metadata,
    };
    
    // Validate message
    MLSMessageSchema.parse(message);
    
    // Store locally
    this.messages.set(messageId, message);
    this.state.lastMessageAt = timestamp;
    
    // Encrypt with MLS and send via relay
    await this.sendToRelay(message);
    
    console.log(`[MLS Group] Sent message ${messageId} to group ${this.state.id}`);
    
    return messageId;
  }
  
  /**
   * Send rich content
   */
  async sendContent(content: MessageContent, options?: SendOptions): Promise<string> {
    return this.send(JSON.stringify(content), {
      ...options,
      contentType: content.type,
    });
  }
  
  /**
   * Get messages with pagination
   */
  async getMessages(options?: FetchOptions): Promise<MLSMessage[]> {
    // Get messages from local cache
    let messages = Array.from(this.messages.values());
    
    // Sort by timestamp
    messages.sort((a, b) => {
      const order = options?.direction === 'desc' ? -1 : 1;
      return (a.timestamp - b.timestamp) * order;
    });
    
    // Apply filters
    if (options?.after) {
      const afterIndex = messages.findIndex(m => m.id === options.after);
      if (afterIndex >= 0) {
        messages = messages.slice(afterIndex + 1);
      }
    }
    
    if (options?.before) {
      const beforeIndex = messages.findIndex(m => m.id === options.before);
      if (beforeIndex >= 0) {
        messages = messages.slice(0, beforeIndex);
      }
    }
    
    // Apply limit
    if (options?.limit) {
      messages = messages.slice(0, options.limit);
    }
    
    return messages;
  }
  
  /**
   * Mark messages as read
   */
  markAsRead(): void {
    this.lastReadAt = Date.now();
    this.state.unreadCount = 0;
  }
  
  // ============ Membership ============
  
  /**
   * Add members to the group
   */
  async addMembers(addresses: Address[]): Promise<void> {
    this.ensureAdmin();
    
    const actor = this.config.client.getAddress();
    
    for (const address of addresses) {
      // Check not already a member
      if (this.isMember(address)) continue;
      
      // Add member
      this.state.members.push({
        address,
        isAdmin: false,
        joinedAt: Date.now(),
        addedBy: actor,
        installationIds: [],
      });
      
      console.log(`[MLS Group] Added member ${address} to group ${this.state.id}`);
    }
    
    this.state.metadata.memberCount = this.state.members.length;
    
    // In production: Update MLS group (distributes new keys)
    await this.notifyRelay('members_added', {
      groupId: this.state.id,
      members: addresses,
      actor,
    });
  }
  
  /**
   * Remove members from the group
   */
  async removeMembers(addresses: Address[]): Promise<void> {
    this.ensureAdmin();
    
    const actor = this.config.client.getAddress();
    
    for (const address of addresses) {
      await this.removeMemberInternal(address, actor);
    }
    
    // In production: Update MLS group (triggers key rotation)
    await this.notifyRelay('members_removed', {
      groupId: this.state.id,
      members: addresses,
      actor,
    });
  }
  
  /**
   * Promote member to admin
   */
  async promoteToAdmin(address: Address): Promise<void> {
    this.ensureAdmin();
    
    const member = this.state.members.find(m => m.address.toLowerCase() === address.toLowerCase());
    if (!member) {
      throw new Error(`${address} is not a member of this group`);
    }
    
    member.isAdmin = true;
    
    await this.notifyRelay('admin_promoted', {
      groupId: this.state.id,
      member: address,
      actor: this.config.client.getAddress(),
    });
  }
  
  /**
   * Check if address is a member
   */
  isMember(address: Address): boolean {
    return this.state.members.some(m => m.address.toLowerCase() === address.toLowerCase());
  }
  
  /**
   * Check if address is an admin
   */
  isAdmin(address: Address): boolean {
    const member = this.state.members.find(m => m.address.toLowerCase() === address.toLowerCase());
    return member?.isAdmin ?? false;
  }
  
  /**
   * Get members
   */
  getMembers(): GroupMember[] {
    return [...this.state.members];
  }
  
  // ============ Invites ============
  
  /**
   * Create an invite link
   */
  async createInvite(expiresInHours: number = 24): Promise<GroupInvite> {
    this.ensureAdmin();
    
    const code = randomBytes(16).toString('hex');
    const expiresAt = Date.now() + (expiresInHours * 60 * 60 * 1000);
    
    const invite: GroupInvite = {
      groupId: this.state.id,
      inviterAddress: this.config.client.getAddress(),
      groupName: this.state.metadata.name,
      memberCount: this.state.members.length,
      expiresAt,
      code,
    };
    
    // Store invite on relay
    await this.notifyRelay('invite_created', invite);
    
    return invite;
  }
  
  /**
   * Get invite link
   */
  getInviteLink(invite: GroupInvite): string {
    return `https://jeju.network/group/join?id=${invite.groupId}&code=${invite.code}`;
  }
  
  // ============ Metadata ============
  
  /**
   * Update group metadata
   */
  async updateMetadata(updates: Partial<GroupMetadata>): Promise<void> {
    this.ensureAdmin();
    
    if (updates.name) this.state.metadata.name = updates.name;
    if (updates.description !== undefined) this.state.metadata.description = updates.description;
    if (updates.imageUrl !== undefined) this.state.metadata.imageUrl = updates.imageUrl;
    
    await this.notifyRelay('metadata_updated', {
      groupId: this.state.id,
      metadata: this.state.metadata,
      actor: this.config.client.getAddress(),
    });
  }
  
  // ============ Sync ============
  
  /**
   * Sync messages from relay
   */
  async sync(): Promise<MLSMessage[]> {
    // In production, fetch new messages from relay
    // Decrypt with MLS
    // Update local cache
    
    return [];
  }
  
  // ============ State ============
  
  /**
   * Get group state
   */
  getState(): GroupState {
    return {
      ...this.state,
      members: [...this.state.members],
    };
  }
  
  /**
   * Get group metadata
   */
  getMetadata(): GroupMetadata {
    return { ...this.state.metadata };
  }
  
  /**
   * Get unread count
   */
  getUnreadCount(): number {
    return Array.from(this.messages.values())
      .filter(m => m.timestamp > this.lastReadAt)
      .length;
  }
  
  // ============ Internal Helpers ============
  
  private async removeMemberInternal(address: Address, actor: Address): Promise<void> {
    const index = this.state.members.findIndex(
      m => m.address.toLowerCase() === address.toLowerCase()
    );
    
    if (index < 0) return;
    
    this.state.members.splice(index, 1);
    this.state.metadata.memberCount = this.state.members.length;
    
    console.log(`[MLS Group] Removed member ${address} from group ${this.state.id}`);
  }
  
  private ensureAdmin(): void {
    const selfAddress = this.config.client.getAddress();
    if (!this.isAdmin(selfAddress)) {
      throw new Error('Only admins can perform this action');
    }
  }
  
  private async sendToRelay(message: MLSMessage): Promise<void> {
    // In production, encrypt with MLS and send via WebSocket
    const response = await fetch(`${this.config.relayUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: this.state.id,
        message,
      }),
    }).catch(() => null);
    
    // Ignore relay errors for now (would retry in production)
  }
  
  private async notifyRelay(event: string, data: Record<string, unknown>): Promise<void> {
    await fetch(`${this.config.relayUrl}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, data }),
    }).catch(() => null);
  }
  
  private generateMessageId(): string {
    return `${this.state.id}-${Date.now()}-${randomBytes(4).toString('hex')}`;
  }
}

