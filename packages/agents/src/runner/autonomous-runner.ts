/**
 * Autonomous Agent Runner
 *
 * Manages the execution lifecycle of autonomous agents.
 *
 * @packageDocumentation
 */

import { logger } from '@jejunetwork/shared'
import { AutonomousCoordinator } from '../autonomous/coordinator'
import { agentLockService } from '../services/lock.service'
import type { AgentConfig } from '../types'

/**
 * Runner status
 */
export interface RunnerStatus {
  agentId: string
  running: boolean
  tickCount: number
  lastTickTime?: Date
  errors: string[]
}

/**
 * Autonomous Agent Runner
 *
 * Manages the autonomous execution of agents with proper locking and error handling.
 */
export class AutonomousAgentRunner {
  private coordinators: Map<string, AutonomousCoordinator> = new Map()
  private statuses: Map<string, RunnerStatus> = new Map()

  /**
   * Start autonomous execution for an agent
   */
  async start(agent: AgentConfig): Promise<void> {
    if (this.coordinators.has(agent.id)) {
      logger.warn('Agent runner already started', { agentId: agent.id })
      return
    }

    // Acquire lock to ensure single runner per agent
    const lock = await agentLockService.acquireLock(agent.id, 'runner', {
      timeout: 60000,
    })

    if (!lock.acquired || !lock.lockId) {
      throw new Error(`Failed to acquire runner lock for agent ${agent.id}`)
    }

    const lockId = lock.lockId
    try {
      const coordinator = new AutonomousCoordinator()
      this.coordinators.set(agent.id, coordinator)
      this.statuses.set(agent.id, {
        agentId: agent.id,
        running: true,
        tickCount: 0,
        errors: [],
      })

      await coordinator.start(agent)
      logger.info('Agent runner started', { agentId: agent.id })
    } catch (error) {
      await agentLockService.releaseLock(agent.id, 'runner', lockId)
      throw error
    }
  }

  /**
   * Stop autonomous execution for an agent
   */
  async stop(agentId: string): Promise<void> {
    const coordinator = this.coordinators.get(agentId)
    if (!coordinator) {
      logger.warn('No runner found for agent', { agentId })
      return
    }

    await coordinator.stop()
    this.coordinators.delete(agentId)

    const status = this.statuses.get(agentId)
    if (status) {
      status.running = false
    }

    // Release lock
    await agentLockService.releaseLock(agentId, 'runner', `${agentId}:runner`)

    logger.info('Agent runner stopped', { agentId })
  }

  /**
   * Get runner status
   */
  getStatus(agentId: string): RunnerStatus | null {
    return this.statuses.get(agentId) ?? null
  }

  /**
   * Get all running agents
   */
  getRunningAgents(): string[] {
    return Array.from(this.coordinators.keys())
  }

  /**
   * Check if agent is running
   */
  isRunning(agentId: string): boolean {
    return this.coordinators.has(agentId)
  }

  /**
   * Stop all agents
   */
  async stopAll(): Promise<void> {
    const agentIds = Array.from(this.coordinators.keys())
    await Promise.all(agentIds.map((id) => this.stop(id)))
    logger.info('All agent runners stopped', { count: agentIds.length })
  }
}

/** Singleton instance */
export const autonomousAgentRunner = new AutonomousAgentRunner()
