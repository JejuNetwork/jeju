/**
 * DWS Training Module
 *
 * Provides distributed training infrastructure for Jeju
 */

// Core training components
export { createAtroposServer } from './atropos-server'
export { GRPOTrainer, createGRPOTrainer, createDistributedTrainer } from './grpo-trainer'
export { createDWSTrainingService, NodeProvisioner } from './dws-integration'

// Environment interfaces
export {
  createTicTacToeEnv,
  trajectoryToTrainingFormat,
} from './environments/tic-tac-toe'
export { FundamentalPredictionEnv } from './environments/fundamental-prediction'

// Cross-chain and Psyche integration
export { PsycheClient } from './psyche-client'
export { CrossChainTrainingBridge } from './cross-chain-bridge'

// Types
export type { TrainingConfig, TrainingJobConfig } from './grpo-trainer'
export type { TrainingJob, JobStatus, DWSTrainingService } from './dws-integration'
export type { PsycheConfig, RunState } from './psyche-client'
export type { BridgeConfig, RewardDistribution } from './cross-chain-bridge'

