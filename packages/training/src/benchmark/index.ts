/**
 * Benchmark Module
 *
 * Provides infrastructure for deterministic agent benchmarking:
 * - Data generation with reproducible scenarios
 * - Model registry for comparison
 * - Simulation engine integration
 * - A2A interface for agent interaction
 *
 * @packageDocumentation
 */

// Core types
export type {
  AgentAction,
  BenchmarkComparisonResult,
  BenchmarkConfig,
  BenchmarkGameSnapshot,
  BenchmarkRunConfig,
  CausalEventType,
  BenchmarkGameState,
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

// Seeded random number generator
export { SeededRandom } from './seeded-random'

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

// Simulation engine
export { SimulationEngine } from './simulation-engine'

// A2A interface
export type {
  A2AMethodParams,
  A2AResponse,
  BuySharesParams,
  BuySharesResult,
  ChatEntry,
  ClosePositionResult,
  CreateCommentResult,
  CreatePostResult,
  DashboardResult,
  JoinGroupResult,
  OpenPositionResult,
  PortfolioPosition,
  PortfolioResult,
  SellSharesResult,
  TrendingTagEntry,
} from './simulation-a2a'
export { SimulationA2AInterface } from './simulation-a2a'
