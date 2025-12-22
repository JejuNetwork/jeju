/**
 * Network Messaging SDK
 *
 * Decentralized private messaging for Network L2
 */

// ABIs
export { ERC20_ABI, KEY_REGISTRY_ABI, MESSAGE_NODE_REGISTRY_ABI } from './abis'
// Client
export { createMessagingClient, MessagingClient } from './client'
// Crypto utilities
export {
  bytes32ToPublicKey,
  createMessageEnvelope,
  decryptMessage,
  decryptMessageToString,
  deriveKeyPairFromWallet,
  derivePublicKey,
  deserializeEncryptedMessage,
  type EncryptedMessage,
  encryptMessage,
  generateKeyPair,
  generateKeyPairFromSeed,
  generateMessageId,
  hashContent,
  hexToPublicKey,
  KEY_DERIVATION_MESSAGE,
  type KeyPair,
  publicKeysEqual,
  publicKeyToBytes32,
  publicKeyToHex,
  serializeEncryptedMessage,
} from './crypto'
// Types
export {
  type Attachment,
  type Chat,
  type ChatMetadata,
  type ChatType,
  type ContractAddresses,
  type DeliveryReceipt,
  type DeliveryReceiptData,
  ErrorCodes,
  type GetMessagesRequest,
  type GetMessagesResponse,
  type KeyBundleResponse,
  type Message,
  type MessageEnvelope,
  type MessageEvent,
  type MessageEventHandler,
  type MessageMetadata,
  type MessageStatus,
  type MessagingClientConfig,
  MessagingError,
  type MessagingErrorDetails,
  type NodeInfo,
  type NodePerformance,
  type NodeRegistryResponse,
  type Reaction,
  type ReadReceiptData,
  type RelayNode,
  type SendMessageRequest,
  type SendMessageResponse,
  type SerializedEncryptedMessage,
  type User,
  type WebSocketIncomingMessage,
} from './types'
