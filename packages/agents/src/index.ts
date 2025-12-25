/**
 * @jejunetwork/agents - Jeju Agent System
 *
 * This package provides the core agent infrastructure for Jeju Network:
 * - Agent services (creation, management, points)
 * - Autonomous behaviors (trading, posting, commenting, messaging)
 * - Agent identity and wallet management
 * - Plugin system for extending agent capabilities
 * - Agent0 integration for on-chain reputation
 * - LLM routing through decentralized compute
 *
 * @packageDocumentation
 */

// =============================================================================
// TYPES
// =============================================================================

export type {
  AgentConfig,
  AgentLog,
  AgentMessage,
  AgentPerformance,
  AgentPointsTransaction,
  AgentTrade,
  ChatRequest,
  ChatResponse,
  CreateAgentParams,
} from './types/agent-config'

export {
  AgentStatus,
  AgentType,
  TrustLevel,
} from './types/agent-registry'

export type {
  AgentCard,
  AgentDiscoveryFilter,
  Agent0Registration,
  AgentRegistration,
  ExternalAgentConnectionParams,
  OnChainRegistration,
} from './types/agent-registry'

export type { AgentTemplate } from './types/agent-template'

export type {
  AgentConstraints,
  AgentDirective,
  AgentGoal,
  DirectiveType,
  GeneralConstraints,
  GoalTarget,
  SocialConstraints,
  TradingConstraints,
} from './types/goals'

// =============================================================================
// SERVICES
// =============================================================================

export {
  AgentService,
  agentService,
  type AgentWithConfig,
} from './services/agent.service'

export {
  AgentRegistryService,
  agentRegistry,
  type UserAgentRegistrationParams,
} from './services/agent-registry.service'

export {
  AgentPnLService,
  agentPnLService,
  type AgentPnLSummary,
} from './services/agent-pnl.service'

export {
  AgentLockService,
  agentLockService,
  type LockOptions,
  type LockResult,
} from './services/lock.service'

// =============================================================================
// AUTONOMOUS BEHAVIORS
// =============================================================================

export {
  AutonomousCoordinator,
  createAutonomousCoordinator,
  type CoordinatorConfig,
  type TickResult,
} from './autonomous/coordinator'

export {
  AutonomousTradingService,
  autonomousTradingService,
  type TradeDecision,
  type TradeResult,
} from './autonomous/trading.service'

export {
  AutonomousPostingService,
  autonomousPostingService,
  type PostDecision,
  type PostResult,
} from './autonomous/posting.service'

export {
  AutonomousCommentingService,
  autonomousCommentingService,
  type CommentDecision,
  type CommentResult,
} from './autonomous/commenting.service'

export {
  AutonomousDMService,
  autonomousDMService,
  type DMDecision,
  type DMResult,
} from './autonomous/dm.service'

export {
  AutonomousGroupChatService,
  autonomousGroupChatService,
  type GroupChatDecision,
  type GroupChatResult,
} from './autonomous/group-chat.service'

export {
  AutonomousA2AService,
  autonomousA2AService,
  type A2AMessage as AutonomousA2AMessage,
  type A2AResponse,
} from './autonomous/a2a.service'

export {
  AutonomousPlanningCoordinator,
  autonomousPlanningCoordinator,
  type AgentPlan,
  type PlanStep,
} from './autonomous/planning.service'

// =============================================================================
// IDENTITY & WALLET
// =============================================================================

export {
  AgentIdentityService,
  agentIdentityService,
  type AgentIdentity,
  type IdentitySetupOptions,
} from './identity/identity.service'

export {
  AgentWalletService,
  agentWalletService,
  type TransactionResult,
  type WalletBalance,
} from './identity/wallet.service'

// =============================================================================
// LLM ROUTING
// =============================================================================

export {
  LLMInferenceService,
  llmInferenceService,
  runInference,
  type InferenceRequest,
  type InferenceResponse,
} from './llm/inference'

export {
  createJejuProvider,
  type JejuProvider,
  type JejuProviderConfig,
} from './llm/provider'

// =============================================================================
// AGENT0 INTEGRATION
// =============================================================================

export {
  Agent0Client,
  createAgent0Client,
} from './agent0/client'

export {
  AgentDiscoveryService,
  agentDiscoveryService,
  type DiscoveredAgent,
  type DiscoveryFilter,
} from './agent0/discovery'

export {
  ReputationBridge,
  reputationBridge,
  type ReputationData,
} from './agent0/reputation'

// =============================================================================
// PLUGINS
// =============================================================================

export { corePlugin, createCorePlugin, type CorePluginConfig } from './plugins/core'
export { autonomyPlugin, createAutonomyPlugin, type AutonomyPluginConfig } from './plugins/autonomy'
export { experiencePlugin, createExperiencePlugin, type ExperiencePluginConfig } from './plugins/experience'
export {
  trajectoryPlugin,
  createTrajectoryPlugin,
  type TrajectoryActionParams,
  type TrajectoryActionResult,
  type TrajectoryEntry,
  type TrajectoryObservation,
  type TrajectoryPluginConfig,
} from './plugins/trajectory'

// =============================================================================
// RUNNER
// =============================================================================

export {
  AutonomousAgentRunner,
  autonomousAgentRunner,
  type RunnerStatus,
} from './runner/autonomous-runner'

// =============================================================================
// RUNTIME
// =============================================================================

export { AgentRuntimeManager, agentRuntimeManager } from './runtime/manager'

export {
  AgentRuntimeFactory,
  agentRuntimeFactory,
  type RuntimeCreationOptions,
} from './runtime/factory'

// =============================================================================
// COMMUNICATION
// =============================================================================

export {
  A2ACommunicationClient,
  createA2AClient,
  type A2AMessage,
  type A2AMessageResponse,
  type A2AMessageType,
  type A2APayload,
} from './communication/a2a'

export {
  MCPCommunicationClient,
  createMCPClient,
  type MCPResource,
  type MCPTool,
} from './communication/mcp'

// =============================================================================
// TEMPLATES
// =============================================================================

export {
  AGENT_TEMPLATES,
  DEGEN_TEMPLATE,
  getAgentTemplate,
  getAvailableTemplates,
  RESEARCHER_TEMPLATE,
  SOCIAL_BUTTERFLY_TEMPLATE,
  TRADER_TEMPLATE,
} from './templates/archetypes'

export { TemplateLoader, templateLoader } from './templates/loader'

// =============================================================================
// UTILITIES
// =============================================================================

export {
  buildPrompt,
  buildSafePrompt,
  countTokensSync,
  getModelTokenLimit,
  truncateToTokenLimitSync,
  willPromptFit,
  type PromptSection,
} from './utils/prompt-builder'
