/**
 * MEV Infrastructure - Complete Flashbots Integration
 *
 * Integrates ALL Flashbots technologies:
 *
 * 1. MEV-Boost: Multi-builder bundle submission
 * 2. BuilderNet: Decentralized block building with TEEs
 * 3. Rollup-Boost: L2 sequencer MEV internalization
 * 4. Protect RPC: Private tx submission for user protection
 * 5. SUAVE: Programmable privacy MEV (future)
 *
 * Strategy:
 * - ON JEJU: Use Protect RPC - never extract MEV from our users
 * - ON EXTERNAL CHAINS: Aggressive MEV via all builders
 */

// Flashbots Provider (MEV-Boost, BuilderNet, Protect, etc.)
export {
  BLOCK_BUILDERS,
  type BundleSimulation,
  FLASHBOTS_ENDPOINTS,
  type FlashbotsBundle,
  type FlashbotsConfig,
  FlashbotsStrategyEngine,
  L2_BUILDERS,
  MevBoostProvider,
  type MevShareBundle,
  type MevShareEvent,
  type MevShareHint,
  type MevStats as FlashbotsMevStats,
  type RollupBoostBlock,
  type SuaveBundle,
} from './flashbots'

// Mempool Monitoring
export {
  DEX_ROUTERS,
  MEMPOOL_PROVIDERS,
  type MempoolConfig,
  MempoolMonitor,
  type PendingTx,
  SWAP_SELECTORS,
  type SwapIntent,
} from './mempool'

// MEV Strategy Engine (External Chain Focus)
export {
  ExternalChainMevEngine,
  type ExternalMevConfig,
  type MevStats,
} from './strategy'
