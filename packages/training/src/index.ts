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
  // Atropos Server
  createAtroposServer,
  startAtroposServer,
  type AtroposState,
  type EnvConfig as AtroposEnvConfig,
  type Message as AtroposMessage,
  type Registration,
  type RegisterEnv,
  type ScoredData,
  // GRPO Trainer
  createDistributedGRPOTrainer,
  createGRPOTrainer,
  DistributedGRPOTrainer,
  GRPOTrainer,
  type BatchData,
  type TrainerStatus,
  type TrainingConfig,
  type TrainingMetrics,
} from './grpo';

// ============================================================================
// Psyche Distributed Training
// ============================================================================

export {
  // Psyche Client
  createPsycheClient,
  PsycheClient,
  type ClientInfo,
  type CoordinatorConfig,
  type CoordinatorProgress,
  type CoordinatorState,
  type Model,
  type PsycheConfig,
  type PsycheTrainingMetrics,
  type RunMetadata,
  type WitnessProof,
  // Cross-Chain Bridge
  createCrossChainBridge,
  CrossChainTrainingBridge,
  type BridgeConfig,
  type BridgedRunState,
  type CheckpointData,
  type ClientRegistration,
  type RewardDistribution,
} from './psyche';

// ============================================================================
// Training Environments
// ============================================================================

export {
  // Tic-Tac-Toe Environment
  createTicTacToeEnv,
  TicTacToeEnv,
  trajectoryToTrainingFormat,
  type Board,
  type Cell,
  type GameState,
  type GameStep,
  type GameTrajectory,
  type Move,
  type Player,
  // Fundamental Prediction Environment
  createFundamentalPredictionEnv,
  FundamentalPredictionEnv,
  type APIServerConfig,
  type Completion,
  type CompletionResult,
  type FundamentalEnvConfig,
  type FundamentalMessage,
  type ScoredDataGroup,
  type TrainingItem,
} from './environments';

// ============================================================================
// Compute Integration
// ============================================================================

export {
  createDWSClient,
  DWSTrainingClient,
  getDefaultDWSConfig,
  isDWSAvailable,
  type DWSClientConfig,
  type DWSJobStatus,
  type JudgeResult,
  type RolloutData,
  type TrainingJobRequest,
  type TrainingJobResult,
  type TrainingJobStatus,
} from './compute';

// ============================================================================
// Integrations
// ============================================================================

export {
  // Crucible Integration
  createCrucibleTrainingClient,
  CrucibleTrainingClient,
  type AgentTrajectory,
  type CrucibleTrainingMetrics,
  type TrainingAgentConfig,
  type TrainingEnvironment,
  type TrainingRun,
  type TrajectoryStep,
  // Autocrat Integration
  createAutocratTrainingClient,
  AutocratTrainingClient,
  type ModelDeploymentProposal,
  type TrainingProposal,
} from './integrations';

