/**
 * Network Messaging SDK
 * 
 * Decentralized private messaging for Network L2
 */

// Client
export { MessagingClient, createMessagingClient } from './client';

// Crypto utilities
export {
  generateKeyPair,
  derivePublicKey,
  generateKeyPairFromSeed,
  encryptMessage,
  decryptMessage,
  decryptMessageToString,
  serializeEncryptedMessage,
  deserializeEncryptedMessage,
  publicKeyToHex,
  hexToPublicKey,
  publicKeyToBytes32,
  bytes32ToPublicKey,
  createMessageEnvelope,
  generateMessageId,
  deriveKeyPairFromWallet,
  publicKeysEqual,
  hashContent,
  KEY_DERIVATION_MESSAGE,
  type KeyPair,
  type EncryptedMessage,
  type SerializedEncryptedMessage,
} from './crypto';

// Types
export {
  type Message,
  type MessageStatus,
  type MessageMetadata,
  type Attachment,
  type Reaction,
  type Chat,
  type ChatType,
  type ChatMetadata,
  type User,
  type RelayNode,
  type NodeInfo,
  type NodePerformance,
  type MessageEnvelope,
  type DeliveryReceipt,
  type SendMessageRequest,
  type SendMessageResponse,
  type GetMessagesRequest,
  type GetMessagesResponse,
  type MessageEvent,
  type MessageEventHandler,
  type MessagingClientConfig,
  type ContractAddresses,
  type KeyBundleResponse,
  type NodeRegistryResponse,
  type WebSocketIncomingMessage,
  type DeliveryReceiptData,
  type ReadReceiptData,
  type MessagingErrorDetails,
  MessagingError,
  ErrorCodes,
} from './types';

// ABIs
export { KEY_REGISTRY_ABI, MESSAGE_NODE_REGISTRY_ABI, ERC20_ABI } from './abis';

