/**
 * Crucible - Decentralized Agent Orchestration Platform
 * 
 * Main entry point for the Crucible package.
 * 
 * Agent execution options:
 * 1. Full ElizaOS runtime with @jejunetwork/eliza-plugin (recommended)
 * 2. Direct DWS inference with character-based prompting (fallback)
 * 
 * When ElizaOS is available, agents get full plugin/action capabilities.
 * When only DWS is available, agents run with character-template inference.
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

// Agent Runtime - ElizaOS integration with DWS fallback
export {
  CrucibleAgentRuntime,
  CrucibleRuntimeManager,
  createCrucibleRuntime,
  runtimeManager,
  checkDWSHealth,
  dwsGenerate,
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
