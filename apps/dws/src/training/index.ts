/**
 * DWS Training Module
 *
 * Provides distributed training infrastructure for Jeju
 */

// Core training components
// Server
export { createAtroposServer, startAtroposServer } from './atropos-server'
export type { BridgeConfig, RewardDistribution } from './cross-chain-bridge'
export {
  CrossChainTrainingBridge,
  createCrossChainBridge,
} from './cross-chain-bridge'
// Types for training routes
export type {
  DWSTrainingService,
  TrainingJobRequest,
  TrainingJobStatus,
} from './dws-integration'
export { createDWSTrainingService } from './dws-integration'
export { FundamentalPredictionEnv } from './environments/fundamental-prediction'
// Environment interfaces
export {
  createTicTacToeEnv,
  trajectoryToTrainingFormat,
} from './environments/tic-tac-toe'
// Types
export type { TrainingConfig } from './grpo-trainer'
export {
  createDistributedGRPOTrainer,
  createGRPOTrainer,
  GRPOTrainer,
} from './grpo-trainer'
export type {
  CoordinatorConfig,
  Model,
  PsycheConfig,
  RolloutBundle,
  RunMetadata,
  RunState,
} from './psyche-client'
// Cross-chain and Psyche integration
export { createPsycheClient, PsycheClient } from './psyche-client'
