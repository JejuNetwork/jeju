/**
 * Autonomous Agent Runner
 *
 * Daemon that runs autonomous ticks for registered agents.
 * Similar to Babylon's DecentralizedAgentRunner.
 *
 * Architecture:
 * 1. Load: Fetch autonomous agent configurations
 * 2. Hydrate: Create runtime for each agent
 * 3. Execute: Run autonomous ticks on intervals
 * 4. Report: Log execution results
 */

import type { Address } from 'viem'
import { getCharacter, listCharacters } from '../characters'
import {
  type CrucibleAgentRuntime,
  createCrucibleRuntime,
} from '../sdk/eliza-runtime'
import { createLogger } from '../sdk/logger'
import { AutonomousTick, type AutonomousTickResult } from './tick'
import { type AutonomousAgentConfig, DEFAULT_AUTONOMOUS_CONFIG } from './types'

const log = createLogger('AutonomousRunner')

/**
 * Configuration for the autonomous runner
 */
export interface AutonomousRunnerConfig {
  /** Node's wallet address for identification */
  nodeAddress?: Address
  /** Jeju network */
  network: 'localnet' | 'testnet' | 'mainnet'
  /** Maximum concurrent agents to run */
  maxConcurrentAgents: number
  /** Default tick interval in milliseconds */
  defaultTickIntervalMs: number
  /** Enable all pre-built characters as autonomous */
  enableBuiltinCharacters: boolean
}

/**
 * Agent execution record
 */
interface AgentExecution {
  agentId: string
  characterName: string
  lastTickAt: number
  lastTickResult?: AutonomousTickResult
  nextTickAt: number
  errors: number
}

/**
 * Autonomous Agent Runner
 *
 * Runs agent autonomous loops at configurable intervals.
 */
export class AutonomousAgentRunner {
  private config: AutonomousRunnerConfig
  private running = false
  private agents = new Map<
    string,
    {
      config: AutonomousAgentConfig
      runtime: CrucibleAgentRuntime
      execution: AgentExecution
    }
  >()
  private tickLoop: ReturnType<typeof setInterval> | null = null

  constructor(config: AutonomousRunnerConfig) {
    this.config = config
  }

  /**
   * Start the autonomous agent runner
   */
  async start(): Promise<void> {
    if (this.running) {
      log.warn('Autonomous runner already running')
      return
    }

    log.info('Starting autonomous agent runner', {
      network: this.config.network,
      maxConcurrent: this.config.maxConcurrentAgents,
      tickInterval: this.config.defaultTickIntervalMs,
    })

    // Load agents
    await this.loadAgents()

    // Start the tick loop
    this.running = true
    this.tickLoop = setInterval(
      () => this.runTickCycle(),
      1000, // Check every second for due ticks
    )

    // Run first tick cycle immediately for any due agents
    await this.runTickCycle()

    log.info('Autonomous agent runner started', {
      agents: this.agents.size,
    })
  }

  /**
   * Stop the autonomous agent runner
   */
  async stop(): Promise<void> {
    if (!this.running) return

    log.info('Stopping autonomous agent runner')

    this.running = false
    if (this.tickLoop) {
      clearInterval(this.tickLoop)
      this.tickLoop = null
    }

    this.agents.clear()
    log.info('Autonomous agent runner stopped')
  }

  /**
   * Load autonomous agents
   */
  private async loadAgents(): Promise<void> {
    // If enabled, load all built-in characters as autonomous agents
    if (this.config.enableBuiltinCharacters) {
      const characterIds = listCharacters()

      for (const characterId of characterIds) {
        if (this.agents.size >= this.config.maxConcurrentAgents) {
          log.warn('Max concurrent agents reached', {
            max: this.config.maxConcurrentAgents,
          })
          break
        }

        const character = getCharacter(characterId)
        if (!character) continue

        const agentConfig: AutonomousAgentConfig = {
          ...DEFAULT_AUTONOMOUS_CONFIG,
          agentId: `autonomous-${characterId}`,
          character,
          tickIntervalMs: this.config.defaultTickIntervalMs,
        }

        await this.registerAgent(agentConfig)
      }
    }

    // TODO: Load additional agents from configuration/database
  }

  /**
   * Register an autonomous agent
   */
  async registerAgent(config: AutonomousAgentConfig): Promise<void> {
    if (this.agents.has(config.agentId)) {
      log.warn('Agent already registered', { agentId: config.agentId })
      return
    }

    log.info('Registering autonomous agent', {
      agentId: config.agentId,
      character: config.character.name,
      tickInterval: config.tickIntervalMs,
    })

    // Create runtime
    const runtime = createCrucibleRuntime({
      agentId: config.agentId,
      character: config.character,
    })

    // Initialize runtime
    await runtime.initialize()

    const now = Date.now()
    this.agents.set(config.agentId, {
      config,
      runtime,
      execution: {
        agentId: config.agentId,
        characterName: config.character.name,
        lastTickAt: 0,
        nextTickAt: now, // Run first tick immediately
        errors: 0,
      },
    })

    log.info('Agent registered', {
      agentId: config.agentId,
      character: config.character.name,
    })
  }

