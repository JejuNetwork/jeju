/**
 * Route exports for DWS Server
 * All routes are Elysia plugins with type exports for Eden
 */

// ============================================================================
// Static Elysia plugins (already instantiated)
// ============================================================================

export { type A2ARoutes, a2aRoutes } from './a2a'
export { type CDNRoutes, cdnRoutes } from './cdn'
export { type ComputeRoutes, computeRoutes } from './compute'
export { type RLAIFRoutes, rlaifRoutes } from './rlaif'
export { type RPCRoutes, rpcRoutes } from './rpc'
export { type StorageRoutes, storageRoutes } from './storage'
export { type TrainingRoutes, trainingRoutes } from './training'

// ============================================================================
// Elysia route factories (with type exports)
// ============================================================================

// API Marketplace
export {
  type APIMarketplaceRoutes,
  createAPIMarketplaceRouter,
} from './api-marketplace'
// CI/CD
export { type CIRoutes, createCIRouter } from './ci'
// Containers
export { type ContainerRoutes, createContainerRouter } from './containers'
// Data Availability
export { createDARouter, type DARoutes, shutdownDA } from './da'
// Datasets
export { createDatasetsRouter, type DatasetsRoutes } from './datasets'
// Dependency Scanner
export {
  createDependencyScannerRouter,
  type DependencyScannerRoutes,
} from './dependency-scanner'
// Edge Coordination
export { createEdgeRouter, handleEdgeWebSocket } from './edge'
// Funding
export { createFundingRouter } from './funding'
// Git
export { createGitRouter } from './git'
// Key Management Service
export { createKMSRouter, type KMSRoutes } from './kms'
// MCP (Model Context Protocol)
export { createMCPRouter, type MCPRoutes } from './mcp'
// Models
export { createModelsRouter, type ModelsRoutes } from './models'
// Moderation
export { createModerationRouter, type ModerationRoutes } from './moderation'
// OAuth3 proxy
export { createOAuth3Router, type OAuth3Routes } from './oauth3'
// Packages
export { createPkgRouter, type PkgRoutes } from './pkg'
export {
  createPkgRegistryProxyRouter,
  type PkgRegistryProxyRoutes,
} from './pkg-registry-proxy'
// Price Streaming
export {
  createPricesRouter,
  getPriceService,
  handlePriceWebSocket,
  type PricesRoutes,
  type SubscribableWebSocket,
} from './prices'
// RPC (legacy factory export)
export { createRPCRouter } from './rpc'
// S3-compatible storage
export { createS3Router, type S3Routes } from './s3'
// Web Scraping
export { createScrapingRouter, type ScrapingRoutes } from './scraping'
// VPN/Proxy
export { createVPNRouter, type VPNRoutes } from './vpn'
export {
  createDefaultWorkerdRouter,
  createWorkerdRouter,
  type WorkerdRouterOptions,
  type WorkerdRoutes,
} from './workerd'
// Workers
export { createWorkersRouter, type WorkersRoutes } from './workers'
