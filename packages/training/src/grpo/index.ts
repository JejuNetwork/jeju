/**
 * GRPO Training Module
 *
 * Group Relative Policy Optimization training infrastructure including:
 * - Atropos API server for rollout coordination
 * - GRPO trainer for reinforcement learning
 * - Distributed training support with Psyche integration
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
  type BatchData,
  createDistributedGRPOTrainer,
  createGRPOTrainer,
  DistributedGRPOTrainer,
  GRPOTrainer,
  type TrainerStatus,
  type TrainingConfig,
  type TrainingMetrics,
} from './grpo-trainer'
