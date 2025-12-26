/**
 * P2P Discovery and Coordination
 *
 * Decentralized node discovery using:
 * - Kademlia DHT for node discovery
 * - GossipSub for state propagation
 * - mDNS for local network discovery
 * - Bootstrap nodes for initial peer finding
 *
 * This enables DWS to operate without central coordination servers.
 */

export { type BootstrapConfig, BootstrapManager } from './bootstrap'
export { type P2PConfig, P2PDiscovery, type P2PNode } from './discovery'
export { type GossipConfig, type GossipMessage, GossipProtocol } from './gossip'
export { type PeerInfo, type PeerScore, PeerStore } from './peer-store'
export { createP2PService, type P2PService } from './service'
