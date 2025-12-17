/**
 * RLAIF Module for Jeju DWS
 *
 * End-to-end Reinforcement Learning from AI Feedback infrastructure.
 *
 * Features:
 * - RLAIF Coordinator: Orchestrates rollout → judge → train → eval loop
 * - Trajectory Store: CID-first storage for training data
 * - RULER Scorer: LLM-as-judge for trajectory scoring
 * - GRPO/PPO Trainers: RL algorithm implementations
 * - On-chain integration: State management and rewards
 *
 * Compatible with:
 * - Atropos environments
 * - Psyche distributed training
 * - Babylon game environments
 */

export * from './types';
export * from './coordinator';
export * from './trajectory-store';
export * from './ruler-scorer';

