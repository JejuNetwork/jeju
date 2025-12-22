# Agent Task: SDK MessagingModule with XMTP Group Chat Support

## Priority: P1
## Estimated Time: 2 days
## Dependencies: agent-xmtp-mls-sdk, agent-xmtp-consent

## Objective

Create a unified SDK MessagingModule that integrates XMTP group chat, Jeju relay messaging, and consent management into a single, cohesive API for developers.

## Source Files to Analyze

- `packages/sdk/src/messaging/index.ts` - Current messaging module
- `packages/sdk/src/client.ts` - Main SDK client
- `packages/messaging/src/mls/client.ts` - MLS client
- `packages/messaging/src/consent/client.ts` - Consent client

## Implementation Tasks

### 1. Unified Messaging Module Interface

File: `packages/sdk/src/messaging/index.ts` (complete rewrite)

```typescript
/**
 * Messaging Module - Unified messaging with XMTP group chat
 *
 * Provides:
 * - 1:1 encrypted messaging (Jeju native)
 * - Group messaging with MLS (via XMTP)
 * - Consent management
 * - Message sync and persistence
 */

import type { Address, Hex } from 'viem';
import type { NetworkType } from '@jejunetwork/types';
import type { JejuWallet } from '../wallet';

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface Message {
  id: string;
  conversationId: string;
  senderId: Address;
  content: string;
  contentType: MessageContentType;
  timestamp: number;
  status: 'pending' | 'sent' | 'delivered' | 'read';
  replyTo?: string;
  reactions?: MessageReaction[];
}

export type MessageContentType = 'text' | 'image' | 'file' | 'transaction' | 'agent_action';

export interface MessageReaction {
  emoji: string;
  senderId: Address;
  timestamp: number;
}

export interface Conversation {
  id: string;
  type: 'dm' | 'group';
  participants: Address[];
  metadata?: {
    name?: string;
    description?: string;
    imageUrl?: string;
  };
  lastMessage?: Message;
  unreadCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationFilter {
  type?: 'dm' | 'group' | 'all';
  participant?: Address;
  hasUnread?: boolean;
  limit?: number;
  cursor?: string;
}

export interface SendMessageParams {
  conversationId: string;
  content: string;
  contentType?: MessageContentType;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateGroupParams {
  name: string;
  description?: string;
  imageUrl?: string;
  members: Address[];
}

// ═══════════════════════════════════════════════════════════════════════════
//                         MODULE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

export interface MessagingModule {
  // ============ Initialization ============
  
  /**
   * Initialize messaging (required before use)
   */
  initialize(): Promise<void>;
  
  /**
   * Check if messaging is initialized
   */
  isInitialized(): boolean;
  
  // ============ Conversations ============
  
  /**
   * List conversations
   */
  listConversations(filter?: ConversationFilter): Promise<{
    conversations: Conversation[];
    nextCursor?: string;
  }>;
  
  /**
   * Get conversation by ID
   */
  getConversation(conversationId: string): Promise<Conversation | null>;
  
  /**
   * Start 1:1 DM conversation
   */
  startDM(recipient: Address): Promise<Conversation>;
  
  /**
   * Create group conversation
   */
  createGroup(params: CreateGroupParams): Promise<Conversation>;
  
  /**
   * Leave group conversation
   */
  leaveGroup(conversationId: string): Promise<void>;
  
  // ============ Messages ============
  
  /**
   * Get messages in conversation
   */
  getMessages(conversationId: string, options?: {
    limit?: number;
    before?: string;
    after?: string;
  }): Promise<Message[]>;
  
  /**
   * Send message
   */
  send(params: SendMessageParams): Promise<Message>;
  
  /**
   * React to message
   */
  react(messageId: string, emoji: string): Promise<void>;
  
  /**
   * Remove reaction
   */
  unreact(messageId: string, emoji: string): Promise<void>;
  
  // ============ Group Management ============
  
  /**
   * Add members to group
   */
  addMembers(conversationId: string, members: Address[]): Promise<void>;
  
  /**
   * Remove members from group
   */
  removeMembers(conversationId: string, members: Address[]): Promise<void>;
  
  /**
   * Update group metadata
   */
  updateGroup(conversationId: string, metadata: Partial<{
    name: string;
    description: string;
    imageUrl: string;
  }>): Promise<void>;
  
  /**
   * Get group invite link
   */
  getInviteLink(conversationId: string): Promise<string>;
  
  /**
   * Join group via invite link
   */
  joinGroup(inviteLink: string): Promise<Conversation>;
  
  // ============ Consent ============
  
  /**
   * Allow address to message you
   */
  allow(address: Address): Promise<void>;
  
  /**
   * Block address from messaging you
   */
  block(address: Address, reason?: string): Promise<void>;
  
  /**
   * Check if address can message you
   */
  canMessage(address: Address): Promise<boolean>;
  
  /**
   * Check if you can message address
   */
  canMessageTo(address: Address): Promise<boolean>;
  
  /**
   * Get consent state for address
   */
  getConsentState(address: Address): Promise<'allowed' | 'blocked' | 'unknown'>;
  
  /**
   * Get pending message requests
   */
  getMessageRequests(): Promise<Conversation[]>;
  
  // ============ Streaming ============
  
  /**
   * Stream new messages
   */
  streamMessages(conversationId?: string): AsyncGenerator<Message>;
  
  /**
   * Stream all new conversations
   */
  streamConversations(): AsyncGenerator<Conversation>;
  
  // ============ Key Management ============
  
  /**
   * Get public messaging key
   */
  getPublicKey(): Promise<Hex>;
  
  /**
   * Export encrypted backup
   */
  exportBackup(password: string): Promise<string>;
  
  /**
   * Import from backup
   */
  importBackup(backup: string, password: string): Promise<void>;
  
  /**
   * Check if address has messaging enabled
   */
  hasMessagingEnabled(address: Address): Promise<{
    dm: boolean;
    group: boolean;
  }>;
  
  // ============ Node Registry (Advanced) ============
  
  readonly nodes: {
    registerNode(params: RegisterNodeParams): Promise<{ nodeId: Hex; txHash: Hex }>;
    getNode(nodeId: Hex): Promise<MessageNode | null>;
    getMyNodes(): Promise<MessageNode[]>;
    listActiveNodes(): Promise<MessageNode[]>;
    heartbeat(nodeId: Hex): Promise<Hex>;
    claimFees(nodeId: Hex): Promise<Hex>;
    getPendingFees(nodeId: Hex): Promise<bigint>;
  };
  
  // ============ Constants ============
  
  readonly MIN_STAKE: bigint;
  readonly BASE_FEE_PER_MESSAGE: bigint;
}
```

