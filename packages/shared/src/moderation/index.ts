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
  getAllTrustedFlaggers,
  type CSAMReport,
  type NCMECConfig,
  type IWFConfig,
  type ReportingConfig,
  type UserReport,
  type TrustedFlagger,
} from './reporting'

// Persistence
export {
  initializePersistence,
  saveCSAMReport,
  updateCSAMReportStatus,
  getCSAMReports,
  getCSAMReportStats,
  saveMetric,
  getMetrics,
  getMetricsSummary,
  saveUserReport,
  getUserReports,
  updateUserReportStatus,
  getUserReportStats,
  saveTrustedFlagger,
  getTrustedFlaggerByApiKey,
  listTrustedFlaggers,
  isPersistenceInitialized,
  getPersistenceMode,
  type PersistedMetricEntry,
} from './persistence'

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

// New Unified Ingestion Pipeline (Design Axiom Compliant)
export {
  IngestionPipeline,
  getIngestionPipeline,
  resetIngestionPipeline,
  type IngestionResult,
  type IngestionAction,
  type IntakeContext,
  type IngestionPipelineConfig,
} from './ingestion-pipeline'

// CSAM Hash Provider (Authoritative Hash Matching)
export {
  CSAMHashProvider,
  getCSAMHashProvider,
  type HashMatchResult,
  type CSAMHashProviderConfig,
} from './providers/csam-hash'

// Face/Age Detection (Conservative Youth Handling)
export {
  FaceAgeProvider,
  getFaceAgeProvider,
  type FaceAgeResult,
  type FaceDetection,
  type AgeEstimate,
  type FaceAgeProviderConfig,
} from './providers/face-age'

// Policy Engine (Deterministic Routing)
export {
  PolicyEngine,
  getPolicyEngine,
  type RoutingDecision,
  type RoutingCase,
  type NudityResult,
  type PolicyEngineConfig,
} from './policy-engine'

// Quarantine Manager (Evidence Preservation)
export {
  QuarantineManager,
  getQuarantineManager,
  type QuarantineItem,
  type QuarantineReason,
  type QuarantineStatus,
  type QuarantineDecision,
  type EvidenceBundle,
  type QuarantineManagerConfig,
} from './quarantine'

// Wallet Enforcement (Graduated Response)
export {
  WalletEnforcementManager,
  getWalletEnforcementManager,
  type WalletStatus,
  type ViolationType,
  type Violation,
  type WalletEnforcementState,
  type WalletEnforcementConfig,
} from './wallet-enforcement'

// Image Processing (Standardization + Hashing)
export {
  ImageProcessor,
  getImageProcessor,
  type StandardImage,
  type ImageProcessorConfig,
} from './image-processor'

// Content Cache (Deduplication + Retroactive Enforcement)
export {
  ContentCache,
  getContentCache,
  type ContentStatus,
  type ContentStatusType,
  type ContentCacheConfig,
} from './content-cache'
