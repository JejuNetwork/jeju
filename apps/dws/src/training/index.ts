/**
 * DWS Training Module
 *
 * Provides distributed training infrastructure for Jeju
 */

// Core training components
export { createAtroposServer } from './atropos-server'
export type { BridgeConfig, RewardDistribution } from './cross-chain-bridge'
export { CrossChainTrainingBridge } from './cross-chain-bridge'
export type {
  DWSTrainingService,
  JobStatus,
  TrainingJob,
} from './dws-integration'
export { createDWSTrainingService, NodeProvisioner } from './dws-integration'
export { FundamentalPredictionEnv } from './environments/fundamental-prediction'
// Environment interfaces
export {
  createTicTacToeEnv,
  trajectoryToTrainingFormat,
} from './environments/tic-tac-toe'

// Types
export type { TrainingConfig, TrainingJobConfig } from './grpo-trainer'
export {
  createDistributedTrainer,
  createGRPOTrainer,
  GRPOTrainer,
} from './grpo-trainer'
export type { PsycheConfig, RunState } from './psyche-client'
// Cross-chain and Psyche integration
export { PsycheClient } from './psyche-client'
