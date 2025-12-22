# Agent Task: Farcaster Direct Casts via Self-Hosted Hub

## Priority: P1
## Estimated Time: 2 days
## Dependencies: agent-farcaster-hub-posting, agent-farcaster-hubble-deploy

## Objective

Implement Direct Casts (DMs) functionality using a self-hosted Farcaster Hub, enabling private messaging between Farcaster users without relying on Warpcast's centralized DM infrastructure.

## Background

Farcaster Direct Casts are:
- Encrypted messages between users
- Stored off-chain (not in the gossip network)
- Currently centralized via Warpcast

We can implement decentralized DCs by:
- Using the Farcaster message format with DC message type
- Storing in our own infrastructure
- Routing via our Hub network

## Source Files to Analyze

- `packages/farcaster/src/hub/poster.ts` - Message posting
- `packages/messaging/src/sdk/client.ts` - Existing messaging
- Farcaster protocol: DC message types

## Implementation Tasks

### 1. Direct Cast Message Types

File: `packages/farcaster/src/dc/types.ts`

```typescript
/**
 * Direct Cast Message Types
 */

import type { Address, Hex } from 'viem';

export interface DirectCast {
  id: string;
  conversationId: string;
  senderFid: number;
  recipientFid: number;
  text: string;
  embeds?: DirectCastEmbed[];
  replyTo?: string;
  timestamp: number;
  signature: Hex;
}

export interface DirectCastEmbed {
  type: 'url' | 'cast' | 'image';
  url?: string;
  castId?: { fid: number; hash: Hex };
}

export interface DirectCastConversation {
  id: string;
  participants: number[]; // FIDs
  lastMessage?: DirectCast;
  unreadCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DirectCastNotification {
  type: 'new_message' | 'read_receipt' | 'typing';
  conversationId: string;
  senderFid: number;
  timestamp: number;
  messageId?: string;
}
```

### 2. Direct Cast Client

File: `packages/farcaster/src/dc/client.ts`

