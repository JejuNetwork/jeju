# Agent Task: XMTP MLS SDK Integration

## Priority: P0
## Estimated Time: 2-3 days
## Dependencies: agent-xmtp-infrastructure

## Objective

Integrate XMTP's MLS SDK into the Jeju messaging package, providing end-to-end encrypted group messaging with forward secrecy and post-compromise security.

## Background

XMTP uses the IETF MLS (Message Layer Security) protocol (RFC 9420) for group encryption. This provides:
- Forward secrecy (past messages stay secure if keys are compromised)
- Post-compromise security (future messages stay secure after recovery)
- Efficient group key management (logarithmic ratcheting)
- Quantum-resistant encryption options

## Source Files to Analyze

- `packages/messaging/src/sdk/client.ts` - Existing client
- `packages/messaging/src/sdk/crypto.ts` - Current X25519 encryption
- `packages/messaging/src/sdk/types.ts` - Type definitions
- `packages/messaging/src/schemas.ts` - Zod schemas

## Implementation Tasks

### 1. MLS Client Wrapper

File: `packages/messaging/src/mls/client.ts`

```typescript
/**
 * MLS Client for Jeju Messaging
 * 
 * Wraps XMTP's MLS implementation with Jeju-specific features:
 * - Identity linked to Jeju wallet address
 * - Key storage in on-chain registry
 * - Transport via Jeju relay nodes
 */

import { Client as XMTPClient, type Signer } from '@xmtp/xmtp-js';
import type { WalletClient } from 'viem';

export interface MLSClientConfig {
  wallet: WalletClient;
  relayUrl: string;
  keyRegistryAddress: Address;
  persistenceEnabled?: boolean;
}

export class JejuMLSClient {
  private xmtpClient: XMTPClient | null = null;
  
  async initialize(): Promise<void> {
    // Create XMTP client with wallet signer
    // Register MLS public key in Jeju KeyRegistry
    // Connect to Jeju relay for transport
  }
  
  async createGroup(members: Address[]): Promise<JejuGroup> {
    // Create MLS group with XMTP
    // Register group in Jeju registry
    // Return wrapped group object
  }
  
  async joinGroup(groupId: string, inviteCode: string): Promise<JejuGroup> {
    // Validate invite
    // Join MLS group
    // Sync group state
  }
  
  async sendMessage(groupId: string, content: string): Promise<void> {
    // Encrypt with MLS
    // Send via Jeju relay
  }
  
  async *streamMessages(): AsyncGenerator<MLSMessage> {
    // Stream decrypted messages from all groups
  }
}
```

### 2. Group Management

File: `packages/messaging/src/mls/group.ts`

```typescript
/**
 * MLS Group Management
 * 
 * Handles group creation, membership, and key rotation.
 */

export interface GroupMetadata {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  createdBy: Address;
  createdAt: number;
  memberCount: number;
}

export class JejuGroup {
  constructor(
    private readonly conversation: Conversation,
    private readonly jejuClient: MessagingClient,
  ) {}
  
  async addMembers(addresses: Address[]): Promise<void> {
    // Verify addresses have messaging keys registered
    // Add to MLS group
    // Notify new members
  }
  
  async removeMembers(addresses: Address[]): Promise<void> {
    // Remove from MLS group (triggers key rotation)
    // Update on-chain membership
  }
  
  async send(content: string, options?: SendOptions): Promise<string> {
    // Encrypt and send via XMTP
    // Also broadcast via Jeju relay for redundancy
  }
  
  async getMessages(options?: FetchOptions): Promise<MLSMessage[]> {
    // Fetch and decrypt messages
  }
  
  async updateMetadata(metadata: Partial<GroupMetadata>): Promise<void> {
    // Update group name, image, etc.
  }
}
```

### 3. Message Types and Schemas

File: `packages/messaging/src/mls/types.ts`

