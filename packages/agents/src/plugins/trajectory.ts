/**
 * Trajectory Logger Plugin
 *
 * Plugin for logging agent trajectories for RLAIF training.
 * Records observations, actions, and rewards for model fine-tuning.
 *
 * @packageDocumentation
 */

import type { Evaluator, Plugin, Provider } from '@elizaos/core'
import { logger } from '@jejunetwork/shared'

/**
 * Trajectory plugin configuration
 */
export interface TrajectoryPluginConfig {
  /** API endpoint for trajectory storage */
  apiEndpoint?: string
  /** Batch size before flushing */
  batchSize?: number
  /** Flush interval in milliseconds */
  flushInterval?: number
  /** Enable real-time streaming */
  enableStreaming?: boolean
}

/**
 * Observation data from the environment
 */
export interface TrajectoryObservation {
  agentBalance?: number
  agentPoints?: number
  marketData?: { marketId: string; price: number }[]
  socialContext?: { recentMessages: number; mentions: number }
  timestamp: Date
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
  id: string
  agentId: string
  timestamp: Date
  observation: TrajectoryObservation
  action: string
  actionParams: TrajectoryActionParams
  result: TrajectoryActionResult
  reward?: number
}

/**
 * Trajectory buffer for batch processing
 */
class TrajectoryBuffer {
  private entries: TrajectoryEntry[] = []
  private batchSize: number
  private apiEndpoint: string

  constructor(batchSize: number = 50, apiEndpoint: string = '') {
    this.batchSize = batchSize
    this.apiEndpoint = apiEndpoint
  }

  add(entry: TrajectoryEntry): void {
    this.entries.push(entry)

    if (this.entries.length >= this.batchSize) {
      void this.flush()
    }
  }

  async flush(): Promise<number> {
    if (this.entries.length === 0) return 0

    const toFlush = [...this.entries]
    this.entries = []

    logger.info(`Flushing ${toFlush.length} trajectories`)

    if (this.apiEndpoint) {
      try {
        await fetch(`${this.apiEndpoint}/trajectories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trajectories: toFlush }),
        })
      } catch (error) {
        logger.error('Failed to upload trajectories', {
          error: error instanceof Error ? error.message : String(error),
        })
        // Re-add on failure
        this.entries.push(...toFlush)
        throw error
      }
    }

    return toFlush.length
  }

  getSize(): number {
    return this.entries.length
  }

  getEntries(): TrajectoryEntry[] {
    return [...this.entries]
  }
}

// Global trajectory buffers per agent
const trajectoryBuffers = new Map<string, TrajectoryBuffer>()

function getTrajectoryBuffer(
  agentId: string,
  config: TrajectoryPluginConfig,
): TrajectoryBuffer {
  let buffer = trajectoryBuffers.get(agentId)
  if (!buffer) {
    buffer = new TrajectoryBuffer(
      config.batchSize ?? 50,
      config.apiEndpoint ?? '',
    )
    trajectoryBuffers.set(agentId, buffer)
  }
  return buffer
}

/**
 * Record a trajectory entry
 */
export function recordTrajectory(
  agentId: string,
  observation: TrajectoryObservation,
  action: string,
  actionParams: TrajectoryActionParams,
  result: TrajectoryActionResult,
  reward?: number,
  config: TrajectoryPluginConfig = {},
): string {
  const entry: TrajectoryEntry = {
    id: `traj-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    agentId,
    timestamp: new Date(),
    observation,
    action,
    actionParams,
    result,
    ...(reward !== undefined && { reward }),
  }

  const buffer = getTrajectoryBuffer(agentId, config)
  buffer.add(entry)

  logger.debug(`Trajectory recorded for agent ${agentId}`, {
    action,
    success: result.success,
    reward: reward ?? null,
  })

  return entry.id
}

/**
 * Calculate reward from action result
 */
export function calculateReward(
  _action: string,
  result: TrajectoryActionResult,
  context: { previousBalance?: number; currentBalance?: number },
): number {
  // Base reward for successful actions
  let reward = result.success ? 0.1 : -0.1

  // Add P&L reward for trading
  if (result.pnl !== undefined) {
    reward +=
      result.pnl > 0
        ? Math.min(result.pnl / 100, 1)
        : Math.max(result.pnl / 100, -1)
  }

  // Balance change reward
  if (
    context.previousBalance !== undefined &&
    context.currentBalance !== undefined
  ) {
    const balanceChange = context.currentBalance - context.previousBalance
    reward += balanceChange > 0 ? 0.05 : balanceChange < 0 ? -0.05 : 0
  }

  return reward
}

/**
 * Trajectory provider - provides trajectory context
 */
const trajectoryProvider: Provider = {
  name: 'trajectory',
  get: async (runtime) => {
    const agentId = runtime.agentId
    const buffer = trajectoryBuffers.get(agentId)
    const pending = buffer?.getSize() ?? 0
    const entries = buffer?.getEntries().slice(-5) ?? []

    let summary = `Trajectory Status:
- Pending entries: ${pending}
- Recording: Active\n\n`

    if (entries.length > 0) {
      summary += 'Recent Trajectories:\n'
      for (const entry of entries) {
        summary += `- ${entry.action}: ${entry.result.success ? 'success' : 'failure'}`
        if (entry.reward !== undefined) {
          summary += ` (reward: ${entry.reward.toFixed(3)})`
        }
        summary += '\n'
      }
    }

    return { text: summary }
  },
}

/**
 * Trajectory logging evaluator - records action outcomes
 */
const trajectoryEvaluator: Evaluator = {
  name: 'TRAJECTORY_LOGGER',
  description: 'Logs agent actions and outcomes for training',
  similes: ['log', 'record', 'track'],
  examples: [],
  validate: async () => true, // Run on all messages
  handler: async (runtime, message, state) => {
    const agentId = runtime.agentId

    // Record basic observation
    const observation: TrajectoryObservation = {
      timestamp: new Date(),
      socialContext: {
        recentMessages:
          (state as { recentMessageCount?: number })?.recentMessageCount ?? 0,
        mentions: 0,
      },
    }

    // Record the interaction as a trajectory
    const text =
      typeof message.content === 'string'
        ? message.content
        : (message.content?.text ?? '')

    recordTrajectory(
      agentId,
      observation,
      'respond',
      { content: text },
      { success: true },
      0.01, // Small positive reward for responding
    )

    return {
      success: true,
      text: 'Trajectory logged',
    }
  },
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
    providers: [trajectoryProvider],
    evaluators: [trajectoryEvaluator],
    // Services would need to be registered as typeof Service classes
    // services: [TrajectoryFlushService],
  }
}

/** Default trajectory plugin */
export const trajectoryPlugin = createTrajectoryPlugin()
