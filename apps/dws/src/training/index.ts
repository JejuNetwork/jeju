/**
 * Jeju DWS Distributed Training Module
 * 
 * Complete distributed training infrastructure with:
 * - Atropos API server for rollout coordination
 * - Psyche SDK integration for Solana-based distributed training
 * - Cross-chain bridge for Solana ↔ Jeju EVM
 * - GRPO trainer with real PyTorch backend
 * - DWS integration for on-demand node provisioning
 * - LLM-as-judge for rollout bundle scoring
 * - Environment implementations for various training tasks
 */

// Core components
export * from './atropos-server';
export * from './psyche-client';
export * from './cross-chain-bridge';
export * from './grpo-trainer';
export * from './dws-integration';

// Environments
export * from './environments/fundamental-prediction';
export * from './environments/tic-tac-toe';

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
  RolloutBundle,
  JudgeScore,
  JudgeResult,
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
  TrainerStatus,
} from './grpo-trainer';

export type {
  TrainingJobRequest,
  TrainingJobStatus,
  NodeAllocation,
  PsycheJobConfig,
} from './dws-integration';
