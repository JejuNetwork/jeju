/**
 * @jejunetwork/messaging
 *
 * Unified messaging protocol for Jeju Network - public and private messaging.
 *
 * ## Public Messaging (Farcaster)
 * - Cast posting and reading via Farcaster Hubs
 * - Direct Casts (encrypted DMs between FIDs)
 * - Signer management
 * - Frames support
 *
 * ## Private Messaging (XMTP)
 * - End-to-end encryption (X25519 + AES-256-GCM)
 * - Decentralized relay network with economic incentives
 * - On-chain key registry for public keys
 * - IPFS storage for message persistence
 * - MLS group messaging
 * - x402 micropayments for message delivery
 *
 * @example
 * ```typescript
 * // Private messaging
 * import { createMessagingClient } from '@jejunetwork/messaging';
 *
 * const client = createMessagingClient({
 *   rpcUrl: 'http://localhost:6546',
 *   address: '0x...',
 *   relayUrl: 'http://localhost:3200',
 * });
 *
 * await client.initialize(signature);
 * await client.sendMessage({ to: '0xRecipient...', content: 'Hello' });
 *
 * // Farcaster public messaging
 * import { FarcasterClient, DirectCastClient } from '@jejunetwork/messaging';
 *
 * const hub = new FarcasterClient({ hubUrl: 'https://hub.farcaster.xyz' });
 * const profile = await hub.getProfile(fid);
 *
 * // Direct Casts (encrypted DMs)
 * const dc = new DirectCastClient({ fid, signerPrivateKey, hubUrl });
 * await dc.send({ recipientFid: 12345, text: 'Hello via DC' });
 * ```
 */

// DWS Worker (decentralized deployment)
export {
  createMessagingWorker,
  type MessagingWorker,
  type MessagingWorkerConfig,
} from './dws-worker/index.js'

// ============================================================================
// FARCASTER - Public/Social Messaging
// ============================================================================

// Farcaster Hub Client (read operations)
export {
  FarcasterClient,
  HubError,
  type HubEvent,
} from './farcaster/hub/client'

// Hub types
export type {
  CastEmbed,
  CastFilter,
  FarcasterCast,
  FarcasterLink,
  FarcasterProfile,
  FarcasterReaction,
  FarcasterVerification,
  HubConfig,
  HubInfoResponse,
  PaginatedResponse,
  UserData,
  UserDataTypeName,
} from './farcaster/hub/types'

// Cast building and posting
export {
  CastBuilder,
  createCast,
  createDeleteCast,
  createReply,
  getTextByteLength,
  type ParsedMention,
  splitTextForThread,
  type CastBuilderConfig,
  type CastOptions,
} from './farcaster/hub/cast-builder'
export {
  buildMessage,
  createCastId,
  encodeMessageData,
  FarcasterNetwork,
  fromFarcasterTimestamp,
  getFarcasterTimestamp,
  getMessageHashHex,
  HashScheme,
  hashMessageData,
  hexToMessageBytes,
  messageBytesToHex,
  MessageType,
  messageToHex,
  ReactionType,
  serializeMessage,
  signMessageHash,
  SignatureScheme,
  toFarcasterTimestamp,
  UserDataType,
  verifyMessage as verifyFarcasterMessage,
  type CastAddBody,
  type CastId,
  type CastRemoveBody,
  type Embed,
  type LinkBody,
  type Message as FarcasterMessage,
  type MessageData,
  type ReactionBody,
  type UserDataBody,
  type VerificationAddBody,
} from './farcaster/hub/message-builder'
export {
  createPoster,
  DEFAULT_HUBS,
  FarcasterPoster,
  type FarcasterPosterConfig,
  type PostedCast,
  type ReactionTarget,
  type UserDataUpdate,
} from './farcaster/hub/poster'
export {
  FailoverHubSubmitter,
  HubSubmitter,
  selectBestHub,
  type HubEndpoint,
  type HubInfo,
  type HubSubmitterConfig,
  type SubmitResult,
} from './farcaster/hub/submitter'

