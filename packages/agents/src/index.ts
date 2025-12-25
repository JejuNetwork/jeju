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
export type {
  Agent0Registration,
  AgentCard,
  AgentDiscoveryFilter,
  AgentRegistration,
  ExternalAgentConnectionParams,
  OnChainRegistration,
} from './types/agent-registry'
export {
  AgentStatus,
  AgentType,
  TrustLevel,
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
  type AgentWithConfig,
  agentService,
} from './services/agent.service'
export {
  AgentPnLService,
  type AgentPnLSummary,
  agentPnLService,
} from './services/agent-pnl.service'
export {
  AgentRegistryService,
  agentRegistry,
  type UserAgentRegistrationParams,
} from './services/agent-registry.service'

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
  type A2AMessage as AutonomousA2AMessage,
  type A2AResponse,
  AutonomousA2AService,
  autonomousA2AService,
} from './autonomous/a2a.service'
export {
  AutonomousCommentingService,
  autonomousCommentingService,
  type CommentDecision,
  type CommentResult,
} from './autonomous/commenting.service'
export {
  AutonomousCoordinator,
  type CoordinatorConfig,
  createAutonomousCoordinator,
  type TickResult,
} from './autonomous/coordinator'
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
  type AgentPlan,
  AutonomousPlanningCoordinator,
  autonomousPlanningCoordinator,
  type PlanStep,
} from './autonomous/planning.service'
export {
  AutonomousPostingService,
  autonomousPostingService,
  type PostDecision,
  type PostResult,
} from './autonomous/posting.service'
export {
  AutonomousTradingService,
  autonomousTradingService,
  type TradeDecision,
  type TradeResult,
} from './autonomous/trading.service'

// =============================================================================
// IDENTITY & WALLET
// =============================================================================

export {
  type AgentIdentity,
  AgentIdentityService,
  agentIdentityService,
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
  type InferenceRequest,
  type InferenceResponse,
  LLMInferenceService,
  llmInferenceService,
  runInference,
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
  type ReputationData,
  reputationBridge,
} from './agent0/reputation'

// =============================================================================
// PLUGINS
// =============================================================================

export {
  type AutonomyPluginConfig,
  autonomyPlugin,
  createAutonomyPlugin,
} from './plugins/autonomy'
export {
  type CorePluginConfig,
  corePlugin,
  createCorePlugin,
} from './plugins/core'
export {
  createExperiencePlugin,
  type ExperiencePluginConfig,
  experiencePlugin,
} from './plugins/experience'
export {
  createTrajectoryPlugin,
  type TrajectoryActionParams,
  type TrajectoryActionResult,
  type TrajectoryEntry,
  type TrajectoryObservation,
  type TrajectoryPluginConfig,
  trajectoryPlugin,
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

export {
  AgentRuntimeFactory,
  agentRuntimeFactory,
  type RuntimeCreationOptions,
} from './runtime/factory'
export { AgentRuntimeManager, agentRuntimeManager } from './runtime/manager'

// =============================================================================
// COMMUNICATION
// =============================================================================

export {
  A2ACommunicationClient,
  type A2AMessage,
  type A2AMessageResponse,
  type A2AMessageType,
  type A2APayload,
  createA2AClient,
} from './communication/a2a'

export {
  createMCPClient,
  MCPCommunicationClient,
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
  type PromptSection,
  truncateToTokenLimitSync,
  willPromptFit,
} from './utils/prompt-builder'
