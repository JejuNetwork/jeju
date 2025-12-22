/**
 * Crucible - Decentralized Agent Orchestration Platform
 * 
 * Main entry point for the Crucible package.
 * 
 * Uses ElizaOS AgentRuntime with @jejunetwork/eliza-plugin for full
 * network access: compute, storage, DeFi, governance, cross-chain, A2A.
 */

// Types
export * from './types';

// SDK
export {
  AgentSDK,
  createAgentSDK,
  type AgentSDKConfig,
} from './sdk/agent';

export {
  CrucibleStorage,
  createStorage,
  type StorageConfig,
} from './sdk/storage';

export {
  CrucibleCompute,
  createCompute,
  type ComputeConfig,
  type InferenceRequest,
  type InferenceResponse,
  type ModelInfo,
} from './sdk/compute';

export {
  RoomSDK,
  createRoomSDK,
  type RoomSDKConfig,
} from './sdk/room';

export {
  ExecutorSDK,
  createExecutorSDK,
  type ExecutorConfig,
} from './sdk/executor';

// Agent Runtime - ElizaOS + @jejunetwork/eliza-plugin
export {
  CrucibleAgentRuntime,
  CrucibleRuntimeManager,
  createCrucibleRuntime,
  runtimeManager,
  type RuntimeConfig,
  type RuntimeMessage,
  type RuntimeResponse,
} from './sdk/eliza-runtime';

// Characters
export {
  characters,
  getCharacter,
  listCharacters,
  projectManagerCharacter,
  communityManagerCharacter,
  devRelCharacter,
  liaisonCharacter,
  socialMediaManagerCharacter,
  redTeamCharacter,
  blueTeamCharacter,
} from './characters';
