/**
 * Jeju Compute SDK
 *
 * Client library for interacting with the decentralized compute marketplace.
 *
 * ## Core Features
 * - JejuComputeSDK: Inference API with on-chain settlement
 *   - Includes rental support for SSH/Docker compute
 * - CrossChainComputeClient: Cross-chain compute via OIF/EIL
 *   - Create rentals from any L2 via intents
 *   - Gasless transactions via XLP sponsorship
 *
 * ## Marketplace (Recommended)
 * - ComputeMarketplace: Unified interface for all compute services
 *   - Model discovery by type (LLM, image, video, audio, embeddings)
 *   - Automatic endpoint selection with TEE support
 *   - TEE node integration
 *   - X402 payment with JEJU token
 *
 * ## Decentralized Inference
 * - InferenceRegistrySDK: On-chain model registry
 *   - All models registered with standardized metadata
 *   - Discover by capabilities, price, creator, TEE requirements
 *   - Multi-endpoint routing with load balancing
 * - ExternalModelProvider: Bridge to external API endpoints
 *   - Routes to endpoints registered in the on-chain registry
 *   - X402/Paymaster payment integration
 *
 * ## Payments
 * - ComputePaymentClient: Multi-token payments via ERC-4337 paymasters
 *   - Pay with any registered token (JEJU preferred)
 *   - Automatic gas sponsorship
 *   - Credit-based prepayment for zero-latency operations
 * - X402Client: HTTP 402 Payment Required protocol
 *
 * ## Moderation
 * - ModerationSDK: Community moderation and staking
 */

export * from './moderation';
export * from './content-moderation';
export * from './moderation-middleware';
export * from './sdk';
export * from './types';
export * from './cross-chain';
export * from './payment';
export * from './x402';
export * from './inference-registry';
export * from './cloud-provider';
export * from './cloud-integration';

// Re-export marketplace with explicit names to avoid conflicts
export {
  ComputeMarketplace,
  createComputeMarketplace,
  type MarketplaceConfig,
  type InferenceRequest as MarketplaceInferenceRequest,
  type InferenceInput,
  type InferenceOptions as MarketplaceInferenceOptions,
  type InferenceResult as MarketplaceInferenceResult,
} from './marketplace';
