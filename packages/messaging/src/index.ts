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

// Cross-chain messaging bridge
export {
  CrossChainBridgeClient,
  type CrossChainBridgeConfig,
  type CrossChainKeyRegistration,
  type CrossChainMessage,
  createCrossChainBridgeClient,
  getCrossChainBridgeClient,
  type MessageRoute,
  type MessageStatus as BridgeMessageStatus,
  MessagingChain,
  resetCrossChainBridgeClient,
} from './bridge'
// DC API (relay server)
export { createDCApi, createDCServer } from './farcaster/dc/api'
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
// Farcaster DWS Worker
export {
  createFarcasterWorker,
  type FarcasterWorker,
  type FarcasterWorkerConfig,
} from './farcaster/dws-worker/index.js'
// Farcaster Frames
export {
  createFrameResponse,
  encodeFrameState,
  type FrameButton,
  type FrameErrorResponse,
  type FrameMessage,
  type FrameMetadata,
  type FrameResponse,
  type FrameTransactionParams,
  type FrameTransactionTarget,
  type FrameValidationResult,
  generateFrameMetaTags,
  type JejuAgentFrameState,
  JejuAgentFrameStateSchema,
  type JejuBridgeFrameState,
  JejuBridgeFrameStateSchema,
  type JejuSwapFrameState,
  JejuSwapFrameStateSchema,
  parseFrameState,
} from './farcaster/frames/types'
// Cast building and posting
export {
  CastBuilder,
  type CastBuilderConfig,
  type CastOptions,
  createCast,
  createDeleteCast,
  createReply,
  getTextByteLength,
  type ParsedMention,
  splitTextForThread,
} from './farcaster/hub/cast-builder'
// Farcaster Hub Client (read operations)
export {
  FarcasterClient,
  HubError,
  type HubEvent,
} from './farcaster/hub/client'
export {
  buildMessage,
  type CastAddBody,
  type CastId,
  type CastRemoveBody,
  createCastId,
  type Embed,
  encodeMessageData,
  FarcasterNetwork,
  fromFarcasterTimestamp,
  getFarcasterTimestamp,
  getMessageHashHex,
  HashScheme,
  hashMessageData,
  hexToMessageBytes,
  type LinkBody,
  type Message as FarcasterMessage,
  type MessageData,
  MessageType,
  messageBytesToHex,
  messageToHex,
  type ReactionBody,
  ReactionType,
  SignatureScheme,
  serializeMessage,
  signMessageHash,
  toFarcasterTimestamp,
  type UserDataBody,
  UserDataType,
  type VerificationAddBody,
  verifyMessage as verifyFarcasterMessage,
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
// Farcaster schemas (for validation)
export {
  CastsResponseSchema,
  DCPersistenceDataSchema,
  DCSignerEventsResponseSchema,
  DCUserDataResponseSchema,
  EventsResponseSchema,
  type HubEventBody,
  type HubEventType,
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
} from './farcaster/hub/schemas'
export {
  FailoverHubSubmitter,
  type HubEndpoint,
  type HubInfo,
  HubSubmitter,
  type HubSubmitterConfig,
  type SubmitResult,
  selectBestHub,
} from './farcaster/hub/submitter'
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

// Farcaster Identity
export {
  generateLinkProofMessage,
  type LinkVerificationResult,
  lookupFidByAddress,
  type ParsedLinkProof,
  parseLinkProofMessage,
  verifyAddressCanLink,
  verifyLinkProof,
} from './farcaster/identity/link'
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
  type KeyData,
  KeyState,
  SignerRegistration,
  type SignerRegistrationConfig,
  verifySignerSignature,
} from './farcaster/signer/registration'
export {
  type CreateSignerResult,
  FarcasterSignerService,
  type SignerServiceConfig,
  type SignerWithPoster,
} from './farcaster/signer/service'
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
