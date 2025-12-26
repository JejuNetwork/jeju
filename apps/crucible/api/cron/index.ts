/**
 * Crucible Cron Routes
 *
 * Handles scheduled cron jobs for:
 * - Agent ticks: Execute autonomous agent actions with trajectory recording
 * - Trajectory flushing: Batch flush trajectories to DWS storage
 * - Health checks: System status monitoring
 */

import {
  getStaticTrajectoryStorage,
  type TrajectoryBatchReference,
} from '@jejunetwork/training'
import { Elysia } from 'elysia'
import {
  type AutonomousAgentRunner,
  createAgentRunner,
  type ExtendedAgentConfig,
} from '../autonomous'
import { loadBlueTeamCharacters, loadRedTeamCharacters } from '../characters'
import { createLogger } from '../sdk/logger'

const log = createLogger('CronRoutes')

// Initialize static storage for Crucible trajectories
const crucibleTrajectoryStorage = getStaticTrajectoryStorage('crucible', {
  maxBufferSize: 50,
  maxBufferAgeMs: 10 * 60 * 1000, // 10 minutes
  usePermanentStorage: false, // Use IPFS for raw trajectories
  onBatchFlushed: async (batch: TrajectoryBatchReference) => {
    log.info('Trajectory batch flushed', {
      batchId: batch.batchId,
      cid: batch.storageCid,
      trajectoryCount: batch.trajectoryCount,
      compressedSize: batch.compressedSizeBytes,
    })
  },
})

// Singleton agent runner
let agentRunner: AutonomousAgentRunner | null = null

/**
 * Get or create the agent runner with default agents
 */
async function getAgentRunner(): Promise<AutonomousAgentRunner> {
  if (agentRunner) {
    return agentRunner
  }

  agentRunner = createAgentRunner({
    enableBuiltinCharacters: true,
    defaultTickIntervalMs: 120000, // 2 minutes
    maxConcurrentAgents: 20,
    enableTrajectoryRecording: true,
    onBatchFlushed: async (batch) => {
      log.info('Runner trajectory batch flushed', {
        batchId: batch.batchId,
        cid: batch.storageCid,
      })
    },
  })

  // Register blue team agents
  const blueTeamCharacters = await loadBlueTeamCharacters()
  for (const character of blueTeamCharacters) {
    const agentConfig: ExtendedAgentConfig = {
      agentId: `blue-${character.name.toLowerCase().replace(/\s+/g, '-')}`,
      character,
      tickIntervalMs: 120000,
      capabilities: {
        canTrade: false,
        canChat: true,
        canPropose: true,
        canVote: true,
        canDelegate: true,
        canStake: true,
        canBridge: false,
        a2a: true,
        compute: true,
      },
      maxActionsPerTick: 3,
      enabled: true,
      archetype: 'blue-team',
      recordTrajectories: true,
    }
    await agentRunner.registerAgent(agentConfig)
  }

  // Register red team agents
  const redTeamCharacters = await loadRedTeamCharacters()
  for (const character of redTeamCharacters) {
    const agentConfig: ExtendedAgentConfig = {
      agentId: `red-${character.name.toLowerCase().replace(/\s+/g, '-')}`,
      character,
      tickIntervalMs: 120000,
      capabilities: {
        canTrade: true, // Red team can test trading vulnerabilities
        canChat: true,
        canPropose: true,
        canVote: true,
        canDelegate: true,
        canStake: true,
        canBridge: false,
        a2a: true,
        compute: true,
      },
      maxActionsPerTick: 5, // Red team gets more actions for testing
      enabled: true,
      archetype: 'red-team',
      recordTrajectories: true,
    }
    await agentRunner.registerAgent(agentConfig)
  }

  await agentRunner.start()

  log.info('Agent runner initialized', {
    blueTeamCount: blueTeamCharacters.length,
    redTeamCount: redTeamCharacters.length,
  })

  return agentRunner
}

/**
 * Cron authentication header check
 */
function verifyCronAuth(headers: Record<string, string | undefined>): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true // Allow in development

  const authHeader = headers.authorization
  return authHeader === `Bearer ${cronSecret}`
}

/**
 * Crucible cron routes
 */
