/**
 * Cross-Chain Messaging Bridge
 *
 * Enables messaging across different L2 chains via Jeju relay infrastructure.
 */

export {
  CrossChainBridgeClient,
  type CrossChainBridgeConfig,
  type CrossChainKeyRegistration,
  type CrossChainMessage,
  createCrossChainBridgeClient,
  getCrossChainBridgeClient,
  type MessageRoute,
  type MessageStatus,
  MessagingChain,
  resetCrossChainBridgeClient,
} from './cross-chain-bridge'
