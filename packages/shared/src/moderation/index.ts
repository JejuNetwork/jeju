/**
 * Content Moderation System
 *
 * Free speech policy with CSAM detection.
 */

// Types
export type {
  CategoryScore,
  ContentMetadata,
  ContentType,
  HashMatch,
  ModerationAction,
  ModerationAttestation,
  ModerationCategory,
  ModerationEvent,
  ModerationPipelineConfig,
  ModerationProvider,
  ModerationRequest,
  ModerationResult,
  ModerationReviewItem,
  ModerationSeverity,
  ProviderConfig,
} from './types'

// Pipeline
export {
  ContentModerationPipeline,
  createContentModerationPipeline,
  getContentModerationPipeline,
  resetContentModerationPipeline,
  NEVER_BYPASS_CATEGORIES,
  type PipelineConfig,
  type ReputationProvider,
  type ReputationTier,
} from './pipeline'

// Providers
export { LocalModerationProvider, type LocalProviderConfig } from './providers/local'
export { HashModerationProvider, type HashProviderConfig, type HashEntry, type HashDatabaseConfig } from './providers/hash'
export { NSFWDetectionProvider, type NSFWProviderConfig, needsCsamVerification } from './providers/nsfw'
export { OpenAIModerationProvider, type OpenAIModerationConfig } from './providers/openai'
export { HiveModerationProvider, type HiveProviderConfig } from './providers/hive'
export { AWSRekognitionProvider, type AWSRekognitionConfig } from './providers/aws-rekognition'
export { CloudflareModerationProvider, type CloudflareProviderConfig } from './providers/cloudflare'

// Name Moderation
export { canRegisterName, moderateName, type NameModerationResult } from './name-filter'

// Messaging Moderation
export {
  createMessagingModerationService,
  getMessagingModerationService,
  MessagingModerationService,
  resetMessagingModerationService,
  type MessageEnvelope,
  type MessageScreeningResult,
} from './messaging'
