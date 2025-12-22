/**
 * Training module exports
 */

export {
  type AtroposState,
  createAtroposServer,
  type EnvConfig,
  type Message,
  type RegisterEnv,
  type Registration,
  type ScoredData,
  startAtroposServer,
} from './atropos-server'

export {
  type BridgeConfig,
  type BridgedRunState,
  type CheckpointData,
  type ClientRegistration,
  CrossChainTrainingBridge,
  createCrossChainBridge,
  type RewardDistribution,
} from './cross-chain-bridge'

export {
  createDWSTrainingService,
  createTrainingRoutes,
  DWSTrainingService,
  type NodeAllocation,
  type PsycheJobConfig,
  type TrainingJobRequest,
  type TrainingJobStatus,
} from './dws-integration'

export {
  type BatchData,
  createDistributedGRPOTrainer,
  createGRPOTrainer,
  DistributedGRPOTrainer,
  GRPOTrainer,
  type TrainerStatus,
  type TrainingConfig,
  type TrainingMetrics,
} from './grpo-trainer'

export {
  type ClientInfo,
  type CoordinatorConfig,
  type CoordinatorProgress,
  type CoordinatorState,
  createPsycheClient,
  type Model,
  PsycheClient,
  type PsycheConfig,
  type RunMetadata,
  type WitnessProof,
} from './psyche-client'