  /**
   * Unregister an autonomous agent
   */
  unregisterAgent(agentId: string): void {
    if (this.agents.delete(agentId)) {
      log.info('Agent unregistered', { agentId })
    }
  }

  /**
   * Run tick cycle - check for due agents and execute ticks
   */
  private async runTickCycle(): Promise<void> {
    if (!this.running) return

    const now = Date.now()
    const dueAgents: string[] = []

    // Find agents due for a tick
    for (const [agentId, agent] of this.agents) {
      if (!agent.config.autonomousEnabled) continue
      if (agent.execution.nextTickAt <= now) {
        dueAgents.push(agentId)
      }
    }

    if (dueAgents.length === 0) return

    log.debug(`Processing ${dueAgents.length} due agent(s)`)

    // Process agents (with concurrency limit)
    const batchSize = Math.min(
      dueAgents.length,
      this.config.maxConcurrentAgents,
    )
    const batch = dueAgents.slice(0, batchSize)

    const results = await Promise.allSettled(
      batch.map((agentId) => this.executeAgentTick(agentId)),
    )

    // Log results
    let successful = 0
    let failed = 0
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        successful++
      } else {
        failed++
      }
    }

    if (successful > 0 || failed > 0) {
      log.info('Tick cycle completed', { successful, failed })
    }
  }

  /**
   * Execute autonomous tick for a single agent
   */
  private async executeAgentTick(
    agentId: string,
  ): Promise<AutonomousTickResult> {
    const agent = this.agents.get(agentId)
    if (!agent) {
      return {
        success: false,
        actionsExecuted: [],
        iterations: 0,
        duration: 0,
        error: 'Agent not found',
      }
    }

    const { config, runtime, execution } = agent
    const now = Date.now()

    log.info('Executing autonomous tick', {
      agentId,
      character: config.character.name,
    })

    try {
      // Create tick handler
      const tick = new AutonomousTick(config, runtime)

      // Execute tick
      const result = await tick.execute()

      // Update execution record
      execution.lastTickAt = now
      execution.lastTickResult = result
      execution.nextTickAt = now + config.tickIntervalMs

      if (!result.success) {
        execution.errors++
      } else {
        execution.errors = 0 // Reset on success
      }

      return result
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log.error('Tick execution failed', { agentId, error })

      execution.lastTickAt = now
      execution.nextTickAt = now + config.tickIntervalMs
      execution.errors++

      // Exponential backoff for repeated failures
      if (execution.errors >= 3) {
        const backoff = Math.min(
          execution.errors * config.tickIntervalMs,
          300_000,
        ) // Max 5 min
        execution.nextTickAt = now + backoff
        log.warn('Agent in backoff due to repeated failures', {
          agentId,
          errors: execution.errors,
          nextTickIn: backoff / 1000,
        })
      }

      return {
        success: false,
        actionsExecuted: [],
        iterations: 0,
        duration: 0,
        error,
      }
    }
  }

  /**
   * Get runner status
   */
  getStatus(): {
    running: boolean
    agents: number
    network: string
    agentDetails: Array<{
      agentId: string
      characterName: string
      lastTickAt: number
      nextTickAt: number
      errors: number
    }>
  } {
    return {
      running: this.running,
      agents: this.agents.size,
      network: this.config.network,
      agentDetails: Array.from(this.agents.values()).map((a) => ({
        agentId: a.execution.agentId,
        characterName: a.execution.characterName,
        lastTickAt: a.execution.lastTickAt,
        nextTickAt: a.execution.nextTickAt,
        errors: a.execution.errors,
      })),
    }
  }
}

/**
 * Create an autonomous agent runner
 */
export function createAgentRunner(
  config: Partial<AutonomousRunnerConfig> = {},
): AutonomousAgentRunner {
  const fullConfig: AutonomousRunnerConfig = {
    network:
      (process.env.NETWORK as 'localnet' | 'testnet' | 'mainnet') ?? 'localnet',
    maxConcurrentAgents: Number(process.env.MAX_CONCURRENT_AGENTS ?? 10),
    defaultTickIntervalMs: Number(process.env.TICK_INTERVAL_MS ?? 60_000),
    enableBuiltinCharacters: process.env.ENABLE_BUILTIN_CHARACTERS !== 'false',
    ...config,
  }

  return new AutonomousAgentRunner(fullConfig)
}

/**
 * Main entry point for running as a standalone daemon
 */
export async function runAutonomousDaemon(): Promise<void> {
  log.info('Starting autonomous agent daemon')

  const runner = createAgentRunner()

  // Handle shutdown gracefully
  const shutdown = async () => {
    log.info('Shutting down autonomous daemon...')
    await runner.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await runner.start()

  log.info('Autonomous daemon running. Press Ctrl+C to stop.')
}
