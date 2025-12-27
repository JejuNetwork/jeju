/**
 * Jeju CDN - Decentralized Content Delivery Network
 *
 * A permissionless CDN that supports:
 * - Deployed infrastructure (CloudFront, Cloudflare via terraform/vendor)
 * - Decentralized edge nodes run by operators
 * - JNS gateway (like eth.link for ENS)
 * - Local devnet serving for all Jeju apps
 *
 * Architecture:
 * - apps/dws/src/cdn: Core edge node and gateway code (no vendor-specific code)
 * - packages/deployment/terraform: CloudFront, WAF, etc. infrastructure
 * - vendor/cloud: Cloud integration pass-through to AWS services
 *
 * Features:
 * - Vercel-style TTL defaults and cache rules
 * - Geo-based routing to edge nodes
 * - JNS resolution gateway (*.jns.jejunetwork.org)
 * - Cache invalidation and warmup
 * - Usage-based billing with settlements
 * - Integration with ERC-8004 identity
 * - App registry for unified frontend serving
 */

// App Registry - discovers and manages Jeju app frontends
export * from './app-registry'
// Cache
export * from './cache'
// Coordination - libp2p GossipSub for global cache coordination
export * from './coordination'
// Local CDN Server - serves static assets for devnet
export * from './local-server'
// P2P - Hybrid CDN with WebTorrent/BitTorrent integration
export * from './p2p'
// Providers (interface only - implementations are deployed infrastructure)
export * from './providers'
// SDK
export * from './sdk'
// Types
export * from './types'