```typescript
import { z } from 'zod';

export const MLSMessageSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  senderId: z.string(),
  senderAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  content: z.string(),
  contentType: z.enum(['text', 'image', 'file', 'reaction', 'reply']),
  timestamp: z.number(),
  replyTo: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type MLSMessage = z.infer<typeof MLSMessageSchema>;

export const GroupInviteSchema = z.object({
  groupId: z.string(),
  inviterAddress: z.string(),
  inviterFid: z.number().optional(),
  groupName: z.string(),
  memberCount: z.number(),
  expiresAt: z.number(),
  code: z.string(),
});

export type GroupInvite = z.infer<typeof GroupInviteSchema>;
```

### 4. Content Types (Rich Messages)

File: `packages/messaging/src/mls/content-types.ts`

```typescript
/**
 * Custom content types for Jeju messaging
 */

export interface ImageContent {
  type: 'image';
  url: string;
  width: number;
  height: number;
  mimeType: string;
  blurhash?: string;
}

export interface FileContent {
  type: 'file';
  url: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface TransactionContent {
  type: 'transaction';
  chainId: number;
  txHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  description?: string;
}

export interface AgentActionContent {
  type: 'agent_action';
  agentId: number;
  action: string;
  params: Record<string, unknown>;
  status: 'pending' | 'completed' | 'failed';
  result?: unknown;
}

// Register custom codecs with XMTP
export function registerJejuContentTypes(client: XMTPClient): void {
  // Register image, file, transaction, agent action codecs
}
```

### 5. Update Existing MessagingClient

File: `packages/messaging/src/sdk/client.ts` (update)

Add MLS support to existing client:

```typescript
export class MessagingClient {
  // ... existing code ...
  
  private mlsClient?: JejuMLSClient;
  
  async enableGroupChat(): Promise<void> {
    this.mlsClient = new JejuMLSClient({
      wallet: this.walletClient,
      relayUrl: this.config.relayUrl,
      keyRegistryAddress: this.config.keyRegistryAddress,
    });
    await this.mlsClient.initialize();
  }
  
  get groups(): JejuMLSClient {
    if (!this.mlsClient) {
      throw new Error('Group chat not enabled. Call enableGroupChat() first.');
    }
    return this.mlsClient;
  }
}
```

## Testing Requirements

File: `packages/messaging/src/tests/mls.test.ts`

```typescript
describe('MLS Integration', () => {
  test('creates XMTP identity from wallet', async () => {
    // Verify identity creation and key registration
  });
  
  test('creates group with multiple members', async () => {
    // Create group, verify all members can decrypt
  });
  
  test('handles member removal with key rotation', async () => {
    // Remove member, verify they lose access to new messages
  });
  
  test('syncs messages across devices', async () => {
    // Same identity on two devices, messages sync
  });
  
  test('supports rich content types', async () => {
    // Send image, file, transaction content
  });
  
  test('handles offline/online transitions', async () => {
    // Go offline, queue messages, sync on reconnect
  });
});
```

## Acceptance Criteria

- [ ] JejuMLSClient initializes with wallet and connects to XMTP
- [ ] Groups can be created with up to 400 members
- [ ] Messages are encrypted end-to-end with MLS
- [ ] Member addition/removal triggers proper key rotation
- [ ] Rich content types (image, file, tx) are supported
- [ ] Messages persist and sync across devices
- [ ] All tests pass

## Output Files

1. `packages/messaging/src/mls/client.ts`
2. `packages/messaging/src/mls/group.ts`
3. `packages/messaging/src/mls/types.ts`
4. `packages/messaging/src/mls/content-types.ts`
5. `packages/messaging/src/mls/index.ts` (barrel export)
6. `packages/messaging/src/tests/mls.test.ts`

## Commands to Run

```bash
cd packages/messaging

# Install XMTP MLS dependencies
bun add @xmtp/xmtp-js @xmtp/content-type-reaction @xmtp/content-type-reply

# Run MLS tests
bun test src/tests/mls.test.ts

# Type check
bun run typecheck
```

