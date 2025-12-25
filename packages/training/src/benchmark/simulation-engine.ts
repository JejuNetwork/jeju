/**
 * Simulation Engine
 *
 * Type definitions and stub implementation for the simulation engine used in benchmarking.
 * The actual simulation implementation lives elsewhere - these types
 * are used for benchmark result storage and comparison.
 *
 * @packageDocumentation
 */

import type {
  BenchmarkableAgentRuntime,
  SimulationAgentState,
  SimulationConfig,
  SimulationEngineState,
  SimulationResult,
} from './types'

export type {
  SimulationConfig,
  SimulationEngineState,
  SimulationResult,
}

/**
 * Simulation Engine Stub
 *
 * The actual simulation implementation was moved to the game engine.
 * This class provides a type-compatible stub that returns empty results.
 * @deprecated Use game engine simulation instead
 */
export class SimulationEngine {
  private _tickNumber = 0
  private _maxTicks = 100
  private _initialized = false

  constructor(config: SimulationConfig) {
    // Calculate max ticks from config if available
    if (config.durationMs && config.tickIntervalMs) {
      this._maxTicks = Math.ceil(config.durationMs / config.tickIntervalMs)
    }
  }

  /**
   * Initialize the simulation engine
   * @deprecated SimulationEngine is deprecated
   */
  initialize(): void {
    this._initialized = true
    this._tickNumber = 0
  }

  /**
   * Check if simulation is complete
   * @deprecated SimulationEngine is deprecated
   */
  isComplete(): boolean {
    return this._tickNumber >= this._maxTicks
  }

  /**
   * Get current tick number
   * @deprecated SimulationEngine is deprecated
   */
  getCurrentTickNumber(): number {
    return this._tickNumber
  }

  /**
   * Advance to next tick
   * @deprecated SimulationEngine is deprecated
   */
  advanceTick(): void {
    this._tickNumber++
  }

  async run(): Promise<SimulationResult> {
    // Return a stub result with empty metrics
    return {
      id: `stub-${Date.now()}`,
      success: false,
      metrics: {
        totalPnl: 0,
        predictionMetrics: {
          totalPositions: 0,
          correctPredictions: 0,
          incorrectPredictions: 0,
          accuracy: 0,
          avgPnlPerPosition: 0,
        },
        perpMetrics: {
          totalTrades: 0,
          profitableTrades: 0,
          winRate: 0,
          avgPnlPerTrade: 0,
          maxDrawdown: 0,
        },
        socialMetrics: {
          postsCreated: 0,
          groupsJoined: 0,
          messagesReceived: 0,
          reputationGained: 0,
        },
        timing: {
          avgResponseTime: 0,
          maxResponseTime: 0,
          totalDuration: 0,
        },
        optimalityScore: 0,
      },
      error: 'SimulationEngine is deprecated. Use game engine simulation.',
      durationMs: 0,
      actions: [],
    }
  }

  async runWithAgent(_agent: BenchmarkableAgentRuntime): Promise<SimulationResult> {
    return this.run()
  }

  getState(): SimulationEngineState {
    return {
      tick: this._tickNumber,
      initialized: this._initialized,
      predictionMarkets: [],
      perpetualMarkets: [],
      agents: [] as SimulationAgentState[],
    }
  }
}
