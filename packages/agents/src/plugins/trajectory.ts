/**
 * Trajectory Logger Plugin
 *
 * Plugin for logging agent trajectories for RLAIF training.
 *
 * @packageDocumentation
 */

import type { Plugin } from '@elizaos/core'

/**
 * Trajectory plugin configuration
 */
export interface TrajectoryPluginConfig {
  apiEndpoint?: string
  batchSize?: number
  flushInterval?: number
}

/**
 * Observation data from the environment
 */
export interface TrajectoryObservation {
  agentBalance?: number
  agentPoints?: number
  marketData?: { marketId: string; price: number }[]
  socialContext?: { recentMessages: number; mentions: number }
}

/**
 * Parameters for a trajectory action
 */
export interface TrajectoryActionParams {
  marketId?: string
  amount?: number
  side?: 'buy' | 'sell' | 'long' | 'short'
  content?: string
  recipientId?: string
}

/**
 * Result of a trajectory action
 */
export interface TrajectoryActionResult {
  success: boolean
  pnl?: number
  transactionId?: string
  error?: string
}

/**
 * Trajectory entry
 */
export interface TrajectoryEntry {
  agentId: string
  timestamp: Date
  observation: TrajectoryObservation
  action: string
  actionParams: TrajectoryActionParams
  result: TrajectoryActionResult
  reward?: number
}

/**
 * Create the trajectory logger plugin for ElizaOS
 */
export function createTrajectoryPlugin(
  _config: TrajectoryPluginConfig = {},
): Plugin {
  return {
    name: 'jeju-agent-trajectory',
    description: 'Trajectory logging for RLAIF training',
    actions: [],
    providers: [],
    evaluators: [],
    services: [],
  }
}

/** Default trajectory plugin */
export const trajectoryPlugin = createTrajectoryPlugin()