```typescript
/**
 * Direct Cast Client
 * 
 * Handles sending/receiving encrypted direct messages.
 */

import {
  buildMessage,
  MessageType,
  getFarcasterTimestamp,
  type Message,
} from '../hub/message-builder';
import { MessagingClient } from '@jejunetwork/messaging';
import type { DirectCast, DirectCastConversation } from './types';

// DC message type (not in standard Farcaster - we extend it)
const DC_MESSAGE_TYPE = 14; // Custom type for DCs

export interface DCClientConfig {
  fid: number;
  signerPrivateKey: Uint8Array;
  hubUrl: string;
  messagingClient?: MessagingClient;
}

export class DirectCastClient {
  private fid: number;
  private signerKey: Uint8Array;
  private hubUrl: string;
  private messaging?: MessagingClient;
  
  // Local conversation cache
  private conversations: Map<string, DirectCastConversation> = new Map();
  private messages: Map<string, DirectCast[]> = new Map();
  
  constructor(config: DCClientConfig) {
    this.fid = config.fid;
    this.signerKey = config.signerPrivateKey;
    this.hubUrl = config.hubUrl;
    this.messaging = config.messagingClient;
  }
  
  /**
   * Initialize DC client
   */
  async initialize(): Promise<void> {
    // Connect to messaging relay for DC routing
    if (this.messaging) {
      await this.messaging.initialize();
      
      // Subscribe to DC messages
      this.messaging.on('message', (msg) => {
        if (this.isDirectCast(msg)) {
          this.handleIncomingDC(msg);
        }
      });
    }
    
    // Load existing conversations
    await this.loadConversations();
  }
  
  /**
   * Get all conversations
   */
  async getConversations(): Promise<DirectCastConversation[]> {
    return Array.from(this.conversations.values())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  
  /**
   * Get or create conversation with FID
   */
  async getConversation(recipientFid: number): Promise<DirectCastConversation> {
    const id = this.getConversationId(recipientFid);
    
    let conv = this.conversations.get(id);
    if (!conv) {
      conv = {
        id,
        participants: [this.fid, recipientFid].sort((a, b) => a - b),
        unreadCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.conversations.set(id, conv);
    }
    
    return conv;
  }
  
  /**
   * Get messages in conversation
   */
  async getMessages(
    recipientFid: number,
    options?: { limit?: number; before?: string },
  ): Promise<DirectCast[]> {
    const id = this.getConversationId(recipientFid);
    const messages = this.messages.get(id) ?? [];
    
    let result = messages.sort((a, b) => b.timestamp - a.timestamp);
    
    if (options?.before) {
      const idx = result.findIndex(m => m.id === options.before);
      if (idx >= 0) {
        result = result.slice(idx + 1);
      }
    }
    
    if (options?.limit) {
      result = result.slice(0, options.limit);
    }
    
    return result;
  }
  
  /**
   * Send a direct cast
   */
  async send(params: {
    recipientFid: number;
    text: string;
    embeds?: DirectCastEmbed[];
    replyTo?: string;
  }): Promise<DirectCast> {
    const conversationId = this.getConversationId(params.recipientFid);
    const timestamp = Date.now();
    const id = `${this.fid}-${timestamp}`;
    
    // Get recipient's public key for encryption
    const recipientKey = await this.getRecipientKey(params.recipientFid);
    
    // Encrypt message content
    const encryptedContent = await this.encryptForRecipient(
      params.text,
      recipientKey,
    );
    
    // Build Farcaster message
    const message = await buildMessage(
      {
        type: DC_MESSAGE_TYPE,
        fid: this.fid,
        timestamp: getFarcasterTimestamp(),
        network: 1,
        directCastBody: {
          recipientFid: params.recipientFid,
          encryptedContent,
          embeds: params.embeds,
          replyTo: params.replyTo,
        },
      },
      this.signerKey,
    );
    
    // Send via messaging relay
    if (this.messaging) {
      await this.messaging.send({
        to: await this.fidToAddress(params.recipientFid),
        content: message,
        type: 'direct_cast',
      });
    }
    
    // Store locally
    const dc: DirectCast = {
      id,
      conversationId,
      senderFid: this.fid,
      recipientFid: params.recipientFid,
      text: params.text,
      embeds: params.embeds,
      replyTo: params.replyTo,
      timestamp,
      signature: bytesToHex(message.signature) as Hex,
    };
    
    this.addMessage(dc);
    
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
      
      // Send read receipt
      if (this.messaging) {
        await this.messaging.send({
          to: await this.fidToAddress(recipientFid),
          content: { type: 'read_receipt', conversationId: id },
          type: 'dc_notification',
        });
      }
    }
  }
  
  /**
   * Stream new messages
   */
  async *streamMessages(): AsyncGenerator<DirectCast> {
    if (!this.messaging) {
      throw new Error('Messaging client not initialized');
    }
    
    for await (const msg of this.messaging.stream()) {
      if (this.isDirectCast(msg)) {
        const dc = await this.decryptMessage(msg);
        yield dc;
      }
    }
  }
  
  // ============ Private Methods ============
  
  private getConversationId(otherFid: number): string {
    const fids = [this.fid, otherFid].sort((a, b) => a - b);
    return `dc:${fids[0]}-${fids[1]}`;
  }
  
  private async getRecipientKey(fid: number): Promise<Uint8Array> {
    // Get recipient's XMTP or Jeju messaging public key
    // First check on-chain registry, then fall back to hub
    
    const hubKey = await this.fetchKeyFromHub(fid);
    if (hubKey) return hubKey;
    
    throw new Error(`No encryption key found for FID ${fid}`);
  }
  
  private async fetchKeyFromHub(fid: number): Promise<Uint8Array | null> {
    try {
      const response = await fetch(`${this.hubUrl}/v1/userDataByFid?fid=${fid}`);
      const data = await response.json();
      
      // Look for messaging key in user data
      // This is a convention we establish
      const keyData = data.messages?.find(
        (m: { data: { userDataBody?: { type: number } } }) => 
          m.data.userDataBody?.type === 100 // Custom type for DC key
      );
      
      if (keyData) {
        return hexToBytes(keyData.data.userDataBody.value.slice(2));
      }
      
      return null;
    } catch {
      return null;
    }
  }
  
  private async encryptForRecipient(
    text: string,
    recipientPublicKey: Uint8Array,
  ): Promise<string> {
    // Use X25519 + AES-GCM encryption
    // Same as Jeju messaging crypto
    
    const { ciphertext, nonce, ephemeralPublicKey } = await encrypt(
      new TextEncoder().encode(text),
      recipientPublicKey,
    );
    
    return JSON.stringify({
      ciphertext: bytesToHex(ciphertext),
      nonce: bytesToHex(nonce),
      ephemeralPublicKey: bytesToHex(ephemeralPublicKey),
    });
  }
  
  private async decryptMessage(encryptedDC: unknown): Promise<DirectCast> {
    // Decrypt using our private key
    // Return decrypted DirectCast
    throw new Error('TODO: Implement decryption');
  }
  
  private isDirectCast(msg: unknown): boolean {
    return (msg as { type?: string })?.type === 'direct_cast';
  }
  
  private handleIncomingDC(msg: unknown): void {
    // Process incoming DC, update conversation, emit event
  }
  
  private addMessage(dc: DirectCast): void {
    const messages = this.messages.get(dc.conversationId) ?? [];
    messages.push(dc);
    this.messages.set(dc.conversationId, messages);
    
    // Update conversation
    const conv = this.conversations.get(dc.conversationId);
    if (conv) {
      conv.lastMessage = dc;
      conv.updatedAt = dc.timestamp;
      if (dc.senderFid !== this.fid) {
        conv.unreadCount++;
      }
    }
  }
  
  private async loadConversations(): Promise<void> {
    // Load from persistent storage
  }
  
  private async fidToAddress(fid: number): Promise<Address> {
    // Look up custody address for FID
    throw new Error('TODO: Implement FID to address lookup');
  }
}
```