### 2. Implementation

File: `packages/sdk/src/messaging/implementation.ts`

```typescript
import { Client as XMTPClient } from '@xmtp/xmtp-js';
import { JejuMLSClient } from '@jejunetwork/messaging/mls';
import { ConsentClient } from '@jejunetwork/messaging/consent';
import { MessagingClient as JejuMessagingClient } from '@jejunetwork/messaging';

export function createMessagingModule(
  wallet: JejuWallet,
  network: NetworkType,
): MessagingModule {
  let initialized = false;
  let xmtpClient: XMTPClient | null = null;
  let mlsClient: JejuMLSClient | null = null;
  let consentClient: ConsentClient | null = null;
  let jejuClient: JejuMessagingClient | null = null;
  
  const contracts = getContractAddresses(network);
  
  return {
    async initialize() {
      if (initialized) return;
      
      // Initialize XMTP client
      xmtpClient = await XMTPClient.create(wallet, {
        env: network === 'mainnet' ? 'production' : 'dev',
      });
      
      // Initialize MLS client for groups
      mlsClient = new JejuMLSClient({
        wallet,
        relayUrl: contracts.relayUrl,
        keyRegistryAddress: contracts.keyRegistry,
      });
      await mlsClient.initialize();
      
      // Initialize consent client
      consentClient = new ConsentClient({
        registryAddress: contracts.consentRegistry,
        wallet,
        xmtpClient,
        syncToChain: true,
      });
      
      // Initialize Jeju native messaging
      jejuClient = new JejuMessagingClient({
        rpcUrl: contracts.rpcUrl,
        address: wallet.address,
        relayUrl: contracts.relayUrl,
        keyRegistryAddress: contracts.keyRegistry,
      });
      await jejuClient.initialize();
      
      initialized = true;
    },
    
    isInitialized() {
      return initialized;
    },
    
    async listConversations(filter) {
      this.ensureInitialized();
      
      const conversations: Conversation[] = [];
      
      // Get XMTP conversations
      const xmtpConversations = await xmtpClient!.conversations.list();
      
      for (const conv of xmtpConversations) {
        const isGroup = conv.isGroup;
        
        if (filter?.type === 'dm' && isGroup) continue;
        if (filter?.type === 'group' && !isGroup) continue;
        
        conversations.push({
          id: conv.topic,
          type: isGroup ? 'group' : 'dm',
          participants: isGroup 
            ? await conv.members()
            : [conv.peerAddress as Address],
          metadata: isGroup ? {
            name: conv.name,
            description: conv.description,
            imageUrl: conv.imageUrl,
          } : undefined,
          unreadCount: 0, // TODO: Track unread
          createdAt: conv.createdAt.getTime(),
          updatedAt: conv.createdAt.getTime(),
        });
      }
      
      // Apply filter
      if (filter?.participant) {
        conversations = conversations.filter(c =>
          c.participants.includes(filter.participant!)
        );
      }
      
      if (filter?.limit) {
        conversations = conversations.slice(0, filter.limit);
      }
      
      return { conversations };
    },
    
    async getConversation(conversationId) {
      this.ensureInitialized();
      
      const conv = await xmtpClient!.conversations.getConversation(conversationId);
      if (!conv) return null;
      
      return {
        id: conv.topic,
        type: conv.isGroup ? 'group' : 'dm',
        participants: conv.isGroup 
          ? await conv.members()
          : [conv.peerAddress as Address],
        unreadCount: 0,
        createdAt: conv.createdAt.getTime(),
        updatedAt: conv.createdAt.getTime(),
      };
    },
    
    async startDM(recipient) {
      this.ensureInitialized();
      
      // Check consent
      const canMsg = await consentClient!.canMessage(recipient);
      if (!canMsg) {
        // Request consent
        await consentClient!.requestConsent(recipient);
      }
      
      // Create or get existing conversation
      const conv = await xmtpClient!.conversations.newConversation(recipient);
      
      return {
        id: conv.topic,
        type: 'dm',
        participants: [recipient],
        unreadCount: 0,
        createdAt: conv.createdAt.getTime(),
        updatedAt: conv.createdAt.getTime(),
      };
    },
    
    async createGroup(params) {
      this.ensureInitialized();
      
      // Verify all members have messaging enabled
      for (const member of params.members) {
        const hasMessaging = await this.hasMessagingEnabled(member);
        if (!hasMessaging.group) {
          throw new Error(`${member} does not have group messaging enabled`);
        }
      }
      
      // Create MLS group via XMTP
      const conv = await xmtpClient!.conversations.newGroup(params.members, {
        groupName: params.name,
        groupDescription: params.description,
        groupImageUrlSquare: params.imageUrl,
      });
      
      return {
        id: conv.topic,
        type: 'group',
        participants: params.members,
        metadata: {
          name: params.name,
          description: params.description,
          imageUrl: params.imageUrl,
        },
        unreadCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    },
    
    async send(params) {
      this.ensureInitialized();
      
      const conv = await xmtpClient!.conversations.getConversation(params.conversationId);
      if (!conv) throw new Error('Conversation not found');
      
      const sent = await conv.send(params.content);
      
      // Also relay via Jeju for redundancy
      if (jejuClient) {
        await jejuClient.broadcastToConversation(params.conversationId, params.content);
      }
      
      return {
        id: sent.id,
        conversationId: params.conversationId,
        senderId: wallet.address,
        content: params.content,
        contentType: params.contentType ?? 'text',
        timestamp: Date.now(),
        status: 'sent',
      };
    },
    
    async *streamMessages(conversationId) {
      this.ensureInitialized();
      
      let stream;
      if (conversationId) {
        const conv = await xmtpClient!.conversations.getConversation(conversationId);
        if (!conv) throw new Error('Conversation not found');
        stream = await conv.streamMessages();
      } else {
        stream = await xmtpClient!.conversations.streamAllMessages();
      }
      
      for await (const msg of stream) {
        yield {
          id: msg.id,
          conversationId: msg.topic,
          senderId: msg.senderAddress as Address,
          content: msg.content as string,
          contentType: 'text',
          timestamp: msg.sent.getTime(),
          status: 'delivered',
        };
      }
    },
    
    async allow(address) {
      this.ensureInitialized();
      await consentClient!.allow(address);
    },
    
    async block(address, reason) {
      this.ensureInitialized();
      await consentClient!.block(address, reason);
    },
    
    async canMessage(address) {
      this.ensureInitialized();
      return consentClient!.canMessage(address);
    },
    
    async hasMessagingEnabled(address) {
      const [xmtpEnabled, jejuKey] = await Promise.all([
        XMTPClient.canMessage(address, { env: network === 'mainnet' ? 'production' : 'dev' }),
        this.nodes.getKey(address),
      ]);
      
      return {
        dm: xmtpEnabled || jejuKey !== null,
        group: xmtpEnabled,
      };
    },
    
    // Helper
    ensureInitialized() {
      if (!initialized) {
        throw new Error('Messaging not initialized. Call initialize() first.');
      }
    },
    
    // ... node registry methods from existing implementation
  };
}
```

