/**
 * Jeju CDN - Decentralized Content Delivery Network
 * 
 * A permissionless CDN that supports:
 * - Deployed infrastructure (CloudFront, Cloudflare via terraform/vendor)
 * - Decentralized edge nodes run by operators
 * - JNS gateway (like eth.link for ENS)
 * 
 * Architecture:
 * - apps/dws/src/cdn: Core edge node and gateway code (no vendor-specific code)
 * - packages/deployment/terraform: CloudFront, WAF, etc. infrastructure
 * - vendor/cloud: Cloud integration pass-through to AWS services
 * 
 * Features:
 * - Vercel-style TTL defaults and cache rules
 * - Geo-based routing to edge nodes
 * - JNS resolution gateway (*.jns.jeju.network)
 * - Cache invalidation and warmup
 * - Usage-based billing with settlements
 * - Integration with ERC-8004 identity
 */

// Types
export * from './types';

// Cache
export * from './cache';

// Providers (interface only - implementations are deployed infrastructure)
export * from './providers';

// Routing
export * from './routing';

// Gateway (JNS resolution like eth.link)
export * from './gateway';

// SDK
export * from './sdk';

// Edge Node Entry Points
export { EdgeNodeServer } from './edge/server';
export { startEdgeNode } from './edge';

// Coordinator Entry Point
export { CDNCoordinator, startCoordinator } from './routing/coordinator';

// JNS Gateway Entry Point
export { JNSGateway, startJNSGateway } from './gateway/jns-gateway';

