/**
 * @packageDocumentation
 * @module @jejunetwork/a2a
 *
 * A2A Protocol Implementation for Jeju Network
 *
 * This package provides the core A2A (Agent-to-Agent) protocol implementation
 * using @a2a-js/sdk. All A2A operations use the standard message/send, tasks/get,
 * and related methods as defined in the A2A Protocol specification.
 *
 * @example
 * ```typescript
 * import {
 *   AgentCardGenerator,
 *   BaseAgentExecutor,
 *   ExtendedTaskStore,
 * } from '@jejunetwork/a2a';
 *
 * // Create agent card generator
 * const cardGenerator = new AgentCardGenerator({
 *   baseUrl: 'https://myplatform.com',
 *   organization: 'My Platform',
 *   organizationUrl: 'https://myplatform.com',
 * });
 *
 * // Generate agent card
 * const agentCard = cardGenerator.generate({
 *   id: 'agent-123',
 *   name: 'My Agent',
 *   description: 'An autonomous agent',
 * });
 * ```
 *
 * @see {@link https://github.com/a2a-js/sdk | A2A SDK Documentation}
 */

export type { RegistryConfig } from './blockchain'
// Blockchain
export { RegistryClient } from './blockchain'
export type {
  BuySharesParams,
  CreatePostParams,
  DiscoverParams,
  ExecutorCommand,
  ExecutorResult,
  GetFeedParams,
  ListTasksParams,
  ListTasksResult,
  OpenPositionParams,
  PaymentRequestParams,
  SearchUsersParams,
  TransferPointsParams,
} from './core'
// Core
export {
  BaseAgentExecutor,
  BuySharesParamsSchema,
  CreatePostParamsSchema,
  DiscoverParamsSchema,
  ExtendedTaskStore,
  GetFeedParamsSchema,
  OpenPositionParamsSchema,
  PaymentRequestParamsSchema,
  SearchUsersParamsSchema,
  TransferPointsParamsSchema,
} from './core'
export type { RedisClient, X402Config } from './payments'
// Payments
export { X402Manager } from './payments'
export type { AgentCardConfig, AgentData, Skill } from './sdk'
// SDK
export {
  AgentCardGenerator,
  createAgentCard,
  DEFAULT_MESSAGING_SKILLS,
  DEFAULT_SOCIAL_SKILLS,
  DEFAULT_TRADING_SKILLS,
} from './sdk'

// Types
export * from './types'
export type {
  ApiKeyAuthConfig,
  AuthRequest,
  AuthResult,
  LogData,
  LogLevel,
} from './utils'
// Utils
export {
  A2A_API_KEY_HEADER,
  getRequiredApiKey,
  isLocalHost,
  Logger,
  logger,
  RateLimiter,
  randomBytesHex,
  validateApiKey,
} from './utils'
