/**
 * Benchmark Types
 *
 * Type definitions for benchmark data structures and simulation.
 * @packageDocumentation
 */

import type { JsonValue } from '@jejunetwork/types'

/**
 * Volatility bucket for price movements
 * - low: Small price movements (-2% to -4% or +2% to +4%)
 * - medium: Moderate price movements (-5% to -10% or +5% to +10%)
 * - high: Large price movements (-15%+ or +15%+)
 */
export type VolatilityBucket = 'low' | 'medium' | 'high'

/**
 * Event types that can be generated from hidden facts
 */
export type CausalEventType =
  | 'leak'
  | 'rumor'
  | 'scandal'
  | 'development'
  | 'deal'
  | 'announcement'

/**
 * Scheduled event in the causal event schedule
 * Events are scheduled with a base day and hour, plus jitter
 */
export interface ScheduledCausalEvent {
  /** Base day for the event (1-30) */
  baseDay: number
  /** Base hour for the event (0-23) */
  baseHour: number
  /** Jitter applied to the event timing in hours (calculated from seed) */
  jitterHours: number
  /** Type of event */
  eventType: CausalEventType
  /** Volatility bucket for price impact */
  volatilityBucket: VolatilityBucket
  /** Whether the event is positive (true) or negative (false) for affected tickers */
  isPositive: boolean
  /** Description template for the event */
  descriptionTemplate: string
}

/**
 * Hidden narrative fact that drives causal events
 * Each fact has a sequence of events that unfold over time
 */
export interface HiddenNarrativeFact {
  /** Unique identifier for the fact */
  id: string
  /** The hidden fact description (e.g., "TeslAI has a secret battery flaw") */
  fact: string
  /** Tickers affected by this fact */
  affectsTickers: string[]
  /** Sequence of events scheduled to occur based on this fact */
  eventSchedule: ScheduledCausalEvent[]
  /** Overall sentiment of the narrative: negative facts lead to price drops */
  sentiment: 'positive' | 'negative'
}

export interface BenchmarkConfig {
  /** Duration of benchmark in minutes */
  durationMinutes: number

  /** Interval between ticks in seconds */
  tickInterval: number

  /** Number of prediction markets */
  numPredictionMarkets: number

  /** Number of perpetual markets */
  numPerpetualMarkets: number

  /** Number of other simulated agents */
  numAgents: number

  /** Random seed for reproducibility */
  seed?: number

  /**
   * Enable causal simulation mode
   * When true, prices are driven by events from hidden facts instead of random walk
   * Default: false (backward compatible)
   */
  useCausalSimulation?: boolean
}

export interface PredictionMarket {
  id: string
  question: string
  yesShares: number
  noShares: number
  yesPrice: number
  noPrice: number
  totalVolume: number
  liquidity: number
  resolved: boolean
  createdAt: number
  resolveAt: number
}

export interface PerpetualMarket {
  ticker: string
  price: number
  priceChange24h: number
  volume24h: number
  openInterest: number
  fundingRate: number
  nextFundingTime: number
}

export interface SimulatedAgent {
  id: string
  name: string
  reputation: number
  totalPnl: number
}

export interface Post {
  id: string
  authorId: string
  authorName: string
  content: string
  createdAt: number
  likes: number
  comments: number
  marketId?: string
}

export interface GroupChat {
  id: string
  name: string
  memberIds: string[]
  messageCount: number
  lastActivity: number
  invitedAgent?: boolean
  messages?: Array<{
    id: string
    authorId: string
    authorName: string
    content: string
    timestamp: number
  }>
}

export interface BenchmarkGameState {
  tick: number
  timestamp: number
  predictionMarkets: PredictionMarket[]
  perpetualMarkets: PerpetualMarket[]
  agents: SimulatedAgent[]
  posts?: Post[]
  groupChats?: GroupChat[]
}

export interface Tick {
  number: number
  timestamp: number
  events: TickEvent[]
  state: BenchmarkGameState
}

export interface TickEvent {
  type: string
  timestamp: number
  data: Record<string, JsonValue>
}

export interface GroundTruth {
  // =========================================================================
  // REAL DATA - Used for training and evaluation
  // =========================================================================

  /** Known market outcomes (marketId -> boolean) - REAL */
  marketOutcomes: Record<string, boolean>

  /**
   * Historical price data - REAL
   * In causal mode: prices change only at event ticks
   * In random walk mode: prices follow random walk each tick
   */
  priceHistory: Record<
    string,
    Array<{ tick: number; timestamp: number; price: number }>
  >

  /**
   * Hidden narrative facts that drive causal events - REAL (Causal Mode only)
   * Each fact generates a sequence of events that affect specific tickers
   */
  hiddenNarrativeFacts?: HiddenNarrativeFact[]

