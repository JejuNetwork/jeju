/**
 * Jeju DWS Distributed Training Module
 *
 * Complete distributed training infrastructure with:
 * - Atropos API server for rollout coordination
 * - Psyche SDK integration for Solana-based distributed training
 * - Cross-chain bridge for Solana ↔ Jeju EVM
 * - GRPO trainer for reinforcement learning
 * - Environment implementations for various training tasks
 */

// Types
export type {
  AtroposState,
  EnvConfig,
  Message,
  RegisterEnv,
  Registration,
  ScoredData,
} from './atropos-server'
// Core components
export * from './atropos-server'
export type {
  BridgeConfig,
  BridgedRunState,
  CheckpointData,
  ClientRegistration,
  RewardDistribution,
} from './cross-chain-bridge'
export * from './cross-chain-bridge'

// Environments
export * from './environments/fundamental-prediction'
export type {
  BatchData,
  TrainingConfig,
  TrainingMetrics as GRPOMetrics,
} from './grpo-trainer'
export * from './grpo-trainer'
export type {
  ClientInfo,
  CoordinatorConfig,
  CoordinatorProgress,
  CoordinatorState,
  Model,
  PsycheConfig,
  RunMetadata,
  TrainingMetrics,
  WitnessProof,
} from './psyche-client'
export * from './psyche-client'
