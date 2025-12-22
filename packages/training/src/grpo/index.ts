/**
 * GRPO Training Module
 *
 * Group Relative Policy Optimization training infrastructure including:
 * - Atropos API server for rollout coordination
 * - GRPO trainer for reinforcement learning
 * - Distributed training support with Psyche integration
 */

export {
  createAtroposServer,
  startAtroposServer,
  type AtroposState,
  type EnvConfig,
  type Message,
  type Registration,
  type RegisterEnv,
  type ScoredData,
} from './atropos-server';

export {
  createGRPOTrainer,
  createDistributedGRPOTrainer,
  DistributedGRPOTrainer,
  GRPOTrainer,
  type BatchData,
  type TrainerStatus,
  type TrainingConfig,
  type TrainingMetrics,
} from './grpo-trainer';

