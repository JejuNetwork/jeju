/**
 * CDN Module
 * 
 * Integrated CDN functionality for the storage app.
 * 
 * Features:
 * - Edge caching with LRU and Vercel-style TTL
 * - Geo-based routing to edge nodes
 * - JNS gateway (like eth.link for ENS)
 * - Cache invalidation and warmup
 * - Integration with storage backends
 */

// Types
export * from './types';

// Cache
export * from './cache';

// Providers
export * from './providers';

// Routing
export * from './routing';

// Gateway
export * from './gateway';

// SDK
export * from './sdk';

// Edge Node
export { EdgeNodeServer } from './edge/server';
export { startEdgeNode } from './edge';

// Coordinator
export { CDNCoordinator, startCoordinator } from './routing/coordinator';

// JNS Gateway
export { JNSGateway, startJNSGateway } from './gateway/jns-gateway';