  /**
   * Causal events with pre-calculated timing and price changes - REAL (Causal Mode only)
   * These events causally drive price movements, creating a learnable signal
   */
  causalEvents?: Array<{
    tick: number
    day: number
    hour: number
    eventType: CausalEventType
    description: string
    affectedTickers: string[]
    volatilityBucket: VolatilityBucket
    isPositive: boolean
    /** Pre-calculated percentage change for each ticker (e.g., -0.07 for -7%) */
    priceChanges: Record<string, number>
    sourceFactId: string
  }>

  // =========================================================================
  // LEGACY/SYNTHETIC DATA - For backward compatibility only
  // These fields contain placeholder values, NOT real ground truth
  // =========================================================================

  /**
   * @deprecated SYNTHETIC placeholder - simple heuristic, not real optimal actions
   */
  optimalActions: Array<{
    tick: number
    type: string
    target: string
    expectedValue: number
    reason: string
  }>

  /**
   * @deprecated SYNTHETIC placeholder - not real social opportunities
   */
  socialOpportunities: Array<{
    tick: number
    type: string
    value: number
    description: string
  }>

  /**
   * @deprecated SYNTHETIC - empty array, never meaningfully implemented
   */
  hiddenFacts: Array<{
    tick: number
    fact: string
    category: 'market' | 'social' | 'event' | 'insider'
    value: JsonValue
  }>

  /**
   * @deprecated SYNTHETIC - empty array, never meaningfully implemented
   */
  hiddenEvents: Array<{
    tick: number
    type: string
    description: string
    impact: Record<string, JsonValue>
  }>

  /** Computed facts from initial state (not synthetic, but not all fields are meaningful) */
  trueFacts: Record<string, JsonValue>
}

export interface BenchmarkGameSnapshot {
  id: string
  version: string
  createdAt: number
  duration: number
  tickInterval: number
  initialState: BenchmarkGameState
  ticks: Tick[]
  groundTruth: GroundTruth
}

/**
 * Agent action recorded during simulation
 */
export interface AgentAction {
  type:
    | 'buy_prediction'
    | 'sell_prediction'
    | 'open_perp'
    | 'close_perp'
    | 'query_state'
    | 'post'
    | 'comment'
    | 'idle'
  timestamp: number
  marketId?: string
  amount?: number
  direction?: 'long' | 'short'
  correctness?: {
    predictionCorrect?: boolean
    pnl?: number
  }
  metadata?: Record<string, unknown>
}

/**
 * Configuration for running a simulation
 */
export interface SimulationConfig {
  /** Duration of the simulation in milliseconds */
  durationMs?: number
  /** Interval between ticks in milliseconds */
  tickIntervalMs?: number
  /** Number of prediction markets to include */
  numPredictionMarkets?: number
  /** Number of perpetual markets to include */
  numPerpMarkets?: number
  /** Random seed for reproducibility */
  seed?: number
  /** Benchmark snapshot to use */
  snapshot?: BenchmarkGameSnapshot
  /** Agent ID for the simulation */
  agentId?: string
  /** Whether to run in fast-forward mode */
  fastForward?: boolean
  /** Response timeout in milliseconds */
  responseTimeout?: number
}

/**
 * Prediction market metrics from simulation
 */
export interface PredictionMetrics {
  totalPositions: number
  correctPredictions: number
  incorrectPredictions: number
  accuracy: number
  avgPnlPerPosition: number
}

/**
 * Perpetual market metrics from simulation
 */
export interface PerpMetrics {
  totalTrades: number
  profitableTrades: number
  winRate: number
  avgPnlPerTrade: number
  maxDrawdown: number
}

/**
 * Social engagement metrics from simulation
 */
export interface SimulationSocialMetrics {
  postsCreated: number
  groupsJoined: number
  messagesReceived: number
  reputationGained: number
}

/**
 * Timing metrics from simulation
 */
export interface TimingMetrics {
  avgResponseTime: number
  maxResponseTime: number
  totalDuration: number
}

/**
 * Complete metrics from a simulation run
 */
export interface SimulationMetrics {
  totalPnl: number
  predictionMetrics: PredictionMetrics
  perpMetrics: PerpMetrics
  socialMetrics: SimulationSocialMetrics
  timing: TimingMetrics
  optimalityScore: number
}

/**
 * Result of a simulation run
 */
export interface SimulationResult {
  /** Unique identifier for the simulation run */
  id: string
  /** Whether the simulation completed successfully */
  success: boolean
  /** Detailed metrics from the run */
  metrics: SimulationMetrics
  /** Error message if simulation failed */
  error?: string
  /** Duration of the simulation in milliseconds */
  durationMs: number
  /** Benchmark ID for comparison */
  benchmarkId?: string
  /** Recorded trajectory steps from the simulation */
  trajectory?: SimulationTrajectoryStep[]
  /** Actions executed during simulation */
  actions: AgentAction[]
}

