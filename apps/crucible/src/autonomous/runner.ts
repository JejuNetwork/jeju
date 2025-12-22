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
import {
  BLUE_TEAM_CHARACTERS,
  getCharacter,
  listCharacters,
  RED_TEAM_CHARACTERS,
} from '../characters'
import {
  type CrucibleAgentRuntime,
  createCrucibleRuntime,
} from '../sdk/eliza-runtime'
import { createLogger } from '../sdk/logger'
import { AutonomousTick, type AutonomousTickResult } from './tick'
import {
  type AutonomousAgentConfig,
  BLUE_TEAM_CONFIG,
  DEFAULT_AUTONOMOUS_CONFIG,
  DEFAULT_SMALL_MODEL,
  getRedTeamConfig,
  RED_TEAM_CONFIG,
} from './types'

const log = createLogger('AutonomousRunner')

// ANSI color codes for pretty logging
const COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
}

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
  /** Only load red/blue team agents (skip general purpose) */
  redBlueTeamOnly: boolean
  /** Verbose logging to see agent thinking */
  verbose: boolean
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
    // Check if red team is enabled for this network
    const redTeamSettings = getRedTeamConfig(this.config.network)

    console.log(
      `\n${COLORS.bold}${COLORS.cyan}════════════════════════════════════════════════════════════════${COLORS.reset}`,
    )
    console.log(
      `${COLORS.bold}${COLORS.cyan}  AUTONOMOUS AGENT LOADER${COLORS.reset}`,
    )
    console.log(
      `${COLORS.bold}${COLORS.cyan}════════════════════════════════════════════════════════════════${COLORS.reset}`,
    )
    console.log(
      `${COLORS.dim}Network: ${this.config.network} | Model: ${redTeamSettings.model} | Max Agents: ${this.config.maxConcurrentAgents}${COLORS.reset}\n`,
    )

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

        // Determine base config based on character type
        const isRedTeam = (RED_TEAM_CHARACTERS as readonly string[]).includes(
          characterId,
        )
        const isBlueTeam = (BLUE_TEAM_CHARACTERS as readonly string[]).includes(
          characterId,
        )

        // If redBlueTeamOnly, skip general purpose agents
        if (this.config.redBlueTeamOnly && !isRedTeam && !isBlueTeam) {
          continue
        }

        // Skip red team agents if not enabled for this network
        if (isRedTeam && !redTeamSettings.enabled) {
          log.info('Skipping red team agent (disabled on this network)', {
            characterId,
            network: this.config.network,
          })
          continue
        }

        // Select appropriate config
        let baseConfig = DEFAULT_AUTONOMOUS_CONFIG
        if (isRedTeam) {
          baseConfig = RED_TEAM_CONFIG
        } else if (isBlueTeam) {
          baseConfig = BLUE_TEAM_CONFIG
        }

        // Override model preference to use small cheap model
        const characterWithModel = {
          ...character,
          modelPreferences: {
            ...character.modelPreferences,
            small: DEFAULT_SMALL_MODEL,
            large: DEFAULT_SMALL_MODEL, // Use small model for everything in dev
          },
        }

        const agentConfig: AutonomousAgentConfig = {
          ...baseConfig,
          agentId: `autonomous-${characterId}`,
          character: characterWithModel,
          tickIntervalMs:
            baseConfig.tickIntervalMs ?? this.config.defaultTickIntervalMs,
          redTeamMode: isRedTeam
            ? this.config.network === 'testnet'
              ? 'testnet'
              : 'dev'
            : undefined,
        }

        await this.registerAgent(agentConfig)

        // Pretty print agent loading
        const teamColor = isRedTeam
          ? COLORS.red
          : isBlueTeam
            ? COLORS.blue
            : COLORS.green
        const teamLabel = isRedTeam ? 'RED' : isBlueTeam ? 'BLUE' : 'GENERAL'
        console.log(
          `${teamColor}[${teamLabel}]${COLORS.reset} ${COLORS.bold}${character.name}${COLORS.reset} (${characterId}) - ${character.description.substring(0, 50)}...`,
        )
      }
    }

    console.log(
      `\n${COLORS.cyan}Loaded ${this.agents.size} agents${COLORS.reset}`,
    )
    console.log(
      `${COLORS.dim}Red Team: ${RED_TEAM_CHARACTERS.length} | Blue Team: ${BLUE_TEAM_CHARACTERS.length}${COLORS.reset}`,
    )
    console.log(
      `${COLORS.bold}${COLORS.cyan}════════════════════════════════════════════════════════════════${COLORS.reset}\n`,
    )
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

    // Determine team color for logging
    const charId = config.character.id
    const isRedTeam = (RED_TEAM_CHARACTERS as readonly string[]).includes(
      charId,
    )
    const isBlueTeam = (BLUE_TEAM_CHARACTERS as readonly string[]).includes(
      charId,
    )
    const teamColor = isRedTeam
      ? COLORS.red
      : isBlueTeam
        ? COLORS.blue
        : COLORS.green
    const teamEmoji = isRedTeam ? '🔴' : isBlueTeam ? '🔵' : '🟢'

    if (this.config.verbose) {
      console.log(
        `\n${teamColor}${COLORS.bold}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`,
      )
      console.log(
        `${teamEmoji} ${teamColor}${COLORS.bold}${config.character.name}${COLORS.reset} is thinking...`,
      )
      console.log(
        `${COLORS.dim}Agent: ${agentId} | Tick #${execution.lastTickAt > 0 ? Math.floor((now - execution.lastTickAt) / config.tickIntervalMs) + 1 : 1}${COLORS.reset}`,
      )
    }

    try {
      // Create tick handler with verbose mode
      const tick = new AutonomousTick(config, runtime, this.config.verbose)

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

      // Log result summary
      if (this.config.verbose && result.actionsExecuted.length > 0) {
        console.log(`${teamColor}${COLORS.bold}Actions taken:${COLORS.reset}`)
        for (const action of result.actionsExecuted) {
          const status = action.success
            ? `${COLORS.green}✓${COLORS.reset}`
            : `${COLORS.red}✗${COLORS.reset}`
          console.log(`  ${status} ${action.name}`)
          if (action.result && this.config.verbose) {
            console.log(
              `    ${COLORS.dim}→ ${JSON.stringify(action.result).substring(0, 100)}${COLORS.reset}`,
            )
          }
        }
      }

      return result
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log.error('Tick execution failed', { agentId, error })

      if (this.config.verbose) {
        console.log(`${COLORS.red}Error: ${error}${COLORS.reset}`)
      }

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
    maxConcurrentAgents: Number(process.env.MAX_CONCURRENT_AGENTS ?? 20),
    defaultTickIntervalMs: Number(process.env.TICK_INTERVAL_MS ?? 20_000), // 20 seconds default
    enableBuiltinCharacters: true, // Always enable
    redBlueTeamOnly: process.env.RED_BLUE_ONLY !== 'false', // Default to red/blue team only
    verbose: process.env.VERBOSE !== 'false', // Default to verbose
    ...config,
  }

  return new AutonomousAgentRunner(fullConfig)
}

