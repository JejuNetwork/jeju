/**
 * Protocol Implementations
 * 
 * A2A and MCP protocol servers and middleware:
 * - Unified Server (recommended)
 * - A2A Server (legacy)
 * - MCP Server (legacy)
 * - ERC-8004 Identity Middleware
 * - x402 Payment Middleware
 */

// Unified Server (recommended)
export {
  createUnifiedServer,
  startServer,
  createServerlessHandler,
  skillSuccess,
  skillError,
  skillRequiresPayment,
  type UnifiedServerConfig,
  type A2ASkill,
  type MCPResource,
  type MCPTool,
  type MCPPrompt,
  type SkillContext,
  type SkillResult,
  type PaymentRequirement,
  type ServerInstance,
} from './server';

// Legacy A2A Server
export {
  createA2AServer,
  type A2AConfig,
  type A2AResult,
  type AgentCard,
} from './a2a';

// Legacy MCP Server
export {
  createMCPServer,
  type MCPConfig,
  type MCPPromptResult,
} from './mcp';

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
  parseX402Header,
  type ERC8004Config,
  type X402Config,
  type ProtocolMiddlewareConfig,
  type AgentInfo,
  type X402PaymentPayload,
} from './middleware';

