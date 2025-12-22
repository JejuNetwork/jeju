/**
 * Jeju Training Package
 *
 * Consolidated training infrastructure for the Jeju Network including:
 * - GRPO/PPO training with Atropos coordination
 * - Psyche distributed training integration
 * - Training environments (Tic-Tac-Toe, Financial Prediction)
 * - DWS compute integration
 * - Crucible and Autocrat integrations
 *
 * @packageDocumentation
 */

// ============================================================================
// GRPO Training
// ============================================================================

export {
  type AtroposState,
  type BatchData,
  // Atropos Server
  createAtroposServer,
  // GRPO Trainer
  createDistributedGRPOTrainer,
  createGRPOTrainer,
  DistributedGRPOTrainer,
  type EnvConfig as AtroposEnvConfig,
  GRPOTrainer,
  type Message as AtroposMessage,
  type RegisterEnv,
  type Registration,
  type ScoredData,
  startAtroposServer,
  type TrainerStatus,
  type TrainingConfig,
  type TrainingMetrics,
} from './grpo'

// ============================================================================
// Psyche Distributed Training
// ============================================================================

export {
  type BridgeConfig,
  type BridgedRunState,
  type CheckpointData,
  type ClientInfo,
  type ClientRegistration,
  type CoordinatorConfig,
  type CoordinatorProgress,
  type CoordinatorState,
  CrossChainTrainingBridge,
  // Cross-Chain Bridge
  createCrossChainBridge,
  // Psyche Client
  createPsycheClient,
  type Model,
  PsycheClient,
  type PsycheConfig,
  type PsycheTrainingMetrics,
  type RewardDistribution,
  type RunMetadata,
  type WitnessProof,
} from './psyche'

// ============================================================================
// Training Environments
// ============================================================================

export {
  type APIServerConfig,
  type Board,
  type Cell,
  type Completion,
  type CompletionResult,
  // Fundamental Prediction Environment
  createFundamentalPredictionEnv,
  // Tic-Tac-Toe Environment
  createTicTacToeEnv,
  type FundamentalEnvConfig,
  type FundamentalMessage,
  FundamentalPredictionEnv,
  type GameState,
  type GameStep,
  type GameTrajectory,
  type Move,
  type Player,
  type ScoredDataGroup,
  TicTacToeEnv,
  type TrainingItem,
  trajectoryToTrainingFormat,
} from './environments'

// ============================================================================
// Compute Integration
// ============================================================================

export {
  createDWSClient,
  type DWSClientConfig,
  type DWSJobStatus,
  DWSTrainingClient,
  getDefaultDWSConfig,
  isDWSAvailable,
  type JudgeResult,
  type RolloutData,
  type TrainingJobRequest,
  type TrainingJobResult,
  type TrainingJobStatus,
} from './compute'

// ============================================================================
// Integrations
// ============================================================================

export {
  type AgentTrajectory,
  AutocratTrainingClient,
  CrucibleTrainingClient,
  type CrucibleTrainingMetrics,
  // Autocrat Integration
  createAutocratTrainingClient,
  // Crucible Integration
  createCrucibleTrainingClient,
  type ModelDeploymentProposal,
  type TrainingAgentConfig,
  type TrainingEnvironment,
  type TrainingProposal,
  type TrainingRun,
  type TrajectoryStep,
} from './integrations'

// ============================================================================
// Rubrics Registry
// ============================================================================

export {
  clearRubrics,
  DEFAULT_RUBRIC,
  getAllRubrics,
  getRubric,
  getRubricCount,
  getRubricOrDefault,
  hasRubric,
  type JudgeRubric,
  listRubrics,
  onRubricChange,
  type RubricRegistry,
  registerOrUpdateRubric,
  registerRubric,
  rubricRegistry,
  unregisterRubric,
} from './rubrics'

// ============================================================================
// Validation Schemas
// ============================================================================

export {
  AgentRegistrationResponseSchema,
  AtroposStartResponseSchema,
  BatchResponseSchema,
  CompletionResponseSchema,
  DisconnectEnvSchema,
  DWSJobStatusSchema,
  EnvRegistrationResponseSchema,
  HealthResponseSchema,
  InfoResponseSchema,
  JobAllocationsResponseSchema,
  JobIdResponseSchema,
  JobsListResponseSchema,
  JobsListResponseSchemaExternal,
  JudgeResponseSchema,
  JudgeResultSchema,
  MerkleProofResponseSchema,
  MerkleRootResponseSchema,
  MessageSchema,
  ProposalStatusResponseSchema,
  RegisterEnvSchema,
  RegisterResponseSchema,
  RegistrationSchema,
  RunInfoResponseSchema,
  ScoredDataListResponseSchema,
  ScoredDataListSchema,
  ScoredDataSchema,
  StatusResponseSchema,
  TrainingJobStatusSchema,
} from './schemas'