/**
 * Main entry point for running as a standalone daemon
 */
export async function runAutonomousDaemon(): Promise<void> {
  console.log(`
${COLORS.bold}${COLORS.magenta}
   ██████╗██████╗ ██╗   ██╗ ██████╗██╗██████╗ ██╗     ███████╗
  ██╔════╝██╔══██╗██║   ██║██╔════╝██║██╔══██╗██║     ██╔════╝
  ██║     ██████╔╝██║   ██║██║     ██║██████╔╝██║     █████╗  
  ██║     ██╔══██╗██║   ██║██║     ██║██╔══██╗██║     ██╔══╝  
  ╚██████╗██║  ██║╚██████╔╝╚██████╗██║██████╔╝███████╗███████╗
   ╚═════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝╚═╝╚═════╝ ╚══════╝╚══════╝
${COLORS.reset}
${COLORS.cyan}  Autonomous Red/Blue Team Agent Runner${COLORS.reset}
${COLORS.dim}  Using Groq llama-3.1-8b-instant for fast, cheap inference${COLORS.reset}
`)

  const runner = createAgentRunner({
    redBlueTeamOnly: true, // Only run red/blue team agents
    verbose: true, // Show agent thinking
  })

  // Handle shutdown gracefully
  const shutdown = async () => {
    console.log(
      `\n${COLORS.yellow}Shutting down autonomous agents...${COLORS.reset}`,
    )
    await runner.stop()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await runner.start()

  console.log(
    `\n${COLORS.green}${COLORS.bold}Agents are now running autonomously.${COLORS.reset}`,
  )
  console.log(`${COLORS.dim}Press Ctrl+C to stop.${COLORS.reset}\n`)
}
