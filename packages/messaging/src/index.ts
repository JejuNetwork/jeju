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
 * - Real XMTP SDK with KMS-backed signing
 * - End-to-end encryption via MLS
 * - Compatible with all XMTP clients (MetaMask, Coinbase, etc.)
 * - Private keys never leave KMS enclave
 *
 * @example
 * ```typescript
 * // Private messaging via XMTP (see @xmtp/node-sdk)
 * import { Client } from '@xmtp/node-sdk';
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
// KMS-backed Direct Cast Client (secure - keys never in memory)
export {
  createKMSDirectCastClient,
  type DCKMSEncryptionProvider,
  type DCKMSSigner,
  type KMSDCClientConfig,
  KMSDirectCastClient,
} from './farcaster/dc/kms-client'
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
// KMS-backed Farcaster Poster (secure - keys never in memory)
export {
  createKMSPoster,
  KMSFarcasterPoster,
  type KMSPosterConfig,
  type KMSPosterSigner,
  RemoteKMSPosterSigner,
} from './farcaster/hub/kms-poster'
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
// Unified KMS Service for Farcaster (secure - keys never in memory)
export {
  createFarcasterKMSService,
  FarcasterKMSService,
  type FarcasterKMSServiceConfig,
} from './farcaster/kms-service'
// KMS-backed Farcaster Signer (secure - keys never in memory)
export {
  createKMSSignerManager,
  type KMSFarcasterSigner,
  KMSFarcasterSignerManager,
  type KMSProvider,
  type KMSSignerManagerConfig,
  MPCKMSProvider,
  type SignerEvent,
} from './farcaster/signer/kms-manager'
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

// Security utilities
export {
  auditSecurityOperation,
  detectEnvironment,
  type Environment,
  enforceNoKeyExportInProduction,
  enforceNoLocalKeysInProduction,
  enforceNoMockModeInProduction,
  getRecommendedSecurityConfig,
  isLocalKeyOperationAllowed,
  type SecurityAuditEntry,
  type SecurityConfig,
  SecurityViolationError,
  type SecurityViolationType,
  securityAudit,
  validateSecurityConfig,
} from './security'
// Storage adapters
export {
  type ConsistencyLevel,
  createEQLiteStorage,
  type EQLiteConfig,
  EQLiteMessageStorage,
  getEQLiteStorage,
  resetEQLiteStorage,
  type StoredConversation,
  type StoredKeyBundle,
  type StoredMessage,
} from './storage/eqlite-storage'
// TEE-backed key management
export * from './tee'

// ============================================================================
// XMTP - Real SDK Re-exports
// ============================================================================
// Use the official @xmtp/node-sdk directly for XMTP functionality.
// The server's xmtp-messaging.ts service wraps it with KMS signing.
export {
  Client as XMTPClient,
  type ClientOptions as XMTPClientOptions,
  type Signer as XMTPSigner,
  type Dm as XMTPDm,
  type Group as XMTPGroup,
  type DecodedMessage as XMTPDecodedMessage,
  type Conversation as XMTPConversation,
  type Conversations as XMTPConversations,
  ApiUrls as XMTPApiUrls,
} from '@xmtp/node-sdk'
