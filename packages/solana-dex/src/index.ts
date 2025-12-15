/**
 * @jeju/solana-dex
 * 
 * Unified Solana DEX SDK supporting:
 * - Jupiter (Aggregator)
 * - Raydium (CPMM + CLMM)
 * - Meteora (DLMM)
 * - Orca (Whirlpools)
 * - PumpSwap (Bonding Curves)
 */

// Main aggregator
export {
  SolanaDexAggregator,
  createSolanaDexAggregator,
  type AggregatorConfig,
  type AggregatedQuote,
  type SwapResult,
} from './aggregator';

// Individual adapters
export { JupiterAdapter, createJupiterAdapter } from './jupiter';
export { RaydiumAdapter, createRaydiumAdapter } from './raydium';
export { MeteoraAdapter, createMeteoraAdapter } from './meteora';
export { OrcaAdapter, createOrcaAdapter } from './orca';
export { PumpSwapAdapter, createPumpSwapAdapter } from './pumpswap';

// Types
export * from './types';

// Re-export useful Solana types
export { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

