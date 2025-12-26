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

// Cache
export * from './cache'
// Providers (interface only - implementations are deployed infrastructure)
export * from './providers'
// Types
export * from './types'
// SDK
export * from './sdk'

// App Registry - discovers and manages Jeju app frontends
export * from './app-registry'
// Local CDN Server - serves static assets for devnet
export * from './local-server'
