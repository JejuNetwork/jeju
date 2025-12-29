// Types
export type {
  CategoryScore,
  ContentType,
  HashMatch,
  ModerationAction,
  ModerationCategory,
  ModerationPipelineConfig,
  ModerationProvider,
  ModerationRequest,
  ModerationResult,
  ModerationSeverity,
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
export { NSFWDetectionProvider, type NSFWProviderConfig, needsCsamVerification, getNsfwScore } from './providers/nsfw'
export { OpenAIModerationProvider, type OpenAIModerationConfig } from './providers/openai'
export { HiveModerationProvider, type HiveProviderConfig } from './providers/hive'
export { AWSRekognitionProvider, type AWSRekognitionConfig } from './providers/aws-rekognition'
export { CloudflareModerationProvider, type CloudflareProviderConfig } from './providers/cloudflare'

// Name Moderation
export { canRegisterName, moderateName, type NameModerationResult } from './name-filter'

// Messaging
export {
  createMessagingModerationService,
  getMessagingModerationService,
  MessagingModerationService,
  resetMessagingModerationService,
  type AuditEntry,
  type MessageEnvelope,
  type MessagingConfig,
  type MessageScreeningResult,
} from './messaging'

// Reporting (NCMEC/IWF)
export {
  CSAMReportingService,
  DETERRENCE_MESSAGES,
  registerTrustedFlagger,
  getTrustedFlagger,
  type CSAMReport,
  type NCMECConfig,
  type IWFConfig,
  type ReportingConfig,
  type UserReport,
  type TrustedFlagger,
} from './reporting'

// Transparency
export {
  recordMetric,
  generateTransparencyReport,
  formatTransparencyReportMarkdown,
  getCurrentMetricsSummary,
  type TransparencyReport,
  type TransparencyPeriod,
  type ContentActionStats,
  type DetectionStats,
  type ResponseTimeStats,
} from './transparency'
