/**
 * @jeju/dapp-services - Shared Decentralized Services
 * 
 * Provides unified integration layer for all Jeju dApps:
 * - Database (CQL)
 * - Cache (Compute Redis)
 * - Storage (IPFS)
 * - Secrets (KMS)
 * - Triggers (Cron)
 * - Naming (JNS)
 * - Protocols (A2A, MCP, Unified Server)
 * - Middleware (ERC-8004, x402)
 * - Deployment
 */

// Database
export { createDatabaseService, type DatabaseService, type DatabaseConfig } from './database/index.js';

// Cache
export { createCacheService, type CacheService, type CacheConfig, cacheKeys } from './cache/index.js';

// Storage
export { createStorageService, type StorageService, type StorageConfig } from './storage/index.js';

// KMS
export { createKMSService, type KMSServiceClient, type KMSConfig } from './kms/index.js';

// Cron
export { createCronService, type CronService, type CronConfig, type CronJob } from './cron/index.js';

// JNS
export { createJNSService, type JNSService, type JNSConfig, type JNSRecords } from './jns/index.js';

// Legacy Protocol Factories (kept for backwards compatibility)
export { createA2AServer, type A2AConfig, type A2ASkill, type AgentCard } from './protocols/a2a.js';
export { createMCPServer, type MCPConfig, type MCPTool, type MCPResource } from './protocols/mcp.js';

// Unified Protocol Server (recommended)
export {
  createUnifiedServer,
  startServer,
  createServerlessHandler,
  skillSuccess,
  skillError,
  skillRequiresPayment,
  type UnifiedServerConfig,
  type SkillResult,
  type SkillContext,
  type A2ASkill as Skill,
  type MCPResource as Resource,
  type MCPTool as Tool,
  type MCPPrompt as Prompt,
  type PaymentRequirement,
  type ServerInstance,
} from './protocols/server.js';

// Protocol Middleware
export {
  configureERC8004,
  configureX402,
  configureProtocolMiddleware,
  erc8004Middleware,
  x402Middleware,
  getAgentInfo,
  createPaymentRequirement,
  verifyX402Payment,
  type ERC8004Config,
  type X402Config,
  type ProtocolMiddlewareConfig,
  type AgentInfo,
} from './protocols/middleware.js';

// Deployment
export { deployApp, type DeployConfig, type DeployResult } from './deploy/index.js';

// Types
export type { Address, Hex } from 'viem';
