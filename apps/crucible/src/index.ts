/**
 * Crucible - Decentralized Agent Orchestration Platform
 * 
 * Main entry point for the Crucible package.
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
