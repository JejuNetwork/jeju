/**
 * Protocol Implementations
 *
 * A2A and MCP protocol servers and middleware:
 * - Protocol Server (recommended)
 * - A2A Server
 * - MCP Server
 * - ERC-8004 Identity Middleware
 * - x402 Payment Middleware
 */

// A2A Server
export {
  type A2AConfig,
  type A2AResult,
  type AgentCard,
  createA2AServer,
} from './a2a'
// MCP Server
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
  type PaymentRequirement,
  type ProtocolMiddlewareConfig,
  parseX402Header,
  type SkillResult,
  skillError,
  skillRequiresPayment,
  skillSuccess,
  verifyX402Payment,
  type X402Config,
  type X402PaymentPayload,
  x402Middleware,
} from './middleware'
// Protocol Server (recommended)
export {
  type A2ASkill,
  createServer,
  createServerlessHandler,
  type MCPPrompt,
  type MCPResource,
  type MCPTool,
  type ServerConfig,
  type ServerInstance,
  type SkillContext,
  startServer,
} from './server'
