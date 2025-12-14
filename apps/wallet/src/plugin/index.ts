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
 * - JNS Name Service (.jeju names)
 * - Liquidity pools (XLP V2/V3)
 * - Perpetual futures trading
 * - Token launchpad (bonding curves, ICO)
 * - Bazaar NFT marketplace
 */

// Services (used directly in the app, not through ElizaOS plugin system)
export { WalletService } from './services/wallet.service';
export { AccountAbstractionService } from './services/aa.service';
export { EILService } from './services/eil.service';
export { OIFService } from './services/oif.service';
export { SecurityService } from './services/security.service';
export { GasService } from './services/gas.service';

// Core Actions
export { walletInfoAction } from './actions/wallet-info';
export { sendTokenAction } from './actions/send-token';
export { swapAction } from './actions/swap';
export { crossChainSwapAction } from './actions/cross-chain-swap';
export { signMessageAction } from './actions/sign-message';
export { switchViewAction } from './actions/switch-view';

// JNS Actions
export { registerNameAction, resolveNameAction, setNameAction } from './actions/jns';

// Pool Actions
export { addLiquidityAction, removeLiquidityAction, viewPositionsAction, collectFeesAction } from './actions/pools';

// Perp Actions
export { openPerpPositionAction, closePerpPositionAction, viewPerpPositionsAction, viewPerpMarketsAction } from './actions/perps';

// Launchpad Actions
export { launchTokenAction, buyOnCurveAction, sellOnCurveAction, viewLaunchesAction, viewMyLaunchesAction, joinPresaleAction } from './actions/launchpad';

// Types
export * from './types';

/**
 * All wallet actions for plugin registration
 */
export const walletActions = [
  // Core
  'walletInfoAction',
  'sendTokenAction',
  'swapAction',
  'crossChainSwapAction',
  'signMessageAction',
  'switchViewAction',
  // JNS
  'registerNameAction',
  'resolveNameAction',
  'setNameAction',
  // Pools
  'addLiquidityAction',
  'removeLiquidityAction',
  'viewPositionsAction',
  'collectFeesAction',
  // Perps
  'openPerpPositionAction',
  'closePerpPositionAction',
  'viewPerpPositionsAction',
  'viewPerpMarketsAction',
  // Launchpad
  'launchTokenAction',
  'buyOnCurveAction',
  'sellOnCurveAction',
  'viewLaunchesAction',
  'viewMyLaunchesAction',
  'joinPresaleAction',
];

/**
 * Plugin metadata
 */
export const jejuWalletPluginMeta = {
  name: 'jeju-wallet',
  version: '0.2.0',
  description: 'Agentic wallet for EVM with AA, EIL cross-chain, OIF intents, JNS names, pools, perps, and launchpad',
};