### 3. DC REST API

File: `packages/farcaster/src/dc/api.ts`

```typescript
/**
 * Direct Cast REST API
 * 
 * HTTP API for DC operations.
 */

import { Hono } from 'hono';
import { DirectCastClient } from './client';
import { z } from 'zod';

const SendDCSchema = z.object({
  recipientFid: z.number(),
  text: z.string().max(1000),
  embeds: z.array(z.object({
    type: z.enum(['url', 'cast', 'image']),
    url: z.string().optional(),
    castId: z.object({
      fid: z.number(),
      hash: z.string(),
    }).optional(),
  })).optional(),
  replyTo: z.string().optional(),
});

export function createDCApi(client: DirectCastClient): Hono {
  const app = new Hono();
  
  // List conversations
  app.get('/conversations', async (c) => {
    const conversations = await client.getConversations();
    return c.json({ conversations });
  });
  
  // Get conversation
  app.get('/conversations/:fid', async (c) => {
    const fid = parseInt(c.req.param('fid'));
    const conversation = await client.getConversation(fid);
    return c.json({ conversation });
  });
  
  // Get messages in conversation
  app.get('/conversations/:fid/messages', async (c) => {
    const fid = parseInt(c.req.param('fid'));
    const limit = parseInt(c.req.query('limit') ?? '50');
    const before = c.req.query('before');
    
    const messages = await client.getMessages(fid, { limit, before });
    return c.json({ messages });
  });
  
  // Send message
  app.post('/conversations/:fid/messages', async (c) => {
    const fid = parseInt(c.req.param('fid'));
    const body = await c.req.json();
    
    const parsed = SendDCSchema.safeParse({ ...body, recipientFid: fid });
    if (!parsed.success) {
      return c.json({ error: parsed.error }, 400);
    }
    
    const message = await client.send(parsed.data);
    return c.json({ message });
  });
  
  // Mark as read
  app.post('/conversations/:fid/read', async (c) => {
    const fid = parseInt(c.req.param('fid'));
    await client.markAsRead(fid);
    return c.json({ success: true });
  });
  
  return app;
}
```

