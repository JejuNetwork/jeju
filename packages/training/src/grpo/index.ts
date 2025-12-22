/**
 * GRPO Training Module
 *
 * Group Relative Policy Optimization training infrastructure including:
 * - Atropos API server for rollout coordination
 * - GRPO trainer for reinforcement learning
 * - Distributed training support with Psyche integration
 */

export type { Message, RegisterEnv, Registration, ScoredData } from '../schemas'
export {
  type AtroposState,
  createAtroposServer,
  type EnvConfig,
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
