/**
 * Psyche Distributed Training Module
 *
 * Integration with Nous Research's Psyche distributed training network.
 * Handles coordination between Solana-based Psyche network and Jeju's EVM chain.
 */

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
  type ClientInfo,
  type CoordinatorConfig,
  type CoordinatorProgress,
  type CoordinatorState,
  createPsycheClient,
  type Model,
  PsycheClient,
  type PsycheConfig,
  type RunMetadata,
  type TrainingMetrics as PsycheTrainingMetrics,
  type WitnessProof,
} from './psyche-client'
