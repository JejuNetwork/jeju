/**
 * Crucible Autonomous Agent System
 *
 * Provides autonomous agent execution similar to Babylon's pattern:
 * - Agents run on configurable tick intervals
 * - Each tick, the LLM decides what actions to take
 * - Actions are executed via the jeju plugin
 * - Results are logged for monitoring
 *
 * @packageDocumentation
 */

export {
  AutonomousAgentRunner,
  createAgentRunner,
  runAutonomousDaemon,
} from './runner'
export {
  type AutonomousAction,
  AutonomousTick,
  type AutonomousTickResult,
} from './tick'
export type { AgentTickContext, AutonomousAgentConfig } from './types'
