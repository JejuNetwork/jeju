/**
 * Jeju Compute Marketplace
 *
 * A decentralized compute network for AI inference with ERC-8004 integration.
 */

// Export node types
export type {
  AttestationReport,
  AuthHeaders,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  HardwareInfo,
  ModelConfig,
  NodeMetrics,
  ProviderConfig,
} from './node';

// Export node components
export {
  ComputeNodeServer,
  countTokens,
  createInferenceEngine,
  detectHardware,
  formatHardwareInfo,
  generateHardwareHash,
  generateSimulatedAttestation,
  getAttestationHash,
  isAttestationFresh,
  MockInferenceEngine,
  OllamaInferenceEngine,
  startComputeNode,
  verifyAttestation,
} from './node';

// Export SDK types
export type {
  Capability,
  ComputeResources,
  CreateRentalParams,
  GPUType,
  InferenceRequest,
  InferenceResponse,
  Ledger,
  Provider,
  ProviderResourcesInfo,
  ProviderSubAccount,
  Rental,
  RentalStatus,
  ResourcePricing,
  SDKConfig,
  Service,
  Settlement,
} from './sdk';

// Export SDK
export { JejuComputeSDK, createSDK } from './sdk';

// Export enums
export { GPUTypeEnum, RentalStatusEnum } from './sdk/types';

// Export Moderation SDK types
export type { BanRecord, ModerationSDKConfig, Stake } from './sdk/moderation';

// Export Moderation SDK
export {
  createModerationSDK,
  ModerationSDK,
  StakeType,
} from './sdk/moderation';

// Export A2A Server
export { ComputeA2AServer, createComputeA2AServer } from './a2a-server';

// Export MCP Server
export { createMCPRouter } from './mcp-server';
