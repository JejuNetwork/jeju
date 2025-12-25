/**
 * Cross-Chain Messaging Bridge
 *
 * Enables messaging across different L2 chains via Jeju relay infrastructure.
 */

export {
  createCrossChainBridgeClient,
  CrossChainBridgeClient,
  type CrossChainBridgeConfig,
  type CrossChainKeyRegistration,
  type CrossChainMessage,
  getCrossChainBridgeClient,
  type MessageRoute,
  type MessageStatus,
  MessagingChain,
  resetCrossChainBridgeClient,
} from './cross-chain-bridge'
