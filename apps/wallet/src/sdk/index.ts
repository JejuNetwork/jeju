/**
 * @fileoverview Network Wallet SDK - Unified cross-chain wallet interface
 * @module @jejunetwork/wallet/sdk
 *
 * Provides seamless cross-chain UX through:
 * - EIL (Ethereum Interop Layer) for trustless cross-chain transfers
 * - OIF (Open Intents Framework) for intent-based transactions
 * - ERC-4337 Account Abstraction for gas-free transactions
 * - Multi-token gas payment via XLP liquidity
 */

export * from './chains';
export * from './contracts';
export * from './eil';
export * from './oif';
export * from './account-abstraction';
export * from './gas-abstraction';
export * from './types';
export * from './wallet-core';

