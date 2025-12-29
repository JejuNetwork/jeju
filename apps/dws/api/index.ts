// Database Services

// CI/CD
export {
  BuildCacheManager,
  type CacheEntry,
  type CacheStats,
  generateCacheKey,
  generateDependencyCacheKey,
  generateDockerLayerCacheKey,
  getBuildCacheManager,
  type RestoreResult,
  restoreCargoCache,
  restoreNodeModules,
  type SaveResult,
  saveCargoCache,
  saveNodeModules,
} from './ci/build-cache'
export {
  WorkflowEngine,
  type WorkflowEngineConfig,
} from './ci/workflow-engine'
export {
  type Backup,
  CreateDatabaseSchema,
  type DatabaseConfig,
  type DatabaseEngine,
  type DatabaseInstance,
  type DatabasePlan,
  type EQLiteConnection,
  getManagedDatabaseService,
  ManagedDatabaseService,
  type PostgresConnection,
  type Replica,
  UpdateDatabaseSchema,
  type UsageMetrics,
} from './database/managed-service'
export { createDatabaseRoutes } from './database/routes'
// Git & Deployments
export {
  configureDeployHook,
  type DeployHookConfig,
  type DeploymentResult,
  detectFramework,
  handlePostReceive,
  hasWorkerCode,
  runDeployHook,
} from './git/deploy-hook'
export {
  CreatePreviewSchema,
  getPreviewManager,
  type PreviewConfig,
  type PreviewDeployment,
  PreviewDeploymentManager,
  type PreviewStatus,
  type PreviewType,
} from './git/preview-deployments'
// Infrastructure
export {
  ClusterAutoscaler,
  getClusterAutoscaler,
  type MetricType,
  type NodePool,
  type NodePoolScalingDecision,
  type ScalingBehavior,
  type ScalingDecision,
  type ScalingDirection,
  type ScalingMetric,
  type ScalingPolicy,
} from './infrastructure/cluster-autoscaler'
export {
  type CircuitBreakerConfig,
  type CircuitState,
  getServiceMesh,
  type LoadBalanceStrategy,
  type RateLimitConfig,
  type RetryPolicy,
  type ServiceDefinition,
  type ServiceEndpoint,
  ServiceMesh,
  type ServiceStatus,
  type TrafficPolicy,
} from './infrastructure/service-mesh'
// Observability
export {
  type Alert,
  AlertManager,
  type AlertRule,
  type AlertSeverity,
  type AlertState,
  getAlertManager,
  getHealthChecker,
  getLogger,
  getMetricsRegistry,
  getTracer,
  HealthChecker,
  type HealthStatus,
  type HistogramValue,
  type LogEntry,
  Logger,
  type LogLevel,
  type LogQuery,
  MetricsRegistry,
  type MetricValue,
  type Span,
  type SpanEvent,
  type SpanKind,
  type SpanStatus,
  type TraceQuery,
  Tracer,
} from './observability'

// Security
export {
  AccessControlManager,
  type AccessDecision,
  type APIKey,
  CreateAPIKeySchema,
  CreateRoleSchema,
  getAccessControl,
  type Organization,
  type Permission,
  type ResourceType,
  type Role,
  type Session,
  type Team,
  type User,
} from './security/access-control'
export {
  type AuditActor,
  type AuditCategory,
  type AuditEvent,
  AuditLogger,
  type AuditOutcome,
  type AuditQuery,
  type AuditSeverity,
  type AuditTarget,
  type ComplianceReport,
  getAuditLogger,
  LogAuditEventSchema,
} from './security/audit-logger'
export {
  type AuditEntry as SecretAuditEntry,
  CreateSecretSchema,
  getSecretsManager,
  type Secret,
  type SecretScope,
  type SecretStatus,
  SecretsManager,
  type SecretValue,
  UpdateSecretSchema,
} from './security/secrets-manager'
export {
  type ACMEAccount,
  type Certificate,
  CertificateRequestSchema,
  type CertificateStatus,
  type ChallengeType,
  CustomCertificateSchema,
  getSSLManager,
  SSLCertificateManager,
} from './security/ssl-manager'
export {
  type DDoSConfig,
  getWAF,
  type IPReputationEntry,
  type RateLimitConfig as WAFRateLimitConfig,
  type SecurityEvent,
  type ThreatType,
  type WAFAction,
  type WAFDecision,
  type WAFRule,
  WebApplicationFirewall,
} from './security/waf'
// Workers & Serverless
export {
  type CronEvent,
  type CronExecution,
  type CronSchedule,
  CronScheduler,
  CronScheduleSchema,
  getCronScheduler,
  getNextRunTime,
  matchesCron,
  parseCronExpression,
  type WorkerResult,
} from './workers/cron-scheduler'
export {
  type CompilationResult,
  type CompiledRoute,
  compileElysia,
  compileNextJS,
  compileProject,
  ElysiaCompiler,
  NextJSCompiler,
  type RouteType,
  type WorkerManifest,
} from './workers/nextjs-compiler'
export {
  ChunkedWriter,
  createChunkedResponse,
  createLLMStreamResponse,
  createNDJSONResponse,
  createSSEResponse,
  getStreamConnectionManager,
  type LLMStreamEvent,
  NDJSONWriter,
  SSEWriter,
  type StreamConfig,
  type StreamConnection,
  StreamConnectionManager,
  type StreamStats,
  streamWithProgress,
} from './workers/streaming'
