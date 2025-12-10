/**
 * @deprecated This file is being phased out. Use:
 * - config/networks.ts for network/chain config
 * - config/contracts.ts for contract addresses
 * - config/index.ts for frontend config (import.meta.env.VITE_*)
 */

// Re-export from networks for backward compatibility
export { CHAINS as CHAIN_INFO, COMMON_TOKENS } from './networks.js';
export type { NetworkId as SupportedChainId } from './networks.js';

// Solver config with defaults
export const SOLVER_CONFIG = {
  minProfitBps: Number(process.env.SOLVER_MIN_PROFIT_BPS) || 10,
  maxGasPriceGwei: Number(process.env.SOLVER_MAX_GAS_GWEI) || 100,
  maxExposureEth: process.env.SOLVER_MAX_EXPOSURE_ETH || '10',
  rebalanceIntervalMs: Number(process.env.SOLVER_REBALANCE_INTERVAL_MS) || 60000,
};
