// Types

// Content Cache (Deduplication + Retroactive Enforcement)
export {
  ContentCache,
  type ContentCacheConfig,
  type ContentStatus,
  type ContentStatusType,
  getContentCache,
} from './content-cache'
// Image Processing (Standardization + Hashing)
export {
  getImageProcessor,
  ImageProcessor,
  type ImageProcessorConfig,
  type StandardImage,
} from './image-processor'
// New Unified Ingestion Pipeline (Design Axiom Compliant)
export {
  getIngestionPipeline,
  type IngestionAction,
  IngestionPipeline,
  type IngestionPipelineConfig,
  type IngestionResult,
  type IntakeContext,
  resetIngestionPipeline,
} from './ingestion-pipeline'
// Messaging
export {
  type AuditEntry,
  createMessagingModerationService,
  getMessagingModerationService,
  type MessageEnvelope,
  type MessageScreeningResult,
  type MessagingConfig,
  MessagingModerationService,
  resetMessagingModerationService,
} from './messaging'
// Name Moderation
export {
  canRegisterName,
  moderateName,
  type NameModerationResult,
} from './name-filter'
// On-Chain Moderation Signals (BanManager integration)
export {
  type BanType,
  getOnChainSignalsService,
  type ModerationSignal,
  type OnChainBanRecord,
  type OnChainSignalsConfig,
  OnChainSignalsService,
  resetOnChainSignalsService,
} from './on-chain-signals'
// Persistence
export {
  getContentByPerceptualHash,
  getContentStatus,
  getCSAMReportStats,
  getCSAMReports,
  getEvidenceBundle,
  getMetrics,
  getMetricsSummary,
  getPersistenceMode,
  getQuarantineItem,
  getQuarantineItems,
  getTrustedFlaggerByApiKey,
  getUserReportStats,
  getUserReports,
  getWalletState,
  getWalletsByStatus,
  initializePersistence,
  isPersistenceInitialized,
  listTrustedFlaggers,
  type PersistedMetricEntry,
  saveContentStatus,
  saveCSAMReport,
  saveEvidenceBundle,
  saveMetric,
  // New persistence functions
  saveQuarantineItem,
  saveTrustedFlagger,
  saveUserReport,
  saveWalletState,
  updateCSAMReportStatus,
  updateUserReportStatus,
} from './persistence'
// Pipeline
export {
  ContentModerationPipeline,
  createContentModerationPipeline,
  getContentModerationPipeline,
  NEVER_BYPASS_CATEGORIES,
  type PipelineConfig,
  type ReputationProvider,
  type ReputationTier,
  resetContentModerationPipeline,
} from './pipeline'
// Policy Engine (Deterministic Routing)
export {
  getPolicyEngine,
  type NudityResult,
  PolicyEngine,
  type PolicyEngineConfig,
  type RoutingCase,
  type RoutingDecision,
} from './policy-engine'
export {
  type AWSRekognitionConfig,
  AWSRekognitionProvider,
} from './providers/aws-rekognition'
export {
  CloudflareModerationProvider,
  type CloudflareProviderConfig,
} from './providers/cloudflare'
// CSAM Hash Provider (Authoritative Hash Matching)
export {
  CSAMHashProvider,
  type CSAMHashProviderConfig,
  getCSAMHashProvider,
  type HashMatchResult,
} from './providers/csam-hash'
// Face/Age Detection (Conservative Youth Handling)
export {
  type AgeEstimate,
  FaceAgeProvider,
  type FaceAgeProviderConfig,
  type FaceAgeResult,
  type FaceDetection,
  getFaceAgeProvider,
} from './providers/face-age'
export {
  type HashDatabaseConfig,
  type HashEntry,
  HashModerationProvider,
  type HashProviderConfig,
} from './providers/hash'
export {
  HiveModerationProvider,
  type HiveProviderConfig,
} from './providers/hive'
// Providers
export {
  LocalModerationProvider,
  type LocalProviderConfig,
} from './providers/local'
export {
  getMalwareProvider,
  MalwareProvider,
  type MalwareProviderConfig,
  type MalwareScanResult,
  resetMalwareProvider,
} from './providers/malware'
export {
  getNsfwScore,
  NSFWDetectionProvider,
  type NSFWProviderConfig,
  needsCsamVerification,
} from './providers/nsfw'
export {
  type OpenAIModerationConfig,
  OpenAIModerationProvider,
} from './providers/openai'

// Quarantine Manager (Evidence Preservation)
export {
  type EvidenceBundle,
  getQuarantineManager,
  type QuarantineDecision,
  type QuarantineItem,
  QuarantineManager,
  type QuarantineManagerConfig,
  type QuarantineReason,
  type QuarantineStatus,
} from './quarantine'
// Reporting (NCMEC/IWF)
export {
  type CSAMReport,
  CSAMReportingService,
  DETERRENCE_MESSAGES,
  getAllTrustedFlaggers,
  getTrustedFlagger,
  type IWFConfig,
  type NCMECConfig,
  type ReportingConfig,
  registerTrustedFlagger,
  type TrustedFlagger,
  type UserReport,
} from './reporting'
// Sanctions Screening (OFAC / Chainalysis / Elliptic)
export {
  getSanctionsScreener,
  resetSanctionsScreener,
  type SanctionsCheckResult,
  SanctionsScreener,
  type SanctionsScreenerConfig,
} from './sanctions'
// Transparency
export {
  type ContentActionStats,
  type DetectionStats,
  formatTransparencyReportMarkdown,
  generateTransparencyReport,
  getCurrentMetricsSummary,
  type ResponseTimeStats,
  recordMetric,
  type TransparencyPeriod,
  type TransparencyReport,
} from './transparency'
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
// Upload Gateway with PoW Challenge
export {
  getUploadGateway,
  type PoWChallenge,
  type PoWSolution,
  resetUploadGateway,
  UploadGateway,
  type UploadGatewayConfig,
  type UploadRequest,
  type UploadResult,
} from './upload-gateway'
// Wallet Enforcement (Graduated Response)
export {
  getWalletEnforcementManager,
  type Violation,
  type ViolationType,
  type WalletEnforcementConfig,
  WalletEnforcementManager,
  type WalletEnforcementState,
  type WalletStatus,
} from './wallet-enforcement'
