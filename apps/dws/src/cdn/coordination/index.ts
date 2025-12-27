/**
 * CDN Coordination Module
 *
 * Provides libp2p GossipSub-based coordination for decentralized CDN operations:
 * - Global cache invalidation propagation
 * - Hot content replication across regions
 * - Node metrics sharing and health monitoring
 * - Peer discovery and mesh networking
 */

// Cache Integration
export {
  CDNCacheIntegration,
  getCDNCacheIntegration,
  initializeCDNCacheIntegration,
} from './cache-integration'

// GossipSub Coordinator
export {
  CDNGossipCoordinator,
  getCDNCoordinator,
  initializeCDNCoordinator,
  shutdownCDNCoordinator,
} from './gossip-coordinator'
// Types
export {
  type CacheInvalidation,
  type CDNCoordinationConfig,
  type CDNMessage,
  CDNMessageType,
  CDNRegion,
  type CDNTopic,
  CDNTopics,
  type ConnectedNode,
  type ContentReplicate,
  createDefaultCDNCoordinationConfig,
  type HotContent,
  type InvalidationResult,
  type NodeAnnouncement,
  type NodeMetrics,
  type ReplicationResult,
} from './types'
