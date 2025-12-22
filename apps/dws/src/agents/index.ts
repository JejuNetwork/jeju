/**
 * DWS Agents Module
 * First-class agent management in DWS
 */

// Executor
export {
  AgentExecutor,
  type ExecutorConfig,
  getExecutor,
  initExecutor,
} from './executor'

// Registry
export {
  addCronTrigger,
  getAgent,
  getAgentStats,
  getAgentsByOwner,
  getAllActiveCronTriggers,
  getCronTriggers,
  getRegistryStats,
  initRegistry,
  isInitialized,
  listAgents,
  recordInvocation,
  registerAgent,
  terminateAgent,
  updateAgent,
  updateAgentStatus,
  updateCronTriggerRun,
} from './registry'
// Routes
export { createAgentRouter } from './routes'
// Types
export * from './types'