### 3. React Hooks

File: `packages/sdk/src/messaging/react/hooks.ts`

```typescript
import { useCallback, useEffect, useState } from 'react';
import { useJejuClient } from '../../react/hooks/useJejuClient';
import type { Conversation, Message, MessagingModule } from '../index';

export function useMessaging() {
  const client = useJejuClient();
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    if (client && !initialized) {
      setLoading(true);
      client.messaging.initialize()
        .then(() => setInitialized(true))
        .catch(setError)
        .finally(() => setLoading(false));
    }
  }, [client, initialized]);
  
  return {
    messaging: client?.messaging,
    initialized,
    loading,
    error,
  };
}

export function useConversations(filter?: ConversationFilter) {
  const { messaging, initialized } = useMessaging();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  
  useEffect(() => {
    if (initialized && messaging) {
      setLoading(true);
      messaging.listConversations(filter)
        .then(result => setConversations(result.conversations))
        .finally(() => setLoading(false));
    }
  }, [initialized, messaging, JSON.stringify(filter)]);
  
  return { conversations, loading };
}

export function useMessages(conversationId: string) {
  const { messaging, initialized } = useMessaging();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Fetch messages
  useEffect(() => {
    if (initialized && messaging && conversationId) {
      setLoading(true);
      messaging.getMessages(conversationId)
        .then(setMessages)
        .finally(() => setLoading(false));
    }
  }, [initialized, messaging, conversationId]);
  
  // Stream new messages
  useEffect(() => {
    if (initialized && messaging && conversationId) {
      const stream = messaging.streamMessages(conversationId);
      
      (async () => {
        for await (const msg of stream) {
          setMessages(prev => [...prev, msg]);
        }
      })();
      
      return () => {
        // Cleanup stream on unmount
      };
    }
  }, [initialized, messaging, conversationId]);
  
  const send = useCallback(async (content: string) => {
    if (!messaging) throw new Error('Messaging not initialized');
    return messaging.send({ conversationId, content });
  }, [messaging, conversationId]);
  
  return { messages, loading, send };
}

export function useConsent() {
  const { messaging, initialized } = useMessaging();
  
  const allow = useCallback(async (address: Address) => {
    if (!messaging) throw new Error('Messaging not initialized');
    return messaging.allow(address);
  }, [messaging]);
  
  const block = useCallback(async (address: Address, reason?: string) => {
    if (!messaging) throw new Error('Messaging not initialized');
    return messaging.block(address, reason);
  }, [messaging]);
  
  const canMessage = useCallback(async (address: Address) => {
    if (!messaging) return false;
    return messaging.canMessage(address);
  }, [messaging]);
  
  return { allow, block, canMessage, initialized };
}
```

## Acceptance Criteria

- [ ] Unified messaging API works for DMs and groups
- [ ] XMTP integration works for group messaging
- [ ] Consent management integrated
- [ ] Message streaming works
- [ ] React hooks provided
- [ ] Backward compatible with existing code
- [ ] All tests pass

## Output Files

1. `packages/sdk/src/messaging/index.ts`
2. `packages/sdk/src/messaging/implementation.ts`
3. `packages/sdk/src/messaging/react/hooks.ts`
4. `packages/sdk/src/messaging/react/index.ts`

## Testing

```typescript
describe('Messaging Module', () => {
  test('initializes successfully');
  test('starts DM conversation');
  test('creates group with members');
  test('sends and receives messages');
  test('streams new messages');
  test('manages consent');
  test('React hooks work correctly');
});
```

## Commands

```bash
cd packages/sdk

# Run messaging tests
bun test src/messaging/*.test.ts

# Type check
bun run typecheck
```

