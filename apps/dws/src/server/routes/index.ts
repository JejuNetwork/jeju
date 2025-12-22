/**
 * Route exports for DWS Server
 * All routes are Elysia plugins with type exports for Eden
 */

// A2A
export { createA2ARouter } from './a2a'
// API Marketplace
export {
  type APIMarketplaceRoutes,
  createAPIMarketplaceRouter,
} from './api-marketplace'
// CDN
export { createCDNRouter } from './cdn'
// CI/CD
export { type CIRoutes, createCIRouter } from './ci'
// Compute
export { createComputeRouter } from './compute'
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
export { createKMSRouter } from './kms'
// Leaderboard Funding
export { createLeaderboardFundingRouter } from './leaderboard-funding'
// MCP (Model Context Protocol)
export { createMCPRouter } from './mcp'
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
// RLAIF
export { rlaifRoutes } from './rlaif'
// RPC
export { createRPCRouter } from './rpc'
// S3-compatible storage
export { createS3Router, type S3Routes } from './s3'
// Web Scraping
export { createScrapingRouter, type ScrapingRoutes } from './scraping'
// Storage
export { createStorageRouter } from './storage'
// Training
export { trainingRoutes } from './training'
// VPN/Proxy
export { createVPNRouter, type VPNRoutes } from './vpn'
// Workerd
export {
  createDefaultWorkerdRouter,
  createWorkerdRouter,
  type WorkerdRouterOptions,
  type WorkerdRoutes,
} from './workerd'
// Workers
export { createWorkersRouter, type WorkersRoutes } from './workers'
