import { constantTimeCompare } from '@jejunetwork/api'
import { getCurrentNetwork } from '@jejunetwork/config'
import {
  getStaticTrajectoryStorage,
  TrainingDbPersistence,
  type TrajectoryBatchReference,
} from '@jejunetwork/training'
import { Elysia } from 'elysia'
import { agentSdk, autonomousRunner } from '../server'
import { createLogger } from '../sdk/logger'
import { getCronSecret } from '../sdk/secrets'
import { DEFAULT_AUTONOMOUS_CONFIG } from '../autonomous/types'

const log = createLogger('CronRoutes')

// Coordination room IDs for agent communication
export const COORDINATION_ROOMS = {
  BASE_CONTRACT_REVIEWS: 'base-contract-reviews',
} as const

// Database persistence for trajectory batches (lazy initialized)
let dbPersistence: TrainingDbPersistence | null = null

async function getDbPersistence(): Promise<TrainingDbPersistence | null> {
  if (dbPersistence) return dbPersistence

  // Try to get database client from environment
  const { config } = await import('../config')
  const dbEndpoint = config.sqlitEndpoint
  if (!dbEndpoint) {
    log.warn(
      'SQLIT_ENDPOINT not set - trajectory batches will not be persisted to database',
    )
    return null
  }

  const keyId = process.env.SQLIT_KEY_ID
  if (!keyId) {
    log.warn(
      'SQLIT_KEY_ID not set - trajectory batches will not be persisted to database',
    )
    return null
  }

  // Import dynamically to avoid circular deps
  const { SQLitClient } = await import('@jejunetwork/db')
  const client = new SQLitClient({ endpoint: dbEndpoint, databaseId: keyId })
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

/**
 * Ensure coordination rooms exist in the database
 * Called on startup before agents are registered
 */
async function ensureCoordinationRoom(): Promise<void> {
  const { getDatabase } = await import('../sdk/database')
  const db = getDatabase()

  const roomId = COORDINATION_ROOMS.BASE_CONTRACT_REVIEWS

  try {
    const existingRoom = await db.getRoom(roomId)

    if (!existingRoom) {
      log.info('Creating coordination room', { roomId })
      await db.createRoom({
        roomId,
        name: 'Base Contract Reviews',
        roomType: 'collaboration',
      })
      log.info('Coordination room created', { roomId })
    } else {
      log.debug('Coordination room already exists', { roomId })
    }
  } catch (err) {
    log.warn('Failed to create coordination room', {
      roomId,
      error: err instanceof Error ? err.message : String(err),
    })
    // Don't block startup - room can be created later
  }
}

// Track whether we've warned about missing CRON_SECRET
let warnedAboutMissingSecret = false

// Cached cron secret (loaded once from secrets module)
let cachedCronSecret: string | null | undefined

// Service address for secrets access
const SERVICE_ADDRESS = '0x0000000000000000000000000000000000000001' as const

/**
 * Get cron secret from the secrets module (cached after first load)
 */
async function loadCronSecret(): Promise<string | null> {
  if (cachedCronSecret !== undefined) {
    return cachedCronSecret
  }

  cachedCronSecret = await getCronSecret(SERVICE_ADDRESS)
  return cachedCronSecret
}

/**
 * Cron authentication header check
 * Uses secrets module for CRON_SECRET access
 */
async function verifyCronAuth(
  headers: Record<string, string | undefined>,
): Promise<boolean> {
  const cronSecret = await loadCronSecret()
  const network = getCurrentNetwork()

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
    async ({
      headers,
      set,
    }): Promise<{ error: string; message: string } | undefined> => {
      if (!(await verifyCronAuth(headers))) {
        set.status = 401
        return { error: 'Unauthorized', message: 'Invalid cron secret' }
      }
      return undefined
    },
  )

  // Agent tick - executes autonomous agent actions
  .post(
    '/agent-tick',
    async ({ set }) => {
      if (!autonomousRunner) {
        set.status = 503
        return { error: 'Autonomous runner not initialized', message: 'Server not ready' }
      }

      const timestamp = new Date().toISOString()
      const startTime = Date.now()

      log.info('Agent tick cron job started', { timestamp })

      // Ensure runner is started
      if (!autonomousRunner.getStatus().running) {
        await autonomousRunner.start()
      }

      // Execute ticks for scheduled agents
      const tickResults = await autonomousRunner.executeAllAgentsTick({
        mode: 'cron',
      })

      const trajStats = autonomousRunner.getTrajectoryStats()
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

  // One-shot agent tick - executes once WITHOUT starting interval loops
  .post(
    '/agent-tick-once',
    async ({ set, query, body }) => {
      if (!autonomousRunner) {
        set.status = 503
        return { error: 'Autonomous runner not initialized', message: 'Server not ready' }
      }

      const timestamp = new Date().toISOString()
      const startTime = Date.now()

      // Accept agentId from query string or body
      const agentId = (query as { agentId?: string }).agentId ??
                      (body as { agentId?: string } | null)?.agentId

      log.info('One-shot agent tick started', { timestamp, agentId: agentId ?? 'all' })

      const status = autonomousRunner.getStatus()

      // NOTE: We intentionally do NOT call autonomousRunner.start() here
      // This executes agents once without starting interval loops

      // If agentId is provided, tick only that agent (can auto-register from chain)
      if (agentId) {
        log.info('Executing one-shot tick for single agent', { agentId })

        // Validate agentId format
        if (!/^\d+$/.test(agentId)) {
          return {
            success: false,
            executed: 0,
            succeeded: 0,
            failed: 1,
            results: [{ agentId, success: false, reward: 0, latencyMs: 0, error: 'Invalid agent ID format' }],
            durationMs: Date.now() - startTime,
            timestamp,
            note: 'Agent ID must be numeric',
          }
        }

        let result = await autonomousRunner.executeAgentTickById(agentId)

        // If agent not found in runner, try to load from on-chain and register
        // Note: Agent stays registered for this session (until process restart)
        if (!result.success && result.error?.startsWith('Agent not found')) {
          log.info('Agent not in runner, attempting to load from chain', { agentId })

          try {
            const numericId = BigInt(agentId)
            const onChainAgent = await agentSdk.getAgent(numericId)

            if (onChainAgent && onChainAgent.characterCid) {
              const character = await agentSdk.loadCharacter(numericId)
              // Register for this session (persists until process restart)
              await autonomousRunner.registerAgent({
                ...DEFAULT_AUTONOMOUS_CONFIG,
                agentId,
                character,
                tickIntervalMs: 60_000,
                capabilities: {
                  ...DEFAULT_AUTONOMOUS_CONFIG.capabilities,
                  ...(character.capabilities ?? {}),
                },
              })

              log.info('Agent registered, executing tick', { agentId })
              result = await autonomousRunner.executeAgentTickById(agentId)
            } else {
              result = {
                success: false,
                reward: 0,
                error: `Agent ${agentId} not found on-chain`,
                latencyMs: Date.now() - startTime,
              }
            }
          } catch (err) {
            log.error('Failed to load agent from chain', {
              agentId,
              error: err instanceof Error ? err.message : String(err),
            })
            result = {
              success: false,
              reward: 0,
              error: `Failed to load agent: ${err instanceof Error ? err.message : String(err)}`,
              latencyMs: Date.now() - startTime,
            }
          }
        }

        const duration = Date.now() - startTime

        log.info('One-shot single agent tick completed', {
          agentId,
          success: result.success,
          durationMs: duration,
        })

        return {
          success: result.success,
          executed: 1,
          succeeded: result.success ? 1 : 0,
          failed: result.success ? 0 : 1,
          results: [{
            agentId,
            success: result.success,
            reward: result.reward,
            latencyMs: result.latencyMs,
            error: result.error,
          }],
          durationMs: duration,
          timestamp,
          note: 'One-shot execution for single agent - interval loops NOT started',
        }
      }

      // No agentId - tick all agents (requires at least one registered)
      if (status.agentCount === 0) {
        set.status = 400
        return {
          error: 'No agents registered',
          message: 'Register agents first or provide agentId to auto-register from chain',
          timestamp,
        }
      }

      log.info('Executing one-shot tick for all agents', {
        agentCount: status.agentCount,
        runnerRunning: status.running,
      })

      const tickResults = await autonomousRunner.executeAllAgentsTick({
        mode: 'manual',
      })
      const duration = Date.now() - startTime

      log.info('One-shot agent tick completed', {
        executed: tickResults.executed,
        succeeded: tickResults.succeeded,
        failed: tickResults.failed,
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
        durationMs: duration,
        timestamp,
        note: 'One-shot execution - interval loops NOT started',
      }
    },
    {
      detail: {
        tags: ['Cron'],
        summary: 'Execute agent tick once (no intervals)',
        description:
          'Triggers a single tick for registered agents WITHOUT starting interval loops. Pass agentId as query param or body to tick a specific agent, otherwise ticks all agents.',
      },
    },
  )

  // Flush trajectories to storage
  .post(
    '/flush-trajectories',
    async ({ set }) => {
      if (!autonomousRunner) {
        set.status = 503
        return { error: 'Autonomous runner not initialized', message: 'Server not ready' }
      }

      const timestamp = new Date().toISOString()

      log.info('Trajectory flush triggered', { timestamp })

      // Flush from runner
      const runnerBatch = await autonomousRunner.flushTrajectories()

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
    async ({ set }) => {
      if (!autonomousRunner) {
        set.status = 503
        return { error: 'Autonomous runner not initialized', message: 'Server not ready' }
      }

      const timestamp = new Date().toISOString()

      const status = autonomousRunner.getStatus()
      const trajStats = autonomousRunner.getTrajectoryStats()
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
    async ({ set }) => {
      const timestamp = new Date().toISOString()

      if (!autonomousRunner) {
        set.status = 503
        return { error: 'Autonomous runner not initialized', message: 'Server not ready' }
      }

      await autonomousRunner.stop()
      log.info('Agent runner stopped', { timestamp })

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
    async ({ set }) => {
      const timestamp = new Date().toISOString()

      if (!autonomousRunner) {
        set.status = 503
        return { error: 'Autonomous runner not initialized', message: 'Server not ready' }
      }

      await autonomousRunner.start()

      log.info('Agent runner started', { timestamp })

      const status = autonomousRunner.getStatus()
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
