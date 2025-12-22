/**
 * Psyche Distributed Training Module
 *
 * Integration with Nous Research's Psyche distributed training network.
 * Handles coordination between Solana-based Psyche network and Jeju's EVM chain.
 */

export {
  createPsycheClient,
  PsycheClient,
  type ClientInfo,
  type CoordinatorConfig,
  type CoordinatorProgress,
  type CoordinatorState,
  type Model,
  type PsycheConfig,
  type RunMetadata,
  type TrainingMetrics as PsycheTrainingMetrics,
  type WitnessProof,
} from './psyche-client';

export {
  createCrossChainBridge,
  CrossChainTrainingBridge,
  type BridgeConfig,
  type BridgedRunState,
  type CheckpointData,
  type ClientRegistration,
  type RewardDistribution,
} from './cross-chain-bridge';

