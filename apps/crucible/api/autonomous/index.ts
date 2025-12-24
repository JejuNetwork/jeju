/**
 * Autonomous Agent Runner
 * Manages autonomous agent lifecycle and tick execution
 */

import type { AgentCharacter } from '../../lib/types'
import type {
  AutonomousAgentConfig,
  AutonomousRunnerConfig,
  AutonomousRunnerStatus,
} from './types'

export type { AutonomousAgentConfig, AutonomousRunnerConfig, AutonomousRunnerStatus }
export { DEFAULT_AUTONOMOUS_CONFIG } from './types'

interface RegisteredAgent {
  config: AutonomousAgentConfig
  lastTick: number
  tickCount: number
  intervalId: ReturnType<typeof setInterval> | null
}

export class AutonomousAgentRunner {
  private agents: Map<string, RegisteredAgent> = new Map()
  private running = false
  private config: Required<AutonomousRunnerConfig>

  constructor(config: AutonomousRunnerConfig = {}) {
    this.config = {
      enableBuiltinCharacters: config.enableBuiltinCharacters ?? true,
      defaultTickIntervalMs: config.defaultTickIntervalMs ?? 60_000,
      maxConcurrentAgents: config.maxConcurrentAgents ?? 10,
    }
  }

  async start(): Promise<void> {
    if (this.running) return
    this.running = true

    // Start tick loops for all registered agents
    for (const [agentId, agent] of this.agents) {
      this.startAgentTicks(agentId, agent)
    }
  }

  async stop(): Promise<void> {
    this.running = false

    // Stop all agent tick loops
    for (const agent of this.agents.values()) {
      if (agent.intervalId) {
        clearInterval(agent.intervalId)
        agent.intervalId = null
      }
    }
  }

  async registerAgent(config: AutonomousAgentConfig): Promise<void> {
    if (this.agents.size >= this.config.maxConcurrentAgents) {
      throw new Error(`Max concurrent agents (${this.config.maxConcurrentAgents}) reached`)
    }

    const agent: RegisteredAgent = {
      config,
      lastTick: 0,
      tickCount: 0,
      intervalId: null,
    }

    this.agents.set(config.agentId, agent)

    if (this.running) {
      this.startAgentTicks(config.agentId, agent)
    }
  }

  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (agent?.intervalId) {
      clearInterval(agent.intervalId)
    }
    this.agents.delete(agentId)
  }

  getStatus(): AutonomousRunnerStatus {
    return {
      running: this.running,
      agentCount: this.agents.size,
      agents: Array.from(this.agents.entries()).map(([id, agent]) => ({
        id,
        character: agent.config.character.name,
        lastTick: agent.lastTick,
        tickCount: agent.tickCount,
      })),
    }
  }

  private startAgentTicks(agentId: string, agent: RegisteredAgent): void {
    if (agent.intervalId) return

    const tick = async () => {
      if (!this.running || !agent.config.enabled) return

      agent.lastTick = Date.now()
      agent.tickCount++

      // Execute agent tick - placeholder for actual implementation
      await this.executeAgentTick(agent.config)
    }

    // Run first tick immediately
    tick().catch(console.error)

    // Schedule recurring ticks
    agent.intervalId = setInterval(() => {
      tick().catch(console.error)
    }, agent.config.tickIntervalMs)
  }

  private async executeAgentTick(config: AutonomousAgentConfig): Promise<void> {
    // Placeholder - actual implementation would:
    // 1. Check agent's current state
    // 2. Evaluate opportunities based on capabilities
    // 3. Execute actions up to maxActionsPerTick
    console.log(`[Autonomous] Tick for agent ${config.agentId}`)
  }
}

export function createAgentRunner(config?: AutonomousRunnerConfig): AutonomousAgentRunner {
  return new AutonomousAgentRunner(config)
}
