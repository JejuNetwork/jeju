import { Elysia, type Static, t } from 'elysia'
import { getCharacter } from '../characters'
import { config } from '../config'
import { type AutonomousAgentRunner, createAgentRunner } from './index'
import { DEFAULT_AUTONOMOUS_CONFIG } from './types'

// Module-level runner instance
let autonomousRunner: AutonomousAgentRunner | null = null

export function getAutonomousRunner(): AutonomousAgentRunner | null {
  return autonomousRunner
}

export function setAutonomousRunner(
  runner: AutonomousAgentRunner | null,
): void {
  autonomousRunner = runner
}

/**
 * Initialize the autonomous runner with optional configuration.
 * If already initialized, returns the existing instance.
 */
export async function initializeAutonomousRunner(options?: {
  privateKey?: `0x${string}`
  network?: 'localnet' | 'testnet' | 'mainnet'
}): Promise<AutonomousAgentRunner> {
  if (autonomousRunner) {
    return autonomousRunner
  }

  autonomousRunner = createAgentRunner({
    enableBuiltinCharacters: config.enableBuiltinCharacters,
    defaultTickIntervalMs: config.defaultTickIntervalMs,
    maxConcurrentAgents: config.maxConcurrentAgents,
    privateKey: options?.privateKey,
    network: options?.network ?? config.network,
    enableTrajectoryRecording: true,
  })

  return autonomousRunner
}

// Elysia validation schemas
const RegisterAgentSchema = t.Object({
  characterId: t.String({ minLength: 1 }),
  tickIntervalMs: t.Optional(t.Number({ minimum: 1000 })),
  capabilities: t.Optional(
    t.Object({
      canChat: t.Optional(t.Boolean()),
      canTrade: t.Optional(t.Boolean()),
      canVote: t.Optional(t.Boolean()),
      canPropose: t.Optional(t.Boolean()),
      canDelegate: t.Optional(t.Boolean()),
      canStake: t.Optional(t.Boolean()),
      canBridge: t.Optional(t.Boolean()),
      a2a: t.Optional(t.Boolean()),
      compute: t.Optional(t.Boolean()),
      canModerate: t.Optional(t.Boolean()),
    }),
  ),
  watchRoom: t.Optional(t.String()),
  postToRoom: t.Optional(t.String()),
})

type RegisterAgentBody = Static<typeof RegisterAgentSchema>

/**
 * Create the Elysia router for autonomous agent management.
 * Mounts at /autonomous prefix.
 */
export function createAutonomousRouter() {
  const router = new Elysia({ prefix: '/autonomous' })

  // GET /status - return enabled/running/agentCount/agents
  router.get('/status', () => {
    if (!autonomousRunner) {
      return {
        enabled: config.autonomousEnabled,
        running: false,
        agentCount: 0,
        agents: [],
        message:
          'Autonomous mode is disabled. Set AUTONOMOUS_ENABLED=true to enable.',
      }
    }

    const status = autonomousRunner.getStatus()
    return {
      enabled: config.autonomousEnabled,
      running: status.running,
      agentCount: status.agentCount,
      agents: status.agents.map((agent) => ({
        id: agent.id,
        character: agent.character,
        lastTick: agent.lastTick,
        tickCount: agent.tickCount,
        recentActivity: agent.recentActivity,
      })),
    }
  })

  // POST /start - start runner
  router.post('/start', async ({ set }) => {
    if (!config.autonomousEnabled) {
      set.status = 400
      return {
        success: false,
        error:
          'Autonomous mode is disabled. Set AUTONOMOUS_ENABLED=true to enable.',
      }
    }

    if (!autonomousRunner) {
      set.status = 503
      return {
        success: false,
        error:
          'Autonomous runner not initialized. Call initializeAutonomousRunner first.',
      }
    }

    await autonomousRunner.start()
    return {
      success: true,
      message: 'Autonomous runner started',
      status: autonomousRunner.getStatus(),
    }
  })

  // POST /stop - stop runner
  router.post('/stop', async ({ set }) => {
    if (!autonomousRunner) {
      set.status = 400
      return {
        success: false,
        error: 'Autonomous runner not started',
      }
    }

    await autonomousRunner.stop()
    return {
      success: true,
      message: 'Autonomous runner stopped',
    }
  })

  // POST /agents - register agent (validate body with Elysia)
  router.post(
    '/agents',
    async ({ body, set }) => {
      if (!config.autonomousEnabled) {
        set.status = 400
        return {
          success: false,
          error:
            'Autonomous mode is disabled. Set AUTONOMOUS_ENABLED=true to enable.',
        }
      }

      if (!autonomousRunner) {
        set.status = 503
        return {
          success: false,
          error: 'Autonomous runner not initialized',
        }
      }

      const request = body as RegisterAgentBody
      const {
        characterId,
        tickIntervalMs,
        capabilities,
        watchRoom,
        postToRoom,
      } = request

      const character = getCharacter(characterId)
      if (!character) {
        set.status = 404
        return {
          success: false,
          error: `Character not found: ${characterId}`,
        }
      }

      const agentId = `autonomous-${characterId}`

      await autonomousRunner.registerAgent({
        ...DEFAULT_AUTONOMOUS_CONFIG,
        agentId,
        character,
        tickIntervalMs: tickIntervalMs ?? config.defaultTickIntervalMs,
        capabilities: capabilities
          ? {
              ...DEFAULT_AUTONOMOUS_CONFIG.capabilities,
              ...capabilities,
            }
          : DEFAULT_AUTONOMOUS_CONFIG.capabilities,
        watchRoom,
        postToRoom,
      })

      return {
        success: true,
        agentId,
        message: `Agent ${characterId} registered for autonomous mode`,
      }
    },
    {
      body: RegisterAgentSchema,
    },
  )

  // DELETE /agents/:agentId - unregister agent
  router.delete('/agents/:agentId', ({ params, set }) => {
    if (!autonomousRunner) {
      set.status = 400
      return {
        success: false,
        error: 'Autonomous runner not started',
      }
    }

    const { agentId } = params
    autonomousRunner.unregisterAgent(agentId)

    return {
      success: true,
      message: `Agent ${agentId} removed from autonomous mode`,
    }
  })

  return router
}
