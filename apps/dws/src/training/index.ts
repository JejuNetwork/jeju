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

// Core components
export * from './atropos-server';
export * from './psyche-client';
export * from './cross-chain-bridge';
export * from './grpo-trainer';

// Environments
export * from './environments/fundamental-prediction';

// Types
export type {
  ScoredData,
  Message,
  Registration,
  RegisterEnv,
  EnvConfig,
  AtroposState,
} from './atropos-server';

export type {
  PsycheConfig,
  RunMetadata,
  CoordinatorConfig,
  Model,
  CoordinatorProgress,
  CoordinatorState,
  ClientInfo,
  WitnessProof,
  TrainingMetrics,
} from './psyche-client';

export type {
  BridgeConfig,
  BridgedRunState,
  ClientRegistration,
  RewardDistribution,
  CheckpointData,
} from './cross-chain-bridge';

export type {
  TrainingConfig,
  BatchData,
  TrainingMetrics as GRPOMetrics,
} from './grpo-trainer';

