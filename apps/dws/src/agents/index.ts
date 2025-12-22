/**
 * DWS Agents Module
 * First-class agent management in DWS
 */

// Types
export * from './types';

// Registry
export {
  initRegistry,
  isInitialized,
  getRegistryStats,
  registerAgent,
  getAgent,
  getAgentsByOwner,
  listAgents,
  updateAgent,
  updateAgentStatus,
  terminateAgent,
  addCronTrigger,
  getCronTriggers,
  getAllActiveCronTriggers,
  updateCronTriggerRun,
  recordInvocation,
  getAgentStats,
} from './registry';

// Executor
export {
  AgentExecutor,
  initExecutor,
  getExecutor,
  type ExecutorConfig,
} from './executor';

// Routes
export { createAgentRouter } from './routes';

