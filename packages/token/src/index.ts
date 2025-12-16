/**
 * @jeju/token - Cross-chain token deployment with Hyperlane warp routes
 *
 * Supports:
 * - EVM chains (Ethereum, Base, Arbitrum, Optimism, Polygon)
 * - Cross-chain EVM bridging via Hyperlane
 *
 * For Solana bridging, use @jeju/zksolbridge package.
 */

// Bridge & Cross-chain (EVM only)
export * from './bridge';

// Configuration
export * from './config';

// Deployer utilities
export * from './deployer';

// Integration helpers
export * from './integration';

// Type definitions
export * from './types';

// Re-export useful types from dependencies
export type { Address, Hex } from 'viem';
