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
  MevBoostProvider,
  FlashbotsProvider, // Backwards compatibility alias
  FlashbotsStrategyEngine,
  FLASHBOTS_ENDPOINTS,
  BLOCK_BUILDERS,
  L2_BUILDERS,
  type FlashbotsBundle,
  type MevShareBundle,
  type MevShareEvent,
  type RollupBoostBlock,
  type SuaveBundle,
  type BundleSimulation,
  type FlashbotsConfig,
  type MevShareHint,
  type MevStats as FlashbotsMevStats,
} from './flashbots';

// Mempool Monitoring
export {
  MempoolMonitor,
  MEMPOOL_PROVIDERS,
  DEX_ROUTERS,
  SWAP_SELECTORS,
  type PendingTx,
  type SwapIntent,
  type MempoolConfig,
} from './mempool';

// MEV Strategy Engine (External Chain Focus)
export {
  ExternalChainMevEngine,
  MevStrategyEngine, // Backwards compatibility alias
  type ExternalMevConfig,
  type MevStats,
} from './strategy';
