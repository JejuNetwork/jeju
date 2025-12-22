/**
 * Crucible - Decentralized Agent Orchestration Platform
 *
 * Main entry point for the Crucible package.
 *
 * Uses ElizaOS AgentRuntime with @jejunetwork/eliza-plugin for full
 * network access: compute, storage, DeFi, governance, cross-chain, A2A.
 */

// Characters
export {
  blueTeamCharacter,
  characters,
  communityManagerCharacter,
  devRelCharacter,
  getCharacter,
  liaisonCharacter,
  listCharacters,
  projectManagerCharacter,
  redTeamCharacter,
  socialMediaManagerCharacter,
} from './characters'

// SDK
export {
  AgentSDK,
  type AgentSDKConfig,
  createAgentSDK,
} from './sdk/agent'
export {
  type ComputeConfig,
  CrucibleCompute,
  createCompute,
  type InferenceRequest,
  type InferenceResponse,
  type ModelInfo,
} from './sdk/compute'
// Agent Runtime - ElizaOS + @jejunetwork/eliza-plugin
export {
  CrucibleAgentRuntime,
  CrucibleRuntimeManager,
  createCrucibleRuntime,
  type RuntimeConfig,
  type RuntimeMessage,
  type RuntimeResponse,
  runtimeManager,
} from './sdk/eliza-runtime'
export {
  createExecutorSDK,
  type ExecutorConfig,
  ExecutorSDK,
} from './sdk/executor'
export {
  createRoomSDK,
  RoomSDK,
  type RoomSDKConfig,
} from './sdk/room'
export {
  CrucibleStorage,
  createStorage,
  type StorageConfig,
} from './sdk/storage'
// Types
export * from './types'
