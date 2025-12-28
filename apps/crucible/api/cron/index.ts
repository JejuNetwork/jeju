/**
 * Crucible Cron Routes - Agent ticks, trajectory flushing, health checks
 */

import { constantTimeCompare } from '@jejunetwork/api'
import {
  getStaticTrajectoryStorage,
  TrainingDbPersistence,
  type TrajectoryBatchReference,
} from '@jejunetwork/training'
import { Elysia } from 'elysia'
import { type AutonomousAgentRunner, createAgentRunner } from '../autonomous'
import { loadBlueTeamCharacters, loadRedTeamCharacters } from '../characters'
import { config } from '../config'
import { createLogger } from '../sdk/logger'

const log = createLogger('CronRoutes')

// Database persistence for trajectory batches (lazy initialized)
let dbPersistence: TrainingDbPersistence | null = null

async function getDbPersistence(): Promise<TrainingDbPersistence | null> {
  if (dbPersistence) return dbPersistence

  // Try to get database client from environment
  const { config } = await import('../config')
  const dbEndpoint = config.eqliteEndpoint
  if (!dbEndpoint) {
    log.warn(
      'EQLITE_ENDPOINT not set - trajectory batches will not be persisted to database',
    )
    return null
  }

  const keyId = process.env.EQLITE_KEY_ID
  if (!keyId) {
    log.warn(
      'EQLITE_KEY_ID not set - trajectory batches will not be persisted to database',
    )
    return null
  }

  // Import dynamically to avoid circular deps
  const { EQLiteClient } = await import('@jejunetwork/db')
  const client = new EQLiteClient({ blockProducerEndpoint: dbEndpoint, keyId })
  dbPersistence = new TrainingDbPersistence(client)
  return dbPersistence
}

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

    // Persist to database for discovery
    const persistence = await getDbPersistence()
    if (persistence) {
      await persistence.saveBatchReference(batch)
    }
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

  // Shared capabilities for all agents
  const baseCapabilities = {
    canChat: true,
    canPropose: true,
    canVote: true,
    canDelegate: true,
    canStake: true,
    canBridge: false,
    a2a: true,
    compute: true,
  }

  // Register blue team agents (defensive)
  const blueTeamCharacters = await loadBlueTeamCharacters()
  for (const character of blueTeamCharacters) {
    await agentRunner.registerAgent({
      agentId: `blue-${character.name.toLowerCase().replace(/\s+/g, '-')}`,
      character,
      tickIntervalMs: 120000,
      capabilities: { ...baseCapabilities, canTrade: false },
      maxActionsPerTick: 3,
      enabled: true,
      archetype: 'blue-team',
      recordTrajectories: true,
    })
  }

  // Register red team agents (adversarial)
  const redTeamCharacters = await loadRedTeamCharacters()
  for (const character of redTeamCharacters) {
    await agentRunner.registerAgent({
      agentId: `red-${character.name.toLowerCase().replace(/\s+/g, '-')}`,
      character,
      tickIntervalMs: 120000,
      capabilities: { ...baseCapabilities, canTrade: true },
      maxActionsPerTick: 5,
      enabled: true,
      archetype: 'red-team',
      recordTrajectories: true,
    })
  }

  await agentRunner.start()

  log.info('Agent runner initialized', {
    blueTeamCount: blueTeamCharacters.length,
    redTeamCount: redTeamCharacters.length,
  })

  return agentRunner
}

// Track whether we've warned about missing CRON_SECRET
let warnedAboutMissingSecret = false

/**
 * Cron authentication header check
 */
function verifyCronAuth(headers: Record<string, string | undefined>): boolean {
  const cronSecret = config.cronSecret
  const network = config.network

  if (!cronSecret) {
    // SECURITY: Only allow unauthenticated cron access in localnet
    if (network !== 'localnet') {
      if (!warnedAboutMissingSecret) {
        log.error(
          'CRON_SECRET not set in production - cron endpoints are BLOCKED. Set CRON_SECRET to enable.',
        )
        warnedAboutMissingSecret = true
      }
      return false // Block in production/testnet without secret
    }

    if (!warnedAboutMissingSecret) {
      log.warn(
        'CRON_SECRET not set - cron endpoints are unprotected (localnet only).',
      )
      warnedAboutMissingSecret = true
    }
    return true // Allow in localnet development
  }

  const authHeader = headers.authorization
  if (!authHeader) return false
  const expected = `Bearer ${cronSecret}`
  return constantTimeCompare(authHeader, expected)
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

      // Ensure runner is started
      if (!runner.getStatus().running) {
        await runner.start()
      }

      // Execute ticks for all agents immediately
      const tickResults = await runner.executeAllAgentsTick()

      const trajStats = runner.getTrajectoryStats()
      const duration = Date.now() - startTime

      log.info('Agent tick cron job completed', {
        executed: tickResults.executed,
        succeeded: tickResults.succeeded,
        failed: tickResults.failed,
        trajectoryBuffer: trajStats.bufferCount,
        durationMs: duration,
      })

      return {
        success: tickResults.failed === 0,
        executed: tickResults.executed,
        succeeded: tickResults.succeeded,
        failed: tickResults.failed,
        results: tickResults.results.map((r) => ({
          agentId: r.agentId,
          success: r.success,
          reward: r.reward,
          latencyMs: r.latencyMs,
          error: r.error,
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