// Farcaster schemas (for validation)
export {
  CastsResponseSchema,
  DCPersistenceDataSchema,
  DCSignerEventsResponseSchema,
  DCUserDataResponseSchema,
  EventsResponseSchema,
  HubInfoResponseSchema,
  LinksResponseSchema,
  type ParsedCastMessage,
  ReactionsResponseSchema,
  SingleCastResponseSchema,
  USER_DATA_TYPE_MAP,
  UserDataResponseSchema,
  UsernameProofResponseSchema,
  VerificationLookupResponseSchema,
  VerificationsResponseSchema,
  type HubEventBody,
  type HubEventType,
} from './farcaster/hub/schemas'

// Direct Casts (encrypted FID-to-FID DMs)
export {
  createDirectCastClient,
  DirectCastClient,
} from './farcaster/dc/client'

export type {
  DCAuthFailedResponse,
  DCAuthMessage,
  DCAuthSuccessResponse,
  DCClientConfig,
  DCClientState,
  DCErrorResponse,
  DCMessageResponse,
  DCNotificationResponse,
  DCNotificationType,
  DCReadMessage,
  DCSendMessage,
  DCSubscribeMessage,
  DCTypingMessage,
  DCWebSocketMessage,
  DCWebSocketResponse,
  DirectCast,
  DirectCastConversation,
  DirectCastEmbed,
  DirectCastNotification,
  EncryptedDirectCast,
  GetMessagesParams as DCGetMessagesParams,
  SendDCParams,
} from './farcaster/dc/types'

// DC API (relay server)
export { createDCApi, createDCServer } from './farcaster/dc/api'

// Farcaster Signer Management
export {
  FarcasterSignerManager,
  type SignerInfo,
  type SignerManagerConfig,
  type SignerStatus,
} from './farcaster/signer/manager'
export {
  FARCASTER_CONTRACTS,
  generateDeadline,
  KeyState,
  type KeyData,
  SignerRegistration,
  type SignerRegistrationConfig,
  verifySignerSignature,
} from './farcaster/signer/registration'
export {
  FarcasterSignerService,
  type CreateSignerResult,
  type SignerServiceConfig,
  type SignerWithPoster,
} from './farcaster/signer/service'

// Farcaster Identity
export {
  generateLinkProofMessage,
  lookupFidByAddress,
  parseLinkProofMessage,
  type LinkVerificationResult,
  type ParsedLinkProof,
  verifyAddressCanLink,
  verifyLinkProof,
} from './farcaster/identity/link'

// Farcaster Frames
export {
  createFrameResponse,
  encodeFrameState,
  generateFrameMetaTags,
  JejuAgentFrameStateSchema,
  JejuBridgeFrameStateSchema,
  JejuSwapFrameStateSchema,
  parseFrameState,
  type FrameButton,
  type FrameErrorResponse,
  type FrameMessage,
  type FrameMetadata,
  type FrameResponse,
  type FrameTransactionParams,
  type FrameTransactionTarget,
  type FrameValidationResult,
  type JejuAgentFrameState,
  type JejuBridgeFrameState,
  type JejuSwapFrameState,
} from './farcaster/frames/types'

// Farcaster DWS Worker
export {
  createFarcasterWorker,
  type FarcasterWorker,
  type FarcasterWorkerConfig,
} from './farcaster/dws-worker/index.js'
// Unified Farcaster-Messaging Integration
export {
  createUnifiedMessagingService,
  type UnifiedConversation,
  type UnifiedMessage,
  type UnifiedMessagingConfig,
  UnifiedMessagingService,
} from './farcaster-integration'
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
// SDK (browser-compatible)
export * from './sdk'
// Storage adapters
export {
  type ConsistencyLevel,
  type CQLConfig,
  CQLMessageStorage,
  createCQLStorage,
  getCQLStorage,
  resetCQLStorage,
  type StoredConversation,
  type StoredKeyBundle,
  type StoredMessage,
} from './storage/cql-storage'
// TEE-backed key management
export * from './tee'
// XMTP node and router (excluding RelayNode)
export {
  createXMTPNode,
  JejuXMTPNode,
  type MessageHandler,
  type NodeConnectionState,
} from './xmtp/node'
// Router (RelayNode renamed to XMTPRelayNode to avoid conflict)
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