/**
 * Full simulation state returned by getState()
 */
export interface SimulationEngineState {
  tick: number
  initialized: boolean
  predictionMarkets: SimulationPredictionMarket[]
  perpetualMarkets: SimulationPerpetualMarket[]
  posts?: SimulationFeedPost[]
  groupChats?: SimulationGroupChat[]
  agents: SimulationAgentState[]
}

/**
 * Prediction market in simulation state
 */
export interface SimulationPredictionMarket {
  id: string
  question: string
  yesShares: number
  noShares: number
  yesPrice: number
  noPrice: number
  liquidity: number
  totalVolume: number
  createdAt: number
  resolveAt: number
  resolved: boolean
}

/**
 * Perpetual market in simulation state
 */
export interface SimulationPerpetualMarket {
  ticker: string
  price: number
  priceChange24h?: number
  volume24h: number
  openInterest: number
  fundingRate: number
  nextFundingTime?: number
}

/**
 * Feed post in simulation state
 */
export interface SimulationFeedPost {
  id: string
  authorId: string
  authorName: string
  content: string
  createdAt: number
  likes: number
  comments: number
  marketId?: string
}

/**
 * Group chat in simulation state
 */
export interface SimulationGroupChat {
  id: string
  name: string
  memberIds: string[]
  messageCount: number
  lastActivity: number
  invitedAgent?: boolean
  messages?: Array<{
    id: string
    authorId: string
    authorName: string
    content: string
    timestamp: number
  }>
}

/**
 * Agent in simulation state
 */
export interface SimulationAgentState {
  id: string
  name?: string
  totalPnl?: number
}

/**
 * Trajectory step captured during simulation for RL training
 */
export interface SimulationTrajectoryStep {
  /** Step number in the trajectory */
  stepNumber: number
  /** Timestamp when step occurred */
  timestamp: number
  /** Current tick in simulation */
  tick: number
  /** Observation/state at this step */
  observation: {
    markets: SimulationPredictionMarket[]
    perpMarkets: SimulationPerpetualMarket[]
    portfolio: { balance: number; positions: Array<{ marketId: string; shares: number }> }
    socialFeed?: SimulationFeedPost[]
  }
  /** Action taken by the agent */
  action: AgentAction
  /** Reward received */
  reward: number
  /** Whether episode ended after this step */
  done: boolean
}

/**
 * Model tier classification
 */
export type ModelTier = 'lite' | 'standard' | 'pro'

/**
 * Model provider
 */
export type ModelProvider = 'groq' | 'openai' | 'anthropic' | 'together' | 'local'

/**
 * Model configuration for benchmarking
 */
export interface ModelConfig {
  /** Unique identifier for the model */
  id: string
  /** Display name for reports */
  displayName: string
  /** Provider (groq, openai, anthropic, etc.) */
  provider: ModelProvider
  /** Model identifier for the provider's API */
  modelId: string
  /** Model tier (lite, standard, pro) */
  tier: ModelTier
  /** Approximate parameters in billions */
  parametersBillions?: number
  /** Whether this is a baseline model */
  isBaseline: boolean
  /** Additional metadata */
  metadata?: Record<string, string | number | boolean>
}

/**
 * Minimal interface for agent runtime in benchmarks
 * Any runtime that can process a tick state and return an action
 */
export interface BenchmarkableAgentRuntime {
  /** Process current state and return action to take */
  processTick(state: SimulationEngineState): Promise<AgentAction>
  /** Get agent identifier */
  getAgentId(): string
  /** Optional: Initialize the agent before simulation starts */
  initialize?(): Promise<void>
  /** Optional: Clean up after simulation ends */
  cleanup?(): Promise<void>
}

/**
 * Benchmark run configuration
 */
export interface BenchmarkRunConfig {
  /** Path to benchmark snapshot file (or will generate new one) */
  benchmarkPath?: string
  /** If no snapshot provided, use this config to generate */
  generatorConfig?: BenchmarkConfig
  /** Agent runtime to test */
  agentRuntime: BenchmarkableAgentRuntime
  /** Agent user ID */
  agentUserId: string
  /** Whether to save trajectory data for RL training */
  saveTrajectory: boolean
  /** Output directory for results */
  outputDir: string
  /** Force specific model (bypasses W&B lookup) - for baseline testing */
  forceModel?: string | null
  /** Force a baseline strategy (overrides agent behavior) */
  forceStrategy?: 'random' | 'momentum'
}

/**
 * Benchmark comparison result
 */
export interface BenchmarkComparisonResult {
  /** All individual run results */
  runs: SimulationResult[]
  /** Comparison metrics */
  comparison: {
    avgPnl: number
    avgAccuracy: number
    avgOptimality: number
    bestRun: string
    worstRun: string
  }
  /** Trajectory data (if saved) */
  trajectories?: string[]
}