### 4. DC WebSocket Handler

File: `packages/farcaster/src/dc/websocket.ts`

```typescript
/**
 * Direct Cast WebSocket Handler
 * 
 * Real-time DC message delivery.
 */

import type { ServerWebSocket } from 'bun';
import { DirectCastClient } from './client';
import type { DirectCast, DirectCastNotification } from './types';

interface DCWebSocketData {
  fid: number;
  authenticated: boolean;
}

export class DCWebSocketHandler {
  private connections: Map<number, Set<ServerWebSocket<DCWebSocketData>>> = new Map();
  
  constructor(private client: DirectCastClient) {
    // Subscribe to new messages
    this.startMessageStream();
  }
  
  private async startMessageStream(): Promise<void> {
    for await (const message of this.client.streamMessages()) {
      this.broadcast(message.recipientFid, {
        type: 'new_message',
        message,
      });
    }
  }
  
  handleOpen(ws: ServerWebSocket<DCWebSocketData>): void {
    // Wait for authentication
  }
  
  handleMessage(ws: ServerWebSocket<DCWebSocketData>, message: string): void {
    const data = JSON.parse(message);
    
    if (data.type === 'auth') {
      // Verify signature and set FID
      const verified = this.verifyAuth(data.fid, data.signature);
      if (verified) {
        ws.data.fid = data.fid;
        ws.data.authenticated = true;
        this.addConnection(data.fid, ws);
        ws.send(JSON.stringify({ type: 'auth_success' }));
      } else {
        ws.send(JSON.stringify({ type: 'auth_failed' }));
        ws.close();
      }
    } else if (data.type === 'typing') {
      // Broadcast typing indicator
      this.broadcast(data.recipientFid, {
        type: 'typing',
        conversationId: data.conversationId,
        senderFid: ws.data.fid,
        timestamp: Date.now(),
      });
    }
  }
  
  handleClose(ws: ServerWebSocket<DCWebSocketData>): void {
    if (ws.data.fid) {
      this.removeConnection(ws.data.fid, ws);
    }
  }
  
  private addConnection(fid: number, ws: ServerWebSocket<DCWebSocketData>): void {
    if (!this.connections.has(fid)) {
      this.connections.set(fid, new Set());
    }
    this.connections.get(fid)!.add(ws);
  }
  
  private removeConnection(fid: number, ws: ServerWebSocket<DCWebSocketData>): void {
    this.connections.get(fid)?.delete(ws);
  }
  
  private broadcast(fid: number, payload: unknown): void {
    const connections = this.connections.get(fid);
    if (!connections) return;
    
    const message = JSON.stringify(payload);
    for (const ws of connections) {
      ws.send(message);
    }
  }
  
  private verifyAuth(fid: number, signature: string): boolean {
    // Verify Farcaster signature
    return true; // TODO: Implement
  }
}
```

## Acceptance Criteria

- [ ] Can send encrypted DCs between FIDs
- [ ] Messages are stored and retrievable
- [ ] Real-time delivery via WebSocket
- [ ] Read receipts work
- [ ] Typing indicators work
- [ ] Works with self-hosted hub
- [ ] Encryption uses X25519 + AES-GCM

## Output Files

1. `packages/farcaster/src/dc/types.ts`
2. `packages/farcaster/src/dc/client.ts`
3. `packages/farcaster/src/dc/api.ts`
4. `packages/farcaster/src/dc/websocket.ts`
5. `packages/farcaster/src/dc/index.ts`

## Testing

```typescript
describe('DirectCastClient', () => {
  test('creates conversation');
  test('sends encrypted message');
  test('receives and decrypts message');
  test('marks as read');
  test('streams new messages');
});
```

## Commands

```bash
cd packages/farcaster

# Run DC tests
bun test src/dc/*.test.ts

# Start DC server
bun run dev:dc
```

