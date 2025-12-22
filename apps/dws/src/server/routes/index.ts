/**
 * Route exports for DWS Server
 * All routes are Elysia plugins with type exports for Eden
 */

export { a2aRoutes, type A2ARoutes } from './a2a'
export { cdnRoutes, type CDNRoutes } from './cdn'
export { computeRoutes, type ComputeRoutes } from './compute'
export { storageRoutes, type StorageRoutes } from './storage'

// Legacy Hono routes - to be converted to Elysia
export { createContainerRouter } from './containers'
export { createDARouter, shutdownDA } from './da'
export { createEdgeRouter, handleEdgeWebSocket } from './edge'
export { createFundingRouter } from './funding'
export { createGitRouter } from './git'
export { createKMSRouter } from './kms'
export { createMCPRouter } from './mcp'
export { createModerationRouter } from './moderation'
export { createOAuth3Router } from './oauth3'
export { createPkgRouter } from './pkg'
export { createPkgRegistryProxyRouter } from './pkg-registry-proxy'
export { createPricesRouter, getPriceService, type SubscribableWebSocket } from './prices'
export { createRPCRouter } from './rpc'
export { createS3Router } from './s3'
export { createScrapingRouter } from './scraping'
export { createVPNRouter } from './vpn'
export { createDefaultWorkerdRouter } from './workerd'
export { createWorkersRouter } from './workers'
export { createAPIMarketplaceRouter } from './api-marketplace'
export { createCIRouter } from './ci'
