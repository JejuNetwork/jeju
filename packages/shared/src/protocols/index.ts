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

// Legacy A2A Server
export {
  type A2AConfig,
  type A2AResult,
  type AgentCard,
  createA2AServer,
} from './a2a'
// Legacy MCP Server
export {
  createMCPServer,
  type MCPConfig,
  type MCPPromptResult,
} from './mcp'
// Protocol Middleware
export {
  type AgentInfo,
  configureERC8004,
  configureProtocolMiddleware,
  configureX402,
  createPaymentRequirement,
  type ERC8004Config,
  erc8004Middleware,
  getAgentInfo,
  type ProtocolMiddlewareConfig,
  parseX402Header,
  verifyX402Payment,
  type X402Config,
  type X402PaymentPayload,
  x402Middleware,
} from './middleware'
// Unified Server (recommended)
export {
  type A2ASkill,
  createServerlessHandler,
  createUnifiedServer,
  type MCPPrompt,
  type MCPResource,
  type MCPTool,
  type PaymentRequirement,
  type ServerInstance,
  type SkillContext,
  type SkillResult,
  skillError,
  skillRequiresPayment,
  skillSuccess,
  startServer,
  type UnifiedServerConfig,
} from './server'
