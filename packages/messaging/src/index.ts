/**
 * @jejunetwork/messaging
 *
 * Decentralized private messaging protocol for Network L2
 *
 * Features:
 * - End-to-end encryption (X25519 + AES-256-GCM)
 * - Decentralized relay network with economic incentives
 * - On-chain key registry for public keys
 * - IPFS storage for message persistence
 * - x402 micropayments for message delivery
 *
 * @example
 * ```typescript
 * import { createMessagingClient } from '@jejunetwork/messaging';
 *
 * const client = createMessagingClient({
 *   rpcUrl: 'http://localhost:6546',
 *   address: '0x...',
 *   relayUrl: 'http://localhost:3200',
 * });
 *
 * // Initialize with wallet signature
 * const signature = await wallet.signMessage(client.getKeyDerivationMessage());
 * await client.initialize(signature);
 *
 * // Send encrypted message
 * await client.sendMessage({
 *   to: '0xRecipient...',
 *   content: 'Hello, private world!',
 * });
 *
 * // Listen for incoming messages
 * client.onMessage((event) => {
 *   if (event.type === 'message:new') {
 *     console.log('New message:', event.data.content);
 *   }
 * });
 * ```
 *
 * For relay node functionality, import from '@jejunetwork/messaging/node' (Node.js only)
 */

// MLS (Message Layer Security) for group messaging
// Exclude MessageEvent which conflicts with sdk/types
export {
  type AgentActionContent,
  agentAction,
  ContentTypeIds,
  createMLSClient,
  deserializeContent,
  type FetchOptions,
  type FileContent,
  file,
  type GroupConfig,
  type GroupEvent,
  type GroupInvite,
  GroupInviteSchema,
  type GroupMember,
  type GroupMetadata,
  GroupMetadataSchema,
  type GroupState,
  getContentPreview,
  getContentTypeId,
  type ImageContent,
  image,
  isRichContent,
  JejuGroup,
  type JejuGroupConfig,
  JejuMLSClient,
  type MemberEvent,
  type MessageContent,
  // Export MessageEvent from MLS as MLSMessageEvent
  type MessageEvent as MLSMessageEvent,
  type MLSClientConfig,
  type MLSClientEvents,
  type MLSClientState,
  type MLSEvent,
  type MLSEventData,
  type MLSMessage,
  MLSMessageSchema,
  type ReactionContent,
  type ReplyContent,
  reaction,
  reply,
  type SendOptions,
  serializeContent,
  type TextContent,
  type TransactionContent,
  text,
  transaction,
  validateFile,
  validateImage,
  validateTransaction,
} from './mls'
// Re-export SDK (browser-compatible)
export * from './sdk'
// TEE-backed key management
export * from './tee'
// XMTP node and router (excluding RelayNode)
export {
  createXMTPNode,
  JejuXMTPNode,
  type MessageHandler,
  type NodeConnectionState,
} from './xmtp/node'
// Re-export RelayNode from xmtp as XMTPRelayNode to avoid conflict
export {
  createRouter,
  type RelayNode as XMTPRelayNode,
  type RouterStats,
  XMTPMessageRouter,
} from './xmtp/router'
export {
  createSyncService,
  type SyncEvent,
  type SyncPeer,
  type SyncServiceConfig,
  XMTPSyncService,
} from './xmtp/sync'
// XMTP types (excluding RelayNode which conflicts with SDK)
export type {
  ConsentEntry,
  ConsentState,
  ContentType,
  ConversationContext,
  GroupMemberUpdate,
  RouteConfig,
  RouteResult,
  SyncOptions,
  SyncState,
  XMTPConversation,
  XMTPEnvelope,
  XMTPGroup,
  XMTPIdentity,
  XMTPKeyBundle,
  XMTPMessage,
  XMTPNodeConfig,
  XMTPNodeStats,
} from './xmtp/types'

// Node-only exports (relay server) available via '@jejunetwork/messaging/node'
