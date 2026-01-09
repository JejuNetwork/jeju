/**
 * Dedicated cron router for DWS scheduled triggers.
 *
 * This router handles autonomous agent execution on a schedule,
 * triggered by DWS cron infrastructure.
 */

import { constantTimeCompare } from '@jejunetwork/api'
import { getCurrentNetwork } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import { getCronSecret } from '../sdk/secrets'
import { createLogger } from '../sdk/logger'
import {
  getAutonomousRunner,
  initializeAutonomousRunner,
} from './router'
import { getMessageStore } from './message-store'

const log = createLogger('AutonomousCron')

// Service address for secrets access
const SERVICE_ADDRESS = '0x0000000000000000000000000000000000000001' as const

// Track whether we've warned about missing CRON_SECRET
let warnedAboutMissingSecret = false

// Cached cron secret (loaded once from secrets module)
let cachedCronSecret: string | null | undefined

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
 * Cron authentication middleware.
 * Uses constant-time comparison for security.
 * Allows unauthenticated access in localnet for dev convenience.
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
 * Create the cron router for autonomous agent triggers.
 */
export function createCronRouter() {
  return new Elysia({ prefix: '/api/cron' })
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

    // POST /api/cron/agent-tick - execute all agent ticks
    .post(
      '/agent-tick',
      async () => {
        const timestamp = new Date().toISOString()
        const startTime = Date.now()

        log.info('Agent tick cron job started', { timestamp })

        // Initialize runner if not started
        let runner = getAutonomousRunner()
        if (!runner) {
          log.info('Initializing autonomous runner on first tick')
          runner = await initializeAutonomousRunner()
        }

        // Ensure runner is started
        if (!runner.getStatus().running) {
          await runner.start()
        }

        // Execute ticks for all agents
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
            'Triggers autonomous actions for all registered agents with trajectory recording',
        },
      },
    )

    // POST /api/cron/flush-trajectories - flush trajectory data
    .post(
      '/flush-trajectories',
      async ({ set }) => {
        const timestamp = new Date().toISOString()

        log.info('Trajectory flush triggered', { timestamp })

        const runner = getAutonomousRunner()
        if (!runner) {
          set.status = 503
          return {
            error: 'Autonomous runner not initialized',
            message: 'Server not ready',
          }
        }

        const batch = await runner.flushTrajectories()

        log.info('Trajectory flush completed', {
          batchId: batch?.batchId ?? null,
          trajectoryCount: batch?.trajectoryCount ?? 0,
        })

        return {
          success: true,
          batch: batch
            ? {
                batchId: batch.batchId,
                storageCid: batch.storageCid,
                trajectoryCount: batch.trajectoryCount,
                compressedSizeBytes: batch.compressedSizeBytes,
              }
            : null,
          timestamp,
        }
      },
      {
        detail: {
          tags: ['Cron'],
          summary: 'Flush trajectory buffer to storage',
          description: 'Forces flush of buffered trajectories to DWS storage',
        },
      },
    )

    // POST /api/cron/health-check - system health
    .post(
      '/health-check',
      async () => {
        const timestamp = new Date().toISOString()

        const runner = getAutonomousRunner()
        const messageStore = getMessageStore()
        const messageStats = messageStore.getStats()

        if (!runner) {
          return {
            success: true,
            status: 'not_initialized',
            runner: {
              running: false,
              agentCount: 0,
            },
            messageStore: messageStats,
            timestamp,
          }
        }

        const status = runner.getStatus()
        const trajStats = runner.getTrajectoryStats()

        log.debug('Health check', {
          timestamp,
          running: status.running,
          agentCount: status.agentCount,
          bufferCount: trajStats.bufferCount,
        })

        return {
          success: true,
          status: status.running ? 'healthy' : 'stopped',
          runner: {
            running: status.running,
            agentCount: status.agentCount,
          },
          trajectoryStats: {
            bufferCount: trajStats.bufferCount,
            bufferAgeMs: trajStats.bufferAgeMs,
            activeTrajectories: trajStats.activeTrajectories,
          },
          messageStore: messageStats,
          timestamp,
        }
      },
      {
        detail: {
          tags: ['Cron'],
          summary: 'Health check',
          description:
            'System health status including agent runner and message store stats',
        },
      },
    )
}
