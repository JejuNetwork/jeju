/**
 * Benchmark Module
 *
 * Provides infrastructure for deterministic agent benchmarking:
 * - Data generation with reproducible scenarios
 * - Model registry for comparison
 * - Type definitions for simulation state
 *
 * @packageDocumentation
 */

// Data generation
export { BenchmarkDataGenerator } from './data-generator'
// Model registry
export {
  getAllModels,
  getBaselineModels,
  getModelById,
  getModelByModelId,
  getModelDisplayName,
  getModelsByProvider,
  getModelsByTier,
  MODEL_REGISTRY,
  registerModel,
  validateModelId,
} from './model-registry'
// Seeded random number generator
export { SeededRandom } from './seeded-random'
// Core types
export type {
  AgentAction,
  BenchmarkComparisonResult,
  BenchmarkConfig,
  BenchmarkGameSnapshot,
  BenchmarkGameState,
  BenchmarkRunConfig,
  CausalEventType,
  GroundTruth,
  GroupChat,
  HiddenNarrativeFact,
  ModelConfig,
  ModelProvider,
  ModelTier,
  PerpetualMarket,
  PerpMetrics,
  Post,
  PredictionMarket,
  PredictionMetrics,
  ScheduledCausalEvent,
  SimulatedAgent,
  SimulationAgentState,
  SimulationConfig,
  SimulationEngineState,
  SimulationFeedPost,
  SimulationGroupChat,
  SimulationMetrics,
  SimulationPerpetualMarket,
  SimulationPredictionMarket,
  SimulationResult,
  SimulationSocialMetrics,
  Tick,
  TickEvent,
  TimingMetrics,
  VolatilityBucket,
} from './types'
