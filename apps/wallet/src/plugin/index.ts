/**
 * Network Wallet Plugin
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

export { crossChainSwapAction } from './actions/cross-chain-swap'
// JNS Actions
export {
  registerNameAction,
  resolveNameAction,
  setNameAction,
} from './actions/jns'
// Launchpad Actions
export {
  buyOnCurveAction,
  joinPresaleAction,
  launchTokenAction,
  sellOnCurveAction,
  viewLaunchesAction,
  viewMyLaunchesAction,
} from './actions/launchpad'
// Perp Actions
export {
  closePerpPositionAction,
  openPerpPositionAction,
  viewPerpMarketsAction,
  viewPerpPositionsAction,
} from './actions/perps'
// Pool Actions
export {
  addLiquidityAction,
  collectFeesAction,
  removeLiquidityAction,
  viewPositionsAction,
} from './actions/pools'
export { sendTokenAction } from './actions/send-token'
export { signMessageAction } from './actions/sign-message'
export { swapAction } from './actions/swap'
export { switchViewAction } from './actions/switch-view'
// Core Actions
export { walletInfoAction } from './actions/wallet-info'
// ElizaOS Plugin (primary export)
export {
  jejuWalletPlugin,
  jejuWalletPlugin as default,
  portfolioAction as elizaPortfolioAction,
  portfolioProvider,
  registerNameAction as elizaRegisterNameAction,
  // Actions
  sendTokenAction as elizaSendTokenAction,
  swapTokenAction as elizaSwapTokenAction,
  // Providers
  walletStateProvider,
} from './eliza-plugin'
export { AccountAbstractionService } from './services/aa.service'
export { EILService } from './services/eil.service'
export { GasService } from './services/gas.service'
export { OIFService } from './services/oif.service'
export { SecurityService } from './services/security.service'
// Services (used directly in the app, not through ElizaOS plugin system)
export { WalletService } from './services/wallet.service'

// Types
export * from './types'

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
]

/**
 * Plugin metadata
 */
export const jejuWalletPluginMeta = {
  name: 'jeju-wallet',
  version: '0.2.0',
  description:
    'Agentic wallet for EVM with AA, EIL cross-chain, OIF intents, JNS names, pools, perps, and launchpad',
}