export const cronRoutes = new Elysia({ prefix: '/api/cron' })
  .onBeforeHandle(
    ({ headers, set }): { error: string; message: string } | undefined => {
      if (!verifyCronAuth(headers)) {
        set.status = 401
        return { error: 'Unauthorized', message: 'Invalid cron secret' }
      }
      return undefined
    },
  )

  // Agent tick - executes autonomous agent actions
  .post(
    '/agent-tick',
    async () => {
      const timestamp = new Date().toISOString()
      const startTime = Date.now()

      log.info('Agent tick cron job started', { timestamp })

      const runner = await getAgentRunner()
      const status = runner.getStatus()

      // The runner executes ticks automatically via intervals,
      // but this endpoint ensures it's running and returns status
      if (!status.running) {
        await runner.start()
      }

      const trajStats = runner.getTrajectoryStats()
      const duration = Date.now() - startTime

      log.info('Agent tick cron job completed', {
        agentCount: status.agentCount,
        running: status.running,
        trajectoryBuffer: trajStats.bufferCount,
        activeTrajectories: trajStats.activeTrajectories,
        durationMs: duration,
      })

      return {
        success: true,
        agentCount: status.agentCount,
        running: status.running,
        agents: status.agents.map((a) => ({
          id: a.id,
          character: a.character,
          lastTick: a.lastTick,
          tickCount: a.tickCount,
        })),
        trajectoryStats: {
          bufferCount: trajStats.bufferCount,
          bufferAgeMs: trajStats.bufferAgeMs,
          activeTrajectories: trajStats.activeTrajectories,
        },
        durationMs: duration,
        timestamp,
      }
    },
    {
      detail: {
        tags: ['Cron'],
        summary: 'Execute autonomous agent tick',
        description:
          'Triggers autonomous actions for Crucible agents with trajectory recording',
      },
    },
  )

  // Flush trajectories to storage
  .post(
    '/flush-trajectories',
    async () => {
      const timestamp = new Date().toISOString()

      log.info('Trajectory flush triggered', { timestamp })

      // Flush from runner
      const runner = await getAgentRunner()
      const runnerBatch = await runner.flushTrajectories()

      // Also flush the shared storage
      const storageBatch = await crucibleTrajectoryStorage.flush()

      const result: {
        success: boolean
        batches: TrajectoryBatchReference[]
        timestamp: string
      } = {
        success: true,
        batches: [],
        timestamp,
      }

      if (runnerBatch) {
        result.batches.push(runnerBatch)
      }
      if (storageBatch) {
        result.batches.push(storageBatch)
      }

      log.info('Trajectory flush completed', {
        batchCount: result.batches.length,
        totalTrajectories: result.batches.reduce(
          (sum, b) => sum + b.trajectoryCount,
          0,
        ),
      })

      return result
    },
    {
      detail: {
        tags: ['Cron'],
        summary: 'Flush trajectory buffer to storage',
        description: 'Forces flush of buffered trajectories to DWS storage',
      },
    },
  )

  // Health check
  .post(
    '/health-check',
    async () => {
      const timestamp = new Date().toISOString()

      const runner = await getAgentRunner()
      const status = runner.getStatus()
      const trajStats = runner.getTrajectoryStats()
      const storageStats = crucibleTrajectoryStorage.getBufferStats()

      log.debug('Health check', {
        timestamp,
        running: status.running,
        agentCount: status.agentCount,
        bufferCount: trajStats.bufferCount,
        storageCount: storageStats.count,
      })

      return {
        success: true,
        status: 'healthy',
        runner: {
          running: status.running,
          agentCount: status.agentCount,
        },
        trajectoryStats: {
          runnerBuffer: trajStats.bufferCount,
          storageBuffer: storageStats.count,
          activeTrajectories: trajStats.activeTrajectories,
        },
        timestamp,
      }
    },
    {
      detail: {
        tags: ['Cron'],
        summary: 'Health check',
        description: 'System health status including agent runner and storage',
      },
    },
  )

  // Stop the agent runner (for maintenance)
  .post(
    '/stop-runner',
    async () => {
      const timestamp = new Date().toISOString()

      if (agentRunner) {
        await agentRunner.stop()
        log.info('Agent runner stopped', { timestamp })
      }

      return {
        success: true,
        message: 'Agent runner stopped',
        timestamp,
      }
    },
    {
      detail: {
        tags: ['Cron'],
        summary: 'Stop agent runner',
        description: 'Stops the autonomous agent runner for maintenance',
      },
    },
  )

  // Start the agent runner
  .post(
    '/start-runner',
    async () => {
      const timestamp = new Date().toISOString()

      const runner = await getAgentRunner()
      await runner.start()

      log.info('Agent runner started', { timestamp })

      const status = runner.getStatus()
      return {
        success: true,
        message: 'Agent runner started',
        status: {
          running: status.running,
          agentCount: status.agentCount,
          agents: status.agents,
        },
        timestamp,
      }
    },
    {
      detail: {
        tags: ['Cron'],
        summary: 'Start agent runner',
        description: 'Starts the autonomous agent runner',
      },
    },
  )
