/**
 * Jeju Wallet Plugin
 * 
 * Provides agentic wallet capabilities including:
 * - Multi-chain wallet management (EVM)
 * - Account Abstraction (ERC-4337, ERC-7702)
 * - Ethereum Interop Layer (EIL) for bridgeless cross-chain
 * - Open Intent Framework (OIF) for intent-based transactions
 * - Security analysis and transaction simulation
 * - Gas abstraction with multi-token payments
 */

// Services (used directly in the app, not through ElizaOS plugin system)
export { WalletService } from './services/wallet.service';
export { AccountAbstractionService } from './services/aa.service';
export { EILService } from './services/eil.service';
export { OIFService } from './services/oif.service';
export { SecurityService } from './services/security.service';
export { GasService } from './services/gas.service';

// Actions
export { walletInfoAction } from './actions/wallet-info';
export { sendTokenAction } from './actions/send-token';
export { swapAction } from './actions/swap';
export { crossChainSwapAction } from './actions/cross-chain-swap';
export { signMessageAction } from './actions/sign-message';
export { switchViewAction } from './actions/switch-view';

// Types
export * from './types';

/**
 * Plugin metadata
 */
export const jejuWalletPluginMeta = {
  name: 'jeju-wallet',
  version: '0.1.0',
  description: 'Agentic wallet for EVM with Account Abstraction, EIL cross-chain, and OIF intents',
};
