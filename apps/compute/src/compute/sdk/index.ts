/**
 * Jeju Compute SDK
 *
 * Client library for interacting with the decentralized compute marketplace:
 * - JejuComputeSDK: OpenAI-compatible AI inference with on-chain settlement
 *   - Includes rental support for SSH/Docker compute (vast.ai-style)
 * - CrossChainComputeClient: Cross-chain compute via OIF/EIL
 *   - Create rentals from any L2 via intents
 *   - Gasless transactions via XLP sponsorship
 * - ModerationSDK: Community moderation and staking
 * - ComputePaymentClient: Multi-token payments via ERC-4337 paymasters
 *   - Pay with any registered token (elizaOS, USDC, VIRTUAL, etc.)
 *   - Automatic gas sponsorship
 *   - Credit-based prepayment for zero-latency operations
 */

export * from './moderation';
export * from './sdk';
export * from './types';
export * from './cross-chain';
export * from './payment';
export * from './x402';
